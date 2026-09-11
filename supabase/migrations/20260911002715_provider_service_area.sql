-- A provider's intervention radius follows the provider's latest GPS position.
alter table public.provider_profiles
  alter column service_radius_km set default 20;

create or replace function public.get_current_provider_service_area()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  radius numeric;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider') then
    raise exception 'Provider authentication required.' using errcode = '42501';
  end if;

  select pp.service_radius_km into radius
  from public.provider_profiles pp
  where pp.provider_id = uid;
  if radius is null then
    raise exception 'Provider profile not found.' using errcode = '42501';
  end if;

  return jsonb_build_object('service_radius_km', radius);
end;
$$;

create or replace function public.set_current_provider_service_area(new_service_radius_km integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  radius numeric;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider') then
    raise exception 'Provider authentication required.' using errcode = '42501';
  end if;
  if new_service_radius_km is null
     or new_service_radius_km <> all(array[5,10,20,30,50]) then
    raise exception 'Invalid service radius.' using errcode = '22023';
  end if;

  update public.provider_profiles
  set service_radius_km = new_service_radius_km,
      updated_at = statement_timestamp()
  where provider_id = uid
  returning service_radius_km into radius;
  if radius is null then
    raise exception 'Provider profile not found.' using errcode = '42501';
  end if;

  return jsonb_build_object('service_radius_km', radius);
end;
$$;

revoke all on function public.get_current_provider_service_area() from public, anon;
revoke all on function public.set_current_provider_service_area(integer) from public, anon;
grant execute on function public.get_current_provider_service_area() to authenticated;
grant execute on function public.set_current_provider_service_area(integer) to authenticated;

comment on function public.set_current_provider_service_area(integer)
  is 'Sets the authenticated provider global GPS-centred service radius to 5, 10, 20, 30 or 50 km.';
