-- Final mission lifecycle, participant history and immutable customer reviews.
-- Remote deployment must remain behind a separate security audit.

create or replace function public.decide_current_customer_quote(target_quote_id uuid,new_decision text)
returns public.quotes language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); locked_mission_id uuid; mission_row public.missions; quote_row public.quotes;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  if new_decision not in ('accepted','declined') then raise exception 'Invalid quote decision.' using errcode='22023'; end if;
  select q.mission_id into locked_mission_id from public.quotes q where q.id=target_quote_id;
  select * into mission_row from public.missions where id=locked_mission_id for update;
  select * into quote_row from public.quotes where id=target_quote_id for update;
  if quote_row.id is null or mission_row.id is null or mission_row.client_id is distinct from uid or quote_row.mission_id is distinct from mission_row.id then
    raise exception 'Customer quote not found.' using errcode='42501';
  end if;
  if not ((quote_row.status='pending' and mission_row.status='quote_pending') or (quote_row.status='supplement_pending' and mission_row.status='supplement_pending')) then
    raise exception 'Quote is no longer awaiting acceptance.' using errcode='40001';
  end if;
  update public.quotes set status=case when new_decision='accepted' then 'accepted'::public.quote_status
      when quote_row.type='initial' then 'declined'::public.quote_status else 'rejected'::public.quote_status end,
    decided_by=uid,decided_at=statement_timestamp() where id=quote_row.id returning * into quote_row;
  update public.missions set
    status=case when new_decision='accepted' and quote_row.type='initial' then 'quote_pending'::public.mission_status
      when new_decision='accepted' then 'in_progress'::public.mission_status
      when quote_row.type='initial' then 'arrived'::public.mission_status else 'in_progress'::public.mission_status end,
    final_authorized_amount=case when new_decision='accepted' then quote_row.total_amount else final_authorized_amount end,
    version=version+1 where id=mission_row.id and client_id=uid;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,case when new_decision='accepted' then 'mission.quote.accepted' else 'mission.quote.declined' end,
      uid,'customer',jsonb_build_object('quoteId',quote_row.id,'version',quote_row.version,'decision',quote_row.status));
  return quote_row;
end $$;

-- Preserve the audited 007 payload while exposing the server-owned optimistic-lock version.
create or replace function public.get_current_provider_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'provider',jsonb_build_object('id',pp.provider_id,'name',p.display_name,'specialty',pp.specialty,'kycStatus',pp.kyc_status),
    'status',jsonb_build_object('online',ps.online,'available',ps.available,'lastLocationAt',ps.last_location_at),
    'offers',coalesce((select jsonb_agg(jsonb_build_object('id',mo.id,'missionId',mo.mission_id,'status',mo.status,
      'serviceCategory',m.service_category,'request',m.problem_description,'approximateAddress','Khu vực Nha Trang',
      'distanceKm',mo.straight_line_distance_km,'etaMinutes',greatest(2,ceil(coalesce(mo.straight_line_distance_km,0)/0.32)::integer),'expiresAt',mo.expires_at)
      order by mo.match_rank,mo.provider_id) from public.mission_offers mo join public.missions m on m.id=mo.mission_id
      where mo.provider_id=uid and mo.status='pending' and mo.expires_at>statement_timestamp()),'[]'::jsonb),
    'assignment',(select jsonb_build_object('id',m.id,'version',m.version,'serviceCategory',m.service_category,'request',m.problem_description,
      'address',m.address_text,'status',m.status,'acceptedAt',m.accepted_at,
      'clientLocation',jsonb_build_object('latitude',m.client_latitude,'longitude',m.client_longitude),
      'providerLocation',case when ps.last_latitude is null then null else jsonb_build_object('latitude',ps.last_latitude,'longitude',ps.last_longitude) end)
      from public.missions m where m.provider_id=uid and m.status not in ('completed','cancelled','expired') order by m.accepted_at desc nulls last limit 1)
  ) into result from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  join public.provider_status ps on ps.provider_id=pp.provider_id where pp.provider_id=uid;
  return result;
end $$;

create or replace function public.start_current_provider_intervention(target_mission_id uuid,expected_version integer)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; accepted_quote public.quotes;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  select * into accepted_quote from public.quotes q where q.mission_id=target_mission_id and q.status='accepted' order by q.version desc limit 1;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if mission_row.version is distinct from expected_version or mission_row.status<>'quote_pending' or accepted_quote.id is null
     or accepted_quote.type<>'initial' or mission_row.final_authorized_amount is distinct from accepted_quote.total_amount
     or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
    raise exception 'Mission is not ready to start.' using errcode='40001';
  end if;
  update public.missions set status='in_progress',started_at=statement_timestamp(),version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.intervention.started',uid,'provider',jsonb_build_object('quoteId',accepted_quote.id,'quoteVersion',accepted_quote.version));
  return mission_row;
end $$;

create or replace function public.finish_current_provider_intervention(target_mission_id uuid,expected_version integer)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; accepted_quote public.quotes;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  select * into accepted_quote from public.quotes q where q.mission_id=target_mission_id and q.status='accepted' order by q.version desc limit 1;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if mission_row.version is distinct from expected_version or mission_row.status<>'in_progress' or mission_row.started_at is null
     or accepted_quote.id is null or mission_row.final_authorized_amount is distinct from accepted_quote.total_amount
     or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
    raise exception 'Mission is not ready to finish.' using errcode='40001';
  end if;
  update public.missions set status='completed_pending_payment',version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role)
    values(mission_row.id,'mission.intervention.finished',uid,'provider');
  return mission_row;
end $$;

create or replace function public.complete_current_customer_external_payment(target_mission_id uuid,expected_version integer)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.client_id is distinct from uid then raise exception 'Customer mission not found.' using errcode='42501'; end if;
  if mission_row.version is distinct from expected_version or mission_row.status<>'completed_pending_payment'
     or mission_row.payment_status<>'unpaid' or mission_row.provider_id is null or mission_row.final_authorized_amount is null then
    raise exception 'Mission cannot be completed.' using errcode='40001';
  end if;
  update public.missions set status='completed',payment_status='paid_external',completed_at=statement_timestamp(),version=version+1
    where id=mission_row.id and client_id=uid and version=expected_version returning * into mission_row;
  update public.provider_status set current_mission_id=null,available=online,updated_at=statement_timestamp()
    where provider_id=mission_row.provider_id and current_mission_id=mission_row.id;
  update public.provider_profiles set completed_jobs=completed_jobs+1,updated_at=statement_timestamp()
    where provider_id=mission_row.provider_id;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role)
    values(mission_row.id,'mission.completed.external_payment',uid,'customer');
  return mission_row;
end $$;

create or replace function public.create_current_customer_review(target_mission_id uuid,new_rating integer,new_comment text default null)
returns public.reviews language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; result public.reviews;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  if new_rating not between 1 and 5 or char_length(coalesce(new_comment,''))>2000 then raise exception 'Invalid review.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.client_id is distinct from uid or mission_row.provider_id is null or mission_row.status<>'completed'
     or mission_row.payment_status<>'paid_external' then raise exception 'Completed customer mission not found.' using errcode='42501'; end if;
  if exists(select 1 from public.reviews r where r.mission_id=mission_row.id) then raise exception 'Mission already reviewed.' using errcode='23505'; end if;
  insert into public.reviews(mission_id,client_id,provider_id,rating,comment)
    values(mission_row.id,uid,mission_row.provider_id,new_rating,nullif(trim(coalesce(new_comment,'')),'')) returning * into result;
  update public.provider_profiles pp set rating_average=summary.average_rating,review_count=summary.review_count,updated_at=statement_timestamp()
    from (select round(avg(r.rating)::numeric,2) average_rating,count(*)::integer review_count from public.reviews r where r.provider_id=mission_row.provider_id) summary
    where pp.provider_id=mission_row.provider_id;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.review.created',uid,'customer',jsonb_build_object('reviewId',result.id,'rating',result.rating));
  return result;
end $$;

create or replace function public.get_current_user_mission_history()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); user_role public.app_role; result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' then raise exception 'Authentication required.' using errcode='42501'; end if;
  select p.role into user_role from public.profiles p where p.user_id=uid and p.status='active';
  if user_role not in ('customer','provider') then raise exception 'Mission participant role required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'serviceCategory',m.service_category,'problemDescription',m.problem_description,
    'status',m.status,'providerId',m.provider_id,'clientId',m.client_id,'finalAuthorizedAmount',m.final_authorized_amount,
    'currency',m.currency,'paymentStatus',m.payment_status,'requestedAt',m.requested_at,'startedAt',m.started_at,'completedAt',m.completed_at,
    'review',case when r.id is null then null else jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'createdAt',r.created_at) end)
    order by m.created_at desc),'[]'::jsonb) into result
  from public.missions m left join public.reviews r on r.mission_id=m.id
  where (user_role='customer' and m.client_id=uid) or (user_role='provider' and m.provider_id=uid);
  return result;
end $$;

drop policy if exists reviews_client_insert on public.reviews;
drop policy if exists reviews_admin_insert on public.reviews;
revoke insert,update,delete on public.reviews from authenticated;

revoke all on function public.start_current_provider_intervention(uuid,integer) from public,anon;
revoke all on function public.finish_current_provider_intervention(uuid,integer) from public,anon;
revoke all on function public.complete_current_customer_external_payment(uuid,integer) from public,anon;
revoke all on function public.create_current_customer_review(uuid,integer,text) from public,anon;
revoke all on function public.get_current_user_mission_history() from public,anon;
grant execute on function public.start_current_provider_intervention(uuid,integer) to authenticated;
grant execute on function public.finish_current_provider_intervention(uuid,integer) to authenticated;
grant execute on function public.complete_current_customer_external_payment(uuid,integer) to authenticated;
grant execute on function public.create_current_customer_review(uuid,integer,text) to authenticated;
grant execute on function public.get_current_user_mission_history() to authenticated;
