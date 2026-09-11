-- Provider-controlled weekly availability. Online/offline remains authoritative.

create table public.provider_availability_preferences (
  provider_id uuid primary key references public.provider_profiles(provider_id) on delete cascade,
  availability_mode text not null default 'manual'
    check (availability_mode in ('manual','scheduled')),
  available_24h boolean not null default false,
  weekly_schedule jsonb not null default '[]'::jsonb
    check (jsonb_typeof(weekly_schedule) = 'array'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.provider_availability_preferences enable row level security;

create policy provider_availability_preferences_select_self
on public.provider_availability_preferences for select to authenticated
using (provider_id = (select auth.uid()));

create policy provider_availability_preferences_admin_all
on public.provider_availability_preferences for all to authenticated
using (private.is_admin()) with check (private.is_admin());

revoke all on table public.provider_availability_preferences from public, anon;
grant select on table public.provider_availability_preferences to authenticated;

create or replace function private.valid_provider_weekly_schedule(input_schedule jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare item jsonb; seen_days integer[] := '{}'; day_number integer; start_value time; end_value time;
begin
  if jsonb_typeof(input_schedule) <> 'array' or jsonb_array_length(input_schedule) > 7 then return false; end if;
  for item in select entry from jsonb_array_elements(input_schedule) as items(entry) loop
    if jsonb_typeof(item) <> 'object'
       or not (item ? 'day' and item ? 'start' and item ? 'end')
       or (select count(*) from jsonb_object_keys(item)) <> 3 then return false; end if;
    begin
      day_number := (item->>'day')::integer;
      start_value := (item->>'start')::time;
      end_value := (item->>'end')::time;
    exception when others then return false;
    end;
    if day_number not between 0 and 6 or day_number = any(seen_days)
       or start_value = end_value then return false; end if;
    seen_days := array_append(seen_days, day_number);
  end loop;
  return true;
end $$;

revoke all on function private.valid_provider_weekly_schedule(jsonb) from public, anon, authenticated;

alter table public.provider_availability_preferences
  add constraint provider_availability_weekly_schedule_valid
  check (private.valid_provider_weekly_schedule(weekly_schedule));

create or replace function private.provider_schedule_allows(
  target_provider_id uuid,
  target_instant timestamptz default statement_timestamp()
) returns boolean language sql stable security definer set search_path = '' as $$
  with preference as (
    select availability_mode, available_24h, weekly_schedule
    from public.provider_availability_preferences where provider_id = target_provider_id
  ), local_clock as (
    select extract(dow from target_instant at time zone 'Asia/Ho_Chi_Minh')::integer as day_number,
      (target_instant at time zone 'Asia/Ho_Chi_Minh')::time as local_time
  ), slots as (
    select (slot->>'day')::integer as day_number,
      (slot->>'start')::time as start_time, (slot->>'end')::time as end_time
    from preference, jsonb_array_elements(weekly_schedule) slot
  )
  select coalesce((select availability_mode = 'manual' or available_24h or exists (
    select 1 from slots, local_clock
    where (start_time < end_time and slots.day_number = local_clock.day_number
      and local_time >= start_time and local_time < end_time)
      or (start_time > end_time and (
        (slots.day_number = local_clock.day_number and local_time >= start_time)
        or ((slots.day_number + 1) % 7 = local_clock.day_number and local_time < end_time)
      ))
  ) from preference), true)
$$;

revoke all on function private.provider_schedule_allows(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.get_current_provider_availability_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object('mode',availability_mode,'available_24h',available_24h,
    'weekly_schedule',weekly_schedule) into result
  from public.provider_availability_preferences where provider_id=uid;
  return coalesce(result,jsonb_build_object('mode','manual','available_24h',false,'weekly_schedule','[]'::jsonb));
end $$;

create or replace function public.set_current_provider_availability_preferences(
  new_mode text,
  new_available_24h boolean,
  new_weekly_schedule jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb; normalized_schedule jsonb := coalesce(new_weekly_schedule,'[]'::jsonb);
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  if new_mode not in ('manual','scheduled') or new_available_24h is null
     or not private.valid_provider_weekly_schedule(normalized_schedule)
     or (new_mode='scheduled' and not new_available_24h and jsonb_array_length(normalized_schedule)=0) then
    raise exception 'Invalid provider availability preferences.' using errcode='22023';
  end if;
  insert into public.provider_availability_preferences(provider_id,availability_mode,available_24h,weekly_schedule)
  values(uid,new_mode,new_available_24h,normalized_schedule)
  on conflict(provider_id) do update set availability_mode=excluded.availability_mode,
    available_24h=excluded.available_24h,weekly_schedule=excluded.weekly_schedule,
    updated_at=statement_timestamp();
  select jsonb_build_object('mode',availability_mode,'available_24h',available_24h,
    'weekly_schedule',weekly_schedule) into result
  from public.provider_availability_preferences where provider_id=uid;
  return result;
end $$;

revoke all on function public.get_current_provider_availability_preferences() from public, anon;
revoke all on function public.set_current_provider_availability_preferences(text,boolean,jsonb) from public, anon;
grant execute on function public.get_current_provider_availability_preferences() to authenticated;
grant execute on function public.set_current_provider_availability_preferences(text,boolean,jsonb) to authenticated;

-- Customer preselection: all former filters remain, then the weekly schedule.
create or replace function public.get_matching_provider_candidates(
  requested_service_category text, customer_latitude double precision,
  customer_longitude double precision, candidate_limit integer default 20,
  maximum_location_age interval default interval '5 minutes'
) returns table (
  provider_id uuid, display_name text, avatar_url text, specialty text,
  service_category text, base_price bigint, currency character(3), service_radius_km numeric,
  rating_average numeric, review_count integer, completed_jobs integer,
  reliability_score numeric, description text, languages text[], latitude double precision,
  longitude double precision, last_location_at timestamptz, straight_line_distance_km double precision
) language plpgsql stable security definer set search_path = '' as $$
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
    where svc.service_category=trim(requested_service_category) and svc.enabled
      and pp.kyc_status='verified' and pp.active and p.status='active'
      and pst.online and pst.available and pst.current_mission_id is null
      and pst.last_latitude is not null and pst.last_longitude is not null
      and pst.last_location_at >= statement_timestamp()-maximum_location_age
      and private.provider_schedule_allows(pp.provider_id,statement_timestamp())
  ) select e.provider_id,e.display_name,e.avatar_url,e.specialty,e.service_category,
    e.base_price,e.currency,e.service_radius_km,e.rating_average,e.review_count,e.completed_jobs,
    e.reliability_score,e.description,e.languages,e.last_latitude,e.last_longitude,
    e.last_location_at,e.distance_km from eligible e where e.distance_km<=e.service_radius_km
  order by e.distance_km,e.reliability_score desc,e.rating_average desc,e.completed_jobs desc,e.provider_id
  limit candidate_limit;
end $$;

create or replace function private.dispatch_next_mission_offer(
  target_mission_id uuid, offer_lifetime interval default interval '2 minutes',
  maximum_location_age interval default interval '5 minutes'
) returns public.mission_offers language plpgsql security definer set search_path = '' as $$
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
      and pp.active and pp.kyc_status='verified' and p.status='active'
      and pst.online and pst.available and pst.current_mission_id is null
      and pst.last_latitude is not null and pst.last_longitude is not null
      and pst.last_location_at>=statement_timestamp()-maximum_location_age
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
end $$;

revoke all on function private.dispatch_next_mission_offer(uuid,interval,interval) from public,anon,authenticated;

create or replace function public.accept_current_provider_offer(target_offer_id uuid)
returns public.missions language plpgsql security definer set search_path = '' as $$
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
     or provider_row.provider_id is null or not provider_row.active or provider_row.kyc_status<>'verified'
     or service_row.id is null or not service_row.enabled then
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
end $$;

revoke all on function public.get_matching_provider_candidates(text,double precision,double precision,integer,interval) from public,anon;
revoke all on function public.accept_current_provider_offer(uuid) from public,anon;
grant execute on function public.get_matching_provider_candidates(text,double precision,double precision,integer,interval) to authenticated;
grant execute on function public.accept_current_provider_offer(uuid) to authenticated;
