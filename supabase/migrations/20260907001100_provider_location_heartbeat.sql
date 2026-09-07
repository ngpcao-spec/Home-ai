-- Separate provider GPS heartbeats from availability state transitions.

create or replace function public.update_current_provider_location(
  new_latitude double precision,
  new_longitude double precision
) returns public.provider_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result public.provider_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active and pp.kyc_status = 'verified'
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
end $$;

-- Keep the established signature for deployed clients, but derive availability
-- from the locked server row. Legacy GPS arguments are intentionally ignored.
create or replace function public.set_current_provider_availability(
  new_online boolean,
  new_available boolean,
  new_latitude double precision default null,
  new_longitude double precision default null
) returns public.provider_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result public.provider_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active and pp.kyc_status = 'verified'
     ) then
    raise exception 'Active provider authentication required.' using errcode = '42501';
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
end $$;

revoke all on function public.update_current_provider_location(double precision, double precision) from public, anon;
grant execute on function public.update_current_provider_location(double precision, double precision) to authenticated;

