-- HOME AI V1: KYC infrastructure stays installed but is not an operational prerequisite.
-- Function bodies are otherwise identical to the production definitions audited on 2026-09-15.

-- HOME AI V1 keeps the complete KYC subsystem for V2, but KYC is not an
-- onboarding, online, matching, offer, or mission-workflow prerequisite.
-- Existing providers were grandfathered by the preceding onboarding migration;
-- new providers reach completed_at only after the V1 profile/activity/area/
-- availability steps have been persisted.
create or replace function private.provider_v1_onboarding_complete(target_provider_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.provider_onboarding_progress op
    join public.provider_profiles pp on pp.provider_id=op.provider_id
    join public.profiles p on p.user_id=op.provider_id
    where op.provider_id=target_provider_id
      and op.completed_at is not null
      and pp.active
      and p.role='provider'
      and p.status='active'
  )
$$;
revoke all on function private.provider_v1_onboarding_complete(uuid) from public,anon,authenticated;

-- V1 removes only the KYC eligibility predicate from private.can_view_profile(uuid).
CREATE OR REPLACE FUNCTION private.can_view_profile(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    target_user_id = (select auth.uid())
    or private.is_admin()
    or exists (
      select 1
      from public.provider_profiles pp
      join public.profiles p on p.user_id = pp.provider_id
      where pp.provider_id = target_user_id
        and pp.active
        and p.status = 'active'
    )
    or exists (
      select 1
      from public.missions m
      where ((select auth.uid()) = m.client_id or (select auth.uid()) = m.provider_id)
        and (target_user_id = m.client_id or target_user_id = m.provider_id)
    )
$function$
;

-- V1 removes only the KYC eligibility predicate from private.dispatch_next_mission_offer(uuid,interval,interval).
CREATE OR REPLACE FUNCTION private.dispatch_next_mission_offer(target_mission_id uuid, offer_lifetime interval DEFAULT '00:02:00'::interval, maximum_location_age interval DEFAULT '00:05:00'::interval)
 RETURNS mission_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mission_row public.missions; candidate record; result public.mission_offers;
begin
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is not null
     or mission_row.status not in ('requested','searching','offered') then return null; end if;
  select c.* into candidate from (
    select pp.provider_id,private.straight_line_distance_km(mission_row.client_latitude,
      mission_row.client_longitude,pst.last_latitude,pst.last_longitude) distance_km,
      pp.service_radius_km,pp.reliability_score,pp.rating_average,pp.completed_jobs
    from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
    join public.provider_services svc on svc.provider_id=pp.provider_id
    join public.provider_status pst on pst.provider_id=pp.provider_id
    where svc.service_category=mission_row.service_category and svc.enabled
      and pp.active and p.status='active'
      and pst.online and pst.available and pst.current_mission_id is null
      and pst.last_latitude is not null and pst.last_longitude is not null
      and pst.last_location_at>=statement_timestamp()-maximum_location_age
      and private.provider_v1_onboarding_complete(pp.provider_id)
      and private.provider_schedule_allows(pp.provider_id,statement_timestamp())
      and not exists(select 1 from public.mission_offers previous
        where previous.mission_id=mission_row.id and previous.provider_id=pp.provider_id)
  ) c where c.distance_km<=c.service_radius_km
  order by c.distance_km,c.reliability_score desc,c.rating_average desc,c.completed_jobs desc,c.provider_id limit 1;
  if candidate.provider_id is null then
    update public.missions set status='searching',version=version+1 where id=mission_row.id and status<>'searching';
    return null; end if;
  insert into public.mission_offers(mission_id,provider_id,status,offered_at,expires_at,
    straight_line_distance_km,match_rank) values(mission_row.id,candidate.provider_id,'pending',
    statement_timestamp(),statement_timestamp()+offer_lifetime,candidate.distance_km,1) returning * into result;
  update public.missions set status='offered',version=version+1 where id=mission_row.id;
  insert into public.mission_events(mission_id,event_type,actor_role,payload)
    values(mission_row.id,'mission.offer.dispatched',null,jsonb_build_object('offerId',result.id));
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.accept_current_provider_offer(uuid).
CREATE OR REPLACE FUNCTION public.accept_current_provider_offer(target_offer_id uuid)
 RETURNS missions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); lock_mission_id uuid; lock_provider_id uuid;
  mission_row public.missions; offer_row public.mission_offers; profile_row public.profiles;
  provider_row public.provider_profiles; status_row public.provider_status; service_row public.provider_services;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Active provider authentication required.' using errcode='42501'; end if;
  select mission_id,provider_id into lock_mission_id,lock_provider_id from public.mission_offers where id=target_offer_id;
  if lock_provider_id is distinct from uid then raise exception 'Provider offer not found.' using errcode='42501'; end if;
  select * into mission_row from public.missions where id=lock_mission_id for update;
  select * into profile_row from public.profiles where user_id=uid for update;
  select * into provider_row from public.provider_profiles where provider_id=uid for update;
  select * into status_row from public.provider_status where provider_id=uid for update;
  select * into service_row from public.provider_services where provider_id=uid
    and service_category=mission_row.service_category for update;
  select * into offer_row from public.mission_offers where id=target_offer_id for update;
  if offer_row.id is null or offer_row.provider_id is distinct from uid
     or offer_row.mission_id is distinct from mission_row.id then
    raise exception 'Provider offer not found.' using errcode='42501'; end if;
  if profile_row.user_id is null or profile_row.role<>'provider' or profile_row.status<>'active'
     or provider_row.provider_id is null or not provider_row.active
     or service_row.id is null or not service_row.enabled
     or not private.provider_v1_onboarding_complete(uid) then
    raise exception 'Provider is no longer eligible.' using errcode='55000'; end if;
  if status_row.provider_id is null or not status_row.online or not status_row.available
     or status_row.current_mission_id is not null or status_row.last_latitude is null
     or status_row.last_longitude is null or status_row.last_location_at is null
     or status_row.last_location_at<statement_timestamp()-interval '5 minutes'
     or not private.provider_schedule_allows(uid,statement_timestamp()) then
    raise exception 'Provider is no longer available.' using errcode='55000'; end if;
  if offer_row.status<>'pending' or offer_row.expires_at<=statement_timestamp()
     or mission_row.provider_id is not null or mission_row.status not in ('searching','offered') then
    raise exception 'Offer is no longer available.' using errcode='40001'; end if;
  update public.mission_offers set status='expired',responded_at=statement_timestamp()
    where mission_id=mission_row.id and id<>offer_row.id and status='pending';
  update public.mission_offers set status='accepted',responded_at=statement_timestamp() where id=offer_row.id;
  update public.missions set provider_id=uid,status='accepted',accepted_at=statement_timestamp(),
    version=version+1 where id=mission_row.id returning * into mission_row;
  update public.provider_status set available=false,current_mission_id=mission_row.id where provider_id=uid;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role)
    values(mission_row.id,'mission.offer.accepted',uid,'provider');
  return mission_row;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.decline_current_provider_offer(uuid).
CREATE OR REPLACE FUNCTION public.decline_current_provider_offer(target_offer_id uuid)
 RETURNS mission_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); locked_mission_id uuid; offer_row public.mission_offers; mission_row public.missions;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles where provider_id=uid and active) then
    raise exception 'Active provider authentication required.' using errcode='42501'; end if;
  select mission_id into locked_mission_id from public.mission_offers where id=target_offer_id;
  select * into mission_row from public.missions where id=locked_mission_id for update;
  select * into offer_row from public.mission_offers where id=target_offer_id for update;
  if offer_row.id is null or offer_row.provider_id<>uid then raise exception 'Provider offer not found.' using errcode='42501'; end if;
  if offer_row.mission_id is distinct from mission_row.id or offer_row.status<>'pending'
     or offer_row.expires_at<=statement_timestamp() or mission_row.provider_id is not null
     or mission_row.status not in ('searching','offered') then
    raise exception 'Provider offer is unavailable.' using errcode='40001'; end if;
  update public.mission_offers set status='declined',responded_at=statement_timestamp()
    where id=offer_row.id returning * into offer_row;
  update public.missions set status='searching',version=version+1 where id=mission_row.id;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.offer.declined',uid,'provider',jsonb_build_object('offerId',offer_row.id));
  perform private.dispatch_next_mission_offer(mission_row.id);
  return offer_row;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.create_current_provider_activity(text,text,text,text,bigint,bigint).
CREATE OR REPLACE FUNCTION public.create_current_provider_activity(target_service_category text, new_activity_name text, new_activity_description text, new_pricing_model text, new_hourly_rate bigint, new_minimum_charge bigint)
 RETURNS provider_services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  normalized_category text := lower(trim(target_service_category));
  result public.provider_services;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id=uid and pp.active
     ) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if normalized_category is null or normalized_category !~ '^[a-z][a-z0-9-]{1,79}$'
     or new_activity_name is null or char_length(trim(new_activity_name)) not between 2 and 120
     or new_activity_description is null or char_length(trim(new_activity_description)) not between 2 and 500 then
    raise exception 'Invalid activity details.' using errcode='22023';
  end if;
  if new_pricing_model <> 'hourly' then
    raise exception 'Pricing model is not supported in this version.' using errcode='0A000';
  end if;
  if new_hourly_rate is null or new_minimum_charge is null
     or new_hourly_rate not between 1 and 1000000000
     or new_minimum_charge not between 0 and 1000000000000 then
    raise exception 'Invalid hourly pricing.' using errcode='22023';
  end if;

  insert into public.provider_services(
    provider_id,service_category,base_price,currency,enabled,pricing_model,
    hourly_rate,minimum_charge,activity_name,activity_description
  ) values(
    uid,normalized_category,null,'VND',true,'hourly',new_hourly_rate,
    new_minimum_charge,trim(new_activity_name),trim(new_activity_description)
  ) returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Provider activity already exists.' using errcode='23505';
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.create_current_provider_quote_version(uuid,text,integer,jsonb,uuid).
CREATE OR REPLACE FUNCTION public.create_current_provider_quote_version(target_mission_id uuid, new_diagnosis text, new_warranty_days integer, new_items jsonb, target_parent_quote_id uuid DEFAULT NULL::uuid)
 RETURNS quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); mission_row public.missions; parent_row public.quotes; result public.quotes;
  item jsonb; next_version integer; latest_accepted_version integer; total bigint:=0; quote_type public.quote_type; quote_status public.quote_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
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
    if mission_row.status<>'arrived'
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending','accepted')) then
      raise exception 'Initial quote cannot be created.' using errcode='55000';
    end if;
    select coalesce(max(q.version),0)+1 into next_version from public.quotes q where q.mission_id=mission_row.id;
    quote_type:='initial'; quote_status:='pending';
  else
    select * into parent_row from public.quotes where id=target_parent_quote_id and mission_id=mission_row.id for update;
    select max(q.version) into latest_accepted_version from public.quotes q
      where q.mission_id=mission_row.id and q.status='accepted';
    if mission_row.status<>'in_progress' or parent_row.id is null or parent_row.status<>'accepted'
       or parent_row.version is distinct from latest_accepted_version
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
      raise exception 'Latest accepted parent quote required for a new version.' using errcode='55000';
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
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.finish_current_provider_intervention(uuid,integer).
CREATE OR REPLACE FUNCTION public.finish_current_provider_intervention(target_mission_id uuid, expected_version integer)
 RETURNS missions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); mission_row public.missions; accepted_quote public.quotes;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
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
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.get_current_provider_dashboard().
CREATE OR REPLACE FUNCTION public.get_current_provider_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
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
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.get_current_provider_hourly_rate_reference(text).
CREATE OR REPLACE FUNCTION public.get_current_provider_hourly_rate_reference(target_service_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  normalized_category text := lower(trim(target_service_category));
  origin_latitude double precision;
  origin_longitude double precision;
  median_rate bigint;
  comparable_count integer;
  selected_radius_km double precision;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id=uid and pp.active
     ) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if normalized_category is null or normalized_category !~ '^[a-z][a-z0-9-]{1,79}$' then
    raise exception 'Invalid service category.' using errcode='22023';
  end if;

  select ps.last_latitude,ps.last_longitude
    into origin_latitude,origin_longitude
  from public.provider_status ps where ps.provider_id=uid;
  if origin_latitude is null or origin_longitude is null then
    return jsonb_build_object('median_hourly_rate',null,'provider_count',0,'radius_km',null);
  end if;

  with comparable_missions as (
    select
      m.id as mission_id,
      m.provider_id,
      coalesce(m.completed_at,mi.submitted_at,m.requested_at) as completed_at,
      mi.hourly_rate,
      2 * 6371 * asin(sqrt(least(1::double precision,
        power(sin(radians((m.client_latitude-origin_latitude)/2)),2)
        + cos(radians(origin_latitude))*cos(radians(m.client_latitude))
        * power(sin(radians((m.client_longitude-origin_longitude)/2)),2)
      ))) as distance_km
    from public.missions m
    join public.mission_invoices mi on mi.mission_id=m.id
      and mi.provider_id=m.provider_id
      and mi.pricing_model='hourly'
    where m.status='completed'
      and m.service_category=normalized_category
      and m.provider_id is not null
      and m.provider_id<>uid
      and m.client_latitude is not null
      and m.client_longitude is not null
  ), radii(radius_km,priority) as (
    values (5::double precision,1),(10::double precision,2),(20::double precision,3)
  )
  select r.radius_km into selected_radius_km
  from radii r
  where exists(select 1 from comparable_missions cm where cm.distance_km<=r.radius_km)
  order by r.priority limit 1;

  if selected_radius_km is null then
    return jsonb_build_object('median_hourly_rate',null,'provider_count',0,'radius_km',null);
  end if;

  with comparable_missions as (
    select
      m.id as mission_id,
      m.provider_id,
      coalesce(m.completed_at,mi.submitted_at,m.requested_at) as completed_at,
      mi.hourly_rate,
      2 * 6371 * asin(sqrt(least(1::double precision,
        power(sin(radians((m.client_latitude-origin_latitude)/2)),2)
        + cos(radians(origin_latitude))*cos(radians(m.client_latitude))
        * power(sin(radians((m.client_longitude-origin_longitude)/2)),2)
      ))) as distance_km
    from public.missions m
    join public.mission_invoices mi on mi.mission_id=m.id
      and mi.provider_id=m.provider_id
      and mi.pricing_model='hourly'
    where m.status='completed'
      and m.service_category=normalized_category
      and m.provider_id is not null
      and m.provider_id<>uid
      and m.client_latitude is not null
      and m.client_longitude is not null
  ), latest_mission_per_provider as (
    select distinct on (cm.provider_id)
      cm.provider_id,cm.hourly_rate,cm.completed_at,cm.mission_id
    from comparable_missions cm
    where cm.distance_km<=selected_radius_km
    order by cm.provider_id,cm.completed_at desc,cm.mission_id desc
  ), recent_unique_providers as (
    select lm.provider_id,lm.hourly_rate
    from latest_mission_per_provider lm
    order by lm.completed_at desc,lm.mission_id desc
    limit 50
  )
  select round(percentile_cont(0.5) within group(order by hourly_rate)::numeric)::bigint,
         count(*)::integer
    into median_rate,comparable_count
  from recent_unique_providers;

  return jsonb_build_object(
    'median_hourly_rate',median_rate,
    'provider_count',coalesce(comparable_count,0),
    'radius_km',selected_radius_km
  );
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.get_current_provider_quote_state().
CREATE OR REPLACE FUNCTION public.get_current_provider_quote_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object('id',q.id,'version',q.version,'status',q.status,'diagnosis',q.diagnosis,
    'totalAmount',q.total_amount,'currency',q.currency,'warrantyDays',q.warranty_days,
    'items',coalesce((select jsonb_agg(jsonb_build_object('itemType',qi.item_type,'description',qi.description,'amount',qi.amount,'position',qi.position) order by qi.position) from public.quote_items qi where qi.quote_id=q.id),'[]'::jsonb))
  into result from public.quotes q join public.missions m on m.id=q.mission_id
  where m.provider_id=uid and m.status not in ('completed','cancelled','expired')
  order by q.version desc limit 1;
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.get_matching_provider_candidates(text,double precision,double precision,integer,interval).
CREATE OR REPLACE FUNCTION public.get_matching_provider_candidates(requested_service_category text, customer_latitude double precision, customer_longitude double precision, candidate_limit integer DEFAULT 20, maximum_location_age interval DEFAULT '00:05:00'::interval)
 RETURNS TABLE(provider_id uuid, display_name text, avatar_url text, specialty text, service_category text, base_price bigint, currency character, service_radius_km numeric, rating_average numeric, review_count integer, completed_jobs integer, reliability_score numeric, description text, languages text[], latitude double precision, longitude double precision, last_location_at timestamp with time zone, straight_line_distance_km double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id,'customer') then
    raise exception 'Active customer authentication required.' using errcode='42501'; end if;
  if nullif(trim(requested_service_category),'') is null
     or customer_latitude not between -90 and 90 or customer_longitude not between -180 and 180
     or candidate_limit not between 1 and 50 or maximum_location_age < interval '1 minute'
     or maximum_location_age > interval '15 minutes' then
    raise exception 'Invalid matching parameters.' using errcode='22023'; end if;
  return query with eligible as (
    select pp.provider_id,p.display_name,p.avatar_url,pp.specialty,svc.service_category,
      svc.base_price,svc.currency,pp.service_radius_km,pp.rating_average,pp.review_count,
      pp.completed_jobs,pp.reliability_score,pp.description,pp.languages,
      pst.last_latitude,pst.last_longitude,pst.last_location_at,
      private.straight_line_distance_km(customer_latitude,customer_longitude,
        pst.last_latitude,pst.last_longitude) distance_km
    from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
    join public.provider_services svc on svc.provider_id=pp.provider_id
    join public.provider_status pst on pst.provider_id=pp.provider_id
    where svc.service_category=trim(requested_service_category) and svc.enabled and pp.active and p.status='active'
      and pst.online and pst.available and pst.current_mission_id is null
      and pst.last_latitude is not null and pst.last_longitude is not null
      and pst.last_location_at >= statement_timestamp()-maximum_location_age
      and private.provider_v1_onboarding_complete(pp.provider_id)
      and private.provider_schedule_allows(pp.provider_id,statement_timestamp())
  ) select e.provider_id,e.display_name,e.avatar_url,e.specialty,e.service_category,
    e.base_price,e.currency,e.service_radius_km,e.rating_average,e.review_count,e.completed_jobs,
    e.reliability_score,e.description,e.languages,e.last_latitude,e.last_longitude,
    e.last_location_at,e.distance_km from eligible e where e.distance_km<=e.service_radius_km
  order by e.distance_km,e.reliability_score desc,e.rating_average desc,e.completed_jobs desc,e.provider_id
  limit candidate_limit;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.get_provider_professional_profile(uuid,uuid).
CREATE OR REPLACE FUNCTION public.get_provider_professional_profile(target_provider_id uuid, target_mission_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=(select auth.uid()); result jsonb;
begin
  if uid is null then
    raise exception 'Authentication required.' using errcode='42501';
  end if;

  select jsonb_build_object(
    'providerId',pp.provider_id,'name',case when pp.professional_profile_updated_at is null then
      coalesce((select s.full_name from public.provider_kyc_submissions s
        where s.provider_id=pp.provider_id and s.status='verified'),p.display_name)
      else p.display_name end,'avatarPath',pp.avatar_storage_path,
    'verified',pp.kyc_status='verified','ratingAverage',pp.rating_average,
    'reviewCount',pp.review_count,'experienceYears',pp.experience_years,
    'introduction',pp.description,
    'activities',coalesce((select jsonb_agg(jsonb_build_object(
      'serviceCategory',ps.service_category,'name',coalesce(ps.activity_name,ps.service_category),
      'description',ps.activity_description) order by coalesce(ps.activity_name,ps.service_category))
      from public.provider_services ps where ps.provider_id=pp.provider_id and ps.enabled),'[]'::jsonb)
  ) into result
  from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  where pp.provider_id=target_provider_id and pp.active and p.status='active';

  if result is null then
    raise exception 'Provider profile not found.' using errcode='42501';
  end if;
  return result;
end;
$function$
;

-- V1 removes only the KYC eligibility predicate from public.set_current_provider_availability(boolean,boolean,double precision,double precision).
CREATE OR REPLACE FUNCTION public.set_current_provider_availability(new_online boolean, new_available boolean, new_latitude double precision DEFAULT NULL::double precision, new_longitude double precision DEFAULT NULL::double precision)
 RETURNS provider_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  result public.provider_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active
     ) then
    raise exception 'Active provider authentication required.' using errcode = '42501';
  end if;

  if new_online and not private.provider_v1_onboarding_complete(uid) then
    raise exception 'Provider onboarding is incomplete.' using errcode='55000';
  end if;

  update public.provider_status
  set online = new_online,
      available = new_online and current_mission_id is null
  where provider_id = uid
  returning * into result;

  if result.provider_id is null then
    raise exception 'Provider status is unavailable.' using errcode = '55000';
  end if;
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.set_current_provider_service_hourly_pricing(text,bigint,bigint).
CREATE OR REPLACE FUNCTION public.set_current_provider_service_hourly_pricing(target_service_category text, new_hourly_rate bigint, new_minimum_charge bigint)
 RETURNS provider_services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); result public.provider_services;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_hourly_rate is null or new_minimum_charge is null
     or new_hourly_rate not between 1 and 1000000000
     or new_minimum_charge not between 0 and 1000000000000 then
    raise exception 'Invalid hourly pricing.' using errcode='22023';
  end if;
  update public.provider_services
    set pricing_model='hourly',hourly_rate=new_hourly_rate,minimum_charge=new_minimum_charge,
        updated_at=statement_timestamp()
    where provider_id=uid and service_category=trim(target_service_category) and enabled
    returning * into result;
  if result.id is null then raise exception 'Provider service not found.' using errcode='42501'; end if;
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.start_current_provider_intervention(uuid,integer).
CREATE OR REPLACE FUNCTION public.start_current_provider_intervention(target_mission_id uuid, expected_version integer)
 RETURNS missions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions;
  service_row public.provider_services;
  accepted_quote public.quotes;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;

  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then
    raise exception 'Assigned mission not found.' using errcode='42501';
  end if;
  select * into service_row from public.provider_services
    where provider_id=uid and service_category=mission_row.service_category and enabled for update;
  if service_row.id is null then
    raise exception 'Provider service not found.' using errcode='55000';
  end if;

  if service_row.pricing_model='hourly' then
    if service_row.hourly_rate is null or service_row.minimum_charge is null
       or mission_row.version is distinct from expected_version or mission_row.status<>'arrived'
       or mission_row.started_at is not null
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending'))
       or exists(select 1 from public.mission_invoices mi where mi.mission_id=mission_row.id) then
      raise exception 'Hourly mission is not ready to start.' using errcode='40001';
    end if;
  else
    select * into accepted_quote from public.quotes q
      where q.mission_id=target_mission_id and q.status='accepted'
      order by q.version desc limit 1;
    if mission_row.version is distinct from expected_version or mission_row.status<>'quote_pending'
       or accepted_quote.id is null or accepted_quote.type<>'initial'
       or mission_row.final_authorized_amount is distinct from accepted_quote.total_amount
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
      raise exception 'Mission is not ready to start.' using errcode='40001';
    end if;
  end if;

  update public.missions set status='in_progress',started_at=statement_timestamp(),version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.intervention.started',uid,'provider',
      case when service_row.pricing_model='hourly'
        then jsonb_build_object('pricingModel','hourly')
        else jsonb_build_object('quoteId',accepted_quote.id,'quoteVersion',accepted_quote.version)
      end);
  return mission_row;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.submit_current_provider_hourly_invoice(uuid,integer,integer,integer,bigint).
CREATE OR REPLACE FUNCTION public.submit_current_provider_hourly_invoice(target_mission_id uuid, expected_version integer, new_worked_hours integer, new_worked_minutes integer, new_material_amount bigint DEFAULT 0)
 RETURNS mission_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions; service_row public.provider_services;
  existing_invoice public.mission_invoices; result public.mission_invoices;
  total_worked_minutes integer; calculated_labor bigint;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_worked_hours is null or new_worked_minutes is null or new_material_amount is null
     or new_worked_hours not between 0 and 168 or new_worked_minutes not between 0 and 59
     or new_material_amount not between 0 and 1000000000000 then
    raise exception 'Invalid invoice values.' using errcode='22023';
  end if;
  total_worked_minutes:=new_worked_hours*60+new_worked_minutes;
  if total_worked_minutes not between 1 and 10080 then
    raise exception 'Worked duration must be between 1 minute and 168 hours.' using errcode='22023';
  end if;

  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then
    raise exception 'Assigned mission not found.' using errcode='42501';
  end if;
  select * into existing_invoice from public.mission_invoices where mission_id=mission_row.id;
  if existing_invoice.id is not null then
    if existing_invoice.provider_id=uid and existing_invoice.worked_minutes=total_worked_minutes
       and existing_invoice.material_amount=new_material_amount then return existing_invoice; end if;
    raise exception 'Mission invoice was already submitted.' using errcode='40001';
  end if;
  select * into service_row from public.provider_services
    where provider_id=uid and service_category=mission_row.service_category and enabled for update;
  if service_row.id is null or service_row.pricing_model<>'hourly'
     or service_row.hourly_rate is null or service_row.minimum_charge is null
     or service_row.hourly_rate not between 1 and 1000000000
     or service_row.minimum_charge not between 0 and 1000000000000 then
    raise exception 'Hourly pricing is not configured for this service.' using errcode='55000';
  end if;
  if mission_row.version is distinct from expected_version or mission_row.status<>'in_progress'
     or mission_row.started_at is null or mission_row.currency is distinct from service_row.currency
     or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
    raise exception 'Mission is not ready for invoicing.' using errcode='40001';
  end if;

  calculated_labor:=greatest(service_row.minimum_charge,
    ((service_row.hourly_rate*total_worked_minutes+30)/60));
  insert into public.mission_invoices(
    mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,
    hourly_rate,minimum_charge,labor_amount,material_amount,total_amount,currency
  ) values(
    mission_row.id,uid,mission_row.client_id,service_row.id,'hourly',total_worked_minutes,
    service_row.hourly_rate,service_row.minimum_charge,calculated_labor,new_material_amount,
    calculated_labor+new_material_amount,service_row.currency
  ) returning * into result;
  update public.missions
    set final_authorized_amount=result.total_amount,status='completed_pending_payment',version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.invoice.submitted',uid,'provider',jsonb_build_object(
      'invoiceId',result.id,'pricingModel',result.pricing_model,'workedMinutes',result.worked_minutes,
      'hourlyRate',result.hourly_rate,'minimumCharge',result.minimum_charge,
      'laborAmount',result.labor_amount,'materialAmount',result.material_amount,'totalAmount',result.total_amount
    ));
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.update_current_provider_activity(uuid,bigint,bigint,boolean).
CREATE OR REPLACE FUNCTION public.update_current_provider_activity(target_provider_service_id uuid, new_hourly_rate bigint, new_minimum_charge bigint, new_enabled boolean)
 RETURNS provider_services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  current_activity public.provider_services;
  result public.provider_services;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active
     ) then
    raise exception 'Active provider authentication required.' using errcode = '42501';
  end if;

  if target_provider_service_id is null or new_hourly_rate is null
     or new_minimum_charge is null or new_enabled is null
     or new_hourly_rate not between 1 and 1000000000
     or new_minimum_charge not between 0 and 1000000000000 then
    raise exception 'Invalid activity settings.' using errcode = '22023';
  end if;

  select * into current_activity
  from public.provider_services
  where id = target_provider_service_id and provider_id = uid
  for update;

  if current_activity.id is null then
    raise exception 'Provider activity not found.' using errcode = '42501';
  end if;
  if current_activity.pricing_model <> 'hourly' then
    raise exception 'Pricing model is not supported in this version.' using errcode = '0A000';
  end if;

  update public.provider_services
  set hourly_rate = new_hourly_rate,
      minimum_charge = new_minimum_charge,
      enabled = new_enabled,
      updated_at = statement_timestamp()
  where id = current_activity.id and provider_id = uid
  returning * into result;

  return result;
end;
$function$
;

-- V1 removes only the KYC eligibility predicate from public.update_current_provider_location(double precision,double precision).
CREATE OR REPLACE FUNCTION public.update_current_provider_location(new_latitude double precision, new_longitude double precision)
 RETURNS provider_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  result public.provider_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active
     ) then
    raise exception 'Active provider authentication required.' using errcode = '42501';
  end if;

  if new_latitude is null or new_longitude is null
     or new_latitude not between -90 and 90
     or new_longitude not between -180 and 180 then
    raise exception 'Invalid provider coordinates.' using errcode = '22023';
  end if;

  update public.provider_status
  set last_latitude = new_latitude,
      last_longitude = new_longitude,
      last_location_at = statement_timestamp()
  where provider_id = uid
  returning * into result;

  if result.provider_id is null then
    raise exception 'Provider status is unavailable.' using errcode = '55000';
  end if;
  return result;
end $function$
;

-- V1 removes only the KYC eligibility predicate from public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision).
CREATE OR REPLACE FUNCTION public.update_current_provider_mission_progress(target_mission_id uuid, new_status mission_status, new_latitude double precision, new_longitude double precision)
 RETURNS missions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid()); mission_row public.missions; distance_km double precision;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists (select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if (new_latitude is null) <> (new_longitude is null) or (new_status='travelling' and new_latitude is null) or new_latitude not between -90 and 90 or new_longitude not between -180 and 180 then raise exception 'Valid provider coordinates required.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if not ((mission_row.status='accepted' and new_status='travelling') or (mission_row.status='travelling' and new_status='arrived')) then raise exception 'Invalid mission transition.' using errcode='22023'; end if;
  if not exists (select 1 from public.provider_status ps where ps.provider_id=uid and ps.current_mission_id=mission_row.id) then raise exception 'Provider mission relationship is invalid.' using errcode='55000'; end if;
  if new_status='arrived' then
    distance_km:=6371*2*asin(sqrt(power(sin(radians(mission_row.client_latitude-new_latitude)/2),2)+cos(radians(new_latitude))*cos(radians(mission_row.client_latitude))*power(sin(radians(mission_row.client_longitude-new_longitude)/2),2)));

  end if;
  update public.provider_status set last_latitude=coalesce(new_latitude,last_latitude),last_longitude=coalesce(new_longitude,last_longitude),last_location_at=case when new_latitude is not null then statement_timestamp() else last_location_at end,available=false where provider_id=uid and current_mission_id=mission_row.id;
  update public.missions set status=new_status,travelling_at=case when new_status='travelling' then statement_timestamp() else travelling_at end,
    arrived_at=case when new_status='arrived' then statement_timestamp() else arrived_at end,version=version+1
    where id=mission_row.id and provider_id=uid returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload) values(mission_row.id,case when new_status='travelling' then 'mission.provider.travelling' else 'mission.provider.arrived' end,uid,'provider',case when new_status='arrived' then jsonb_build_object('observed_distance_km',distance_km,'arrival_mode',case when distance_km is null or distance_km>0.15 then 'manual' else 'gps' end) else '{}'::jsonb end);
  return mission_row;
end $function$
;

-- Active Provider catalogue visibility no longer depends on KYC in V1.
drop policy if exists provider_profiles_select_visible on public.provider_profiles;
create policy provider_profiles_select_visible on public.provider_profiles for select to authenticated
using (provider_id=(select auth.uid()) or (select private.is_admin()) or active);

drop policy if exists provider_services_select_visible on public.provider_services;
create policy provider_services_select_visible on public.provider_services for select to authenticated
using (provider_id=(select auth.uid()) or (select private.is_admin()) or (enabled and exists(
  select 1 from public.provider_profiles pp where pp.provider_id=provider_services.provider_id and pp.active
)));
