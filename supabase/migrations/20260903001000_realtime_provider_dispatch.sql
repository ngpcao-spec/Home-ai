-- Server-owned sequential dispatch with Realtime delivery.
-- Do not deploy without a dedicated remote audit.

create or replace function private.dispatch_next_mission_offer(
  target_mission_id uuid,
  offer_lifetime interval default interval '2 minutes',
  maximum_location_age interval default interval '5 minutes'
)
returns public.mission_offers language plpgsql security definer set search_path = '' as $$
declare mission_row public.missions; candidate record; result public.mission_offers;
begin
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is not null
     or mission_row.status not in ('requested','searching','offered') then return null; end if;

  select c.* into candidate
  from (
    select pp.provider_id,
      private.straight_line_distance_km(mission_row.client_latitude,mission_row.client_longitude,
        pst.last_latitude,pst.last_longitude) distance_km,
      pp.reliability_score,pp.rating_average,pp.completed_jobs
    from public.provider_profiles pp
    join public.profiles p on p.user_id=pp.provider_id
    join public.provider_services svc on svc.provider_id=pp.provider_id
    join public.provider_status pst on pst.provider_id=pp.provider_id
    where svc.service_category=mission_row.service_category and svc.enabled
      and pp.active and pp.kyc_status='verified' and p.status='active'
      and pst.online and pst.available and pst.current_mission_id is null
      and pst.last_latitude is not null and pst.last_longitude is not null
      and pst.last_location_at >= statement_timestamp()-maximum_location_age
      and not exists(select 1 from public.mission_offers previous
        where previous.mission_id=mission_row.id and previous.provider_id=pp.provider_id)
  ) c
  where c.distance_km <= (select service_radius_km from public.provider_profiles where provider_id=c.provider_id)
  order by c.distance_km,c.reliability_score desc,c.rating_average desc,c.completed_jobs desc,c.provider_id
  limit 1;

  if candidate.provider_id is null then
    update public.missions set status='searching',version=version+1
      where id=mission_row.id and status<>'searching';
    return null;
  end if;
  insert into public.mission_offers(mission_id,provider_id,status,offered_at,expires_at,
    straight_line_distance_km,match_rank)
  values(mission_row.id,candidate.provider_id,'pending',statement_timestamp(),statement_timestamp()+offer_lifetime,
    candidate.distance_km,1) returning * into result;
  update public.missions set status='offered',version=version+1 where id=mission_row.id;
  insert into public.mission_events(mission_id,event_type,actor_role,payload)
    values(mission_row.id,'mission.offer.dispatched',null,jsonb_build_object('offerId',result.id));
  return result;
end $$;

revoke all on function private.dispatch_next_mission_offer(uuid,interval,interval) from public,anon,authenticated;

create or replace function public.accept_current_provider_offer(target_offer_id uuid)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  lock_mission_id uuid; lock_provider_id uuid;
  mission_row public.missions; offer_row public.mission_offers;
  profile_row public.profiles; provider_row public.provider_profiles;
  status_row public.provider_status; service_row public.provider_services;
begin
  if uid is null or (select auth.role())<>'authenticated'
     or not private.profile_has_role(uid,'provider') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;

  -- Unlocked identifiers choose locks only. Every decision uses the rows reread below.
  select mission_id,provider_id into lock_mission_id,lock_provider_id
    from public.mission_offers where id=target_offer_id;
  if lock_provider_id is distinct from uid then
    raise exception 'Provider offer not found.' using errcode='42501';
  end if;

  -- Global order: mission -> profile -> provider profile -> provider status ->
  -- service -> offer. Mission-first also matches decline/timeout/sweeper.
  select * into mission_row from public.missions where id=lock_mission_id for update;
  select * into profile_row from public.profiles where user_id=uid for update;
  select * into provider_row from public.provider_profiles where provider_id=uid for update;
  select * into status_row from public.provider_status where provider_id=uid for update;
  select * into service_row from public.provider_services
    where provider_id=uid and service_category=mission_row.service_category for update;
  select * into offer_row from public.mission_offers where id=target_offer_id for update;

  if offer_row.id is null or offer_row.provider_id is distinct from uid
     or offer_row.mission_id is distinct from mission_row.id then
    raise exception 'Provider offer not found.' using errcode='42501';
  end if;
  if profile_row.user_id is null or profile_row.role<>'provider' or profile_row.status<>'active'
     or provider_row.provider_id is null or not provider_row.active or provider_row.kyc_status<>'verified'
     or service_row.id is null or not service_row.enabled then
    raise exception 'Provider is no longer eligible.' using errcode='55000';
  end if;
  if status_row.provider_id is null or not status_row.online or not status_row.available
     or status_row.current_mission_id is not null
     or status_row.last_latitude is null or status_row.last_longitude is null
     or status_row.last_location_at is null
     or status_row.last_location_at < statement_timestamp()-interval '5 minutes' then
    raise exception 'Provider is no longer available.' using errcode='55000';
  end if;
  if offer_row.status<>'pending' or offer_row.expires_at<=statement_timestamp()
     or mission_row.provider_id is not null or mission_row.status not in ('searching','offered') then
    raise exception 'Offer is no longer available.' using errcode='40001';
  end if;

  update public.mission_offers set status='expired',responded_at=statement_timestamp()
    where mission_id=mission_row.id and id<>offer_row.id and status='pending';
  update public.mission_offers set status='accepted',responded_at=statement_timestamp()
    where id=offer_row.id;
  update public.missions set provider_id=uid,status='accepted',accepted_at=statement_timestamp(),
    version=version+1 where id=mission_row.id returning * into mission_row;
  update public.provider_status set available=false,current_mission_id=mission_row.id
    where provider_id=uid;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role)
    values(mission_row.id,'mission.offer.accepted',uid,'provider');
  return mission_row;
end $$;

revoke all on function public.accept_current_provider_offer(uuid) from public,anon;
grant execute on function public.accept_current_provider_offer(uuid) to authenticated;

create or replace function public.create_current_customer_mission_offers(
  target_mission_id uuid,offer_limit integer default 10,
  offer_lifetime interval default interval '2 minutes',maximum_location_age interval default interval '5 minutes'
)
returns setof public.mission_offers language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; dispatched public.mission_offers;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Active customer authentication required.' using errcode='42501'; end if;
  if offer_limit not between 1 and 25 or offer_lifetime<interval '30 seconds' or offer_lifetime>interval '10 minutes'
     or maximum_location_age<interval '1 minute' or maximum_location_age>interval '15 minutes' then
    raise exception 'Invalid offer parameters.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.client_id<>uid then
    raise exception 'Customer mission not found.' using errcode='42501'; end if;
  if mission_row.provider_id is not null or mission_row.status not in ('requested','searching','offered') then
    raise exception 'Mission is not available for matching.' using errcode='55000'; end if;
  update public.mission_offers set status='expired',responded_at=statement_timestamp()
    where mission_id=mission_row.id and status='pending' and expires_at<=statement_timestamp();
  if exists(select 1 from public.mission_offers where mission_id=mission_row.id and status='pending' and expires_at>statement_timestamp()) then
    return query select * from public.mission_offers where mission_id=mission_row.id and status='pending' and expires_at>statement_timestamp();
    return;
  end if;
  dispatched:=private.dispatch_next_mission_offer(mission_row.id,offer_lifetime,maximum_location_age);
  if dispatched.id is not null then return next dispatched; end if;
end $$;

revoke all on function public.create_current_customer_mission_offers(uuid,integer,interval,interval) from public,anon;
grant execute on function public.create_current_customer_mission_offers(uuid,integer,interval,interval) to authenticated;

create or replace function public.decline_current_provider_offer(target_offer_id uuid)
returns public.mission_offers language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); locked_mission_id uuid; offer_row public.mission_offers; mission_row public.missions;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles where provider_id=uid and active and kyc_status='verified') then
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
end $$;

revoke all on function public.decline_current_provider_offer(uuid) from public,anon;
grant execute on function public.decline_current_provider_offer(uuid) to authenticated;

create or replace function public.expire_current_mission_offer_and_rematch(target_offer_id uuid)
returns public.mission_offers language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); locked_mission_id uuid; offer_row public.mission_offers; mission_row public.missions;
begin
  if uid is null or (select auth.role())<>'authenticated' then raise exception 'Authentication required.' using errcode='42501'; end if;
  select mission_id into locked_mission_id from public.mission_offers where id=target_offer_id;
  select * into mission_row from public.missions where id=locked_mission_id for update;
  select * into offer_row from public.mission_offers where id=target_offer_id for update;
  if offer_row.id is null or mission_row.id is null or offer_row.mission_id is distinct from mission_row.id
     or not (
       (offer_row.provider_id=uid and private.profile_has_role(uid,'provider'))
       or (mission_row.client_id=uid and private.profile_has_role(uid,'customer'))
     ) then
    raise exception 'Related offer not found.' using errcode='42501'; end if;
  if offer_row.status<>'pending' then return offer_row; end if;
  if offer_row.expires_at>statement_timestamp() then raise exception 'Offer has not expired.' using errcode='55000'; end if;
  update public.mission_offers set status='expired',responded_at=statement_timestamp()
    where id=offer_row.id returning * into offer_row;
  if mission_row.provider_id is null and mission_row.status in ('searching','offered') then
    update public.missions set status='searching',version=version+1 where id=mission_row.id;
    insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
      values(mission_row.id,'mission.offer.expired',uid,
        case when offer_row.provider_id=uid then 'provider'::public.app_role else 'customer'::public.app_role end,
        jsonb_build_object('offerId',offer_row.id));
    perform private.dispatch_next_mission_offer(mission_row.id);
  end if;
  return offer_row;
end $$;

revoke all on function public.expire_current_mission_offer_and_rematch(uuid) from public,anon;
grant execute on function public.expire_current_mission_offer_and_rematch(uuid) to authenticated;

create or replace function private.expire_due_mission_offers(batch_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare candidate record; mission_row public.missions; offer_row public.mission_offers; processed integer:=0;
begin
  if batch_limit not between 1 and 500 then raise exception 'Invalid batch limit.' using errcode='22023'; end if;
  for candidate in
    select distinct mo.mission_id from public.mission_offers mo
    where mo.status='pending' and mo.expires_at<=statement_timestamp()
    order by mo.mission_id limit batch_limit
  loop
    -- Never lock an offer before its mission: this is the same order as accept/refuse.
    select * into mission_row from public.missions where id=candidate.mission_id
      for update skip locked;
    if mission_row.id is null then continue; end if;
    select * into offer_row from public.mission_offers
      where mission_id=mission_row.id and status='pending'
        and expires_at<=statement_timestamp()
      order by expires_at,id limit 1 for update;
    if offer_row.id is null then continue; end if;
    update public.mission_offers set status='expired',responded_at=statement_timestamp()
      where id=offer_row.id and status='pending';
    processed:=processed+1;
    insert into public.mission_events(mission_id,event_type,actor_role,payload)
      values(mission_row.id,'mission.offer.expired',null,jsonb_build_object('offerId',offer_row.id,'source','cron'));
    if mission_row.provider_id is null and mission_row.status in ('searching','offered') then
      update public.missions set status='searching',version=version+1 where id=mission_row.id;
      perform private.dispatch_next_mission_offer(mission_row.id);
    end if;
  end loop;
  return processed;
end $$;

revoke all on function private.expire_due_mission_offers(integer) from public,anon,authenticated;

create extension if not exists pg_cron;
do $$
begin
  if not exists(select 1 from cron.job where jobname='home_ai_expire_mission_offers') then
    perform cron.schedule(
      'home_ai_expire_mission_offers',
      '10 seconds',
      'select private.expire_due_mission_offers(100)'
    );
  end if;
end $$;

alter table public.missions replica identity full;
alter table public.mission_offers replica identity full;
alter table public.mission_events replica identity full;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='missions') then
    alter publication supabase_realtime add table public.missions;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mission_offers') then
    alter publication supabase_realtime add table public.mission_offers;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mission_events') then
    alter publication supabase_realtime add table public.mission_events;
  end if;
end $$;
