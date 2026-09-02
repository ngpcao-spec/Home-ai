-- Provider diagnosis and versioned quotes. Keep remote deployment behind a separate audit.

create or replace function public.get_current_provider_quote_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object('id',q.id,'version',q.version,'status',q.status,'diagnosis',q.diagnosis,
    'totalAmount',q.total_amount,'currency',q.currency,'warrantyDays',q.warranty_days,
    'items',coalesce((select jsonb_agg(jsonb_build_object('itemType',qi.item_type,'description',qi.description,'amount',qi.amount,'position',qi.position) order by qi.position) from public.quote_items qi where qi.quote_id=q.id),'[]'::jsonb))
  into result from public.quotes q join public.missions m on m.id=q.mission_id
  where m.provider_id=uid and m.status not in ('completed','cancelled','expired')
  order by q.version desc limit 1;
  return result;
end $$;

create or replace function public.create_current_provider_quote_version(target_mission_id uuid,new_diagnosis text,
  new_warranty_days integer,new_items jsonb,target_parent_quote_id uuid default null)
returns public.quotes language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; parent_row public.quotes; result public.quotes;
  item jsonb; next_version integer; total bigint:=0; quote_type public.quote_type; quote_status public.quote_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if char_length(trim(coalesce(new_diagnosis,''))) not between 1 and 4000 or new_warranty_days not between 0 and 3650
     or jsonb_typeof(new_items) is distinct from 'array' or jsonb_array_length(new_items) not between 1 and 20 then
    raise exception 'Invalid quote content.' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(new_items) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'item_type' not in ('labor','part','service')
       or char_length(trim(coalesce(item->>'description',''))) not between 1 and 500
       or jsonb_typeof(item->'amount') is distinct from 'number' or (item->>'amount')::bigint < 0 then
      raise exception 'Invalid quote item.' using errcode='22023';
    end if;
    total:=total+(item->>'amount')::bigint;
  end loop;
  if target_parent_quote_id is null then
    if mission_row.status<>'arrived' or exists(select 1 from public.quotes q where q.mission_id=mission_row.id) then
      raise exception 'Initial quote cannot be created.' using errcode='55000';
    end if;
    next_version:=1; quote_type:='initial'; quote_status:='pending';
  else
    select * into parent_row from public.quotes where id=target_parent_quote_id and mission_id=mission_row.id for update;
    if mission_row.status<>'in_progress' or parent_row.id is null or parent_row.status<>'accepted'
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
      raise exception 'Accepted parent quote required for a new version.' using errcode='55000';
    end if;
    select coalesce(max(q.version),0)+1 into next_version from public.quotes q where q.mission_id=mission_row.id;
    quote_type:='supplement'; quote_status:='supplement_pending';
  end if;
  insert into public.quotes(mission_id,version,parent_quote_id,type,status,diagnosis,total_amount,warranty_days,created_by)
    values(mission_row.id,next_version,target_parent_quote_id,quote_type,quote_status,trim(new_diagnosis),total,new_warranty_days,uid) returning * into result;
  insert into public.quote_items(quote_id,item_type,description,amount,position)
    select result.id,(value->>'item_type')::public.quote_item_type,trim(value->>'description'),(value->>'amount')::bigint,ordinality::smallint
    from jsonb_array_elements(new_items) with ordinality;
  update public.missions set status=case when quote_type='initial' then 'quote_pending'::public.mission_status else 'supplement_pending'::public.mission_status end,
    diagnostic_summary=trim(new_diagnosis),version=version+1 where id=mission_row.id and provider_id=uid;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.quote.sent',uid,'provider',jsonb_build_object('quoteId',result.id,'version',result.version));
  return result;
end $$;

create or replace function public.accept_current_customer_quote(target_quote_id uuid)
returns public.quotes language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); locked_mission_id uuid; mission_row public.missions; quote_row public.quotes;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  select q.mission_id into locked_mission_id from public.quotes q where q.id=target_quote_id;
  select * into mission_row from public.missions where id=locked_mission_id for update;
  select * into quote_row from public.quotes where id=target_quote_id for update;
  if quote_row.id is null or mission_row.id is null or mission_row.client_id is distinct from uid or quote_row.mission_id is distinct from mission_row.id then
    raise exception 'Customer quote not found.' using errcode='42501';
  end if;
  if not ((quote_row.status='pending' and mission_row.status='quote_pending') or (quote_row.status='supplement_pending' and mission_row.status='supplement_pending')) then
    raise exception 'Quote is no longer awaiting acceptance.' using errcode='40001';
  end if;
  update public.quotes set status='accepted',decided_by=uid,decided_at=statement_timestamp() where id=quote_row.id returning * into quote_row;
  update public.missions set status='in_progress',final_authorized_amount=quote_row.total_amount,started_at=coalesce(started_at,statement_timestamp()),version=version+1
    where id=mission_row.id and client_id=uid;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.quote.accepted',uid,'customer',jsonb_build_object('quoteId',quote_row.id,'version',quote_row.version,'authorizedAmount',quote_row.total_amount));
  return quote_row;
end $$;

revoke all on function public.get_current_provider_quote_state() from public,anon;
revoke all on function public.create_current_provider_quote_version(uuid,text,integer,jsonb,uuid) from public,anon;
revoke all on function public.accept_current_customer_quote(uuid) from public,anon;
grant execute on function public.get_current_provider_quote_state() to authenticated;
grant execute on function public.create_current_provider_quote_version(uuid,text,integer,jsonb,uuid) to authenticated;
grant execute on function public.accept_current_customer_quote(uuid) to authenticated;
