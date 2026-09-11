-- Secure editing of an authenticated provider's existing hourly activity.
create or replace function public.update_current_provider_activity(
  target_provider_service_id uuid,
  new_hourly_rate bigint,
  new_minimum_charge bigint,
  new_enabled boolean
)
returns public.provider_services
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  current_activity public.provider_services;
  result public.provider_services;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id = uid and pp.active and pp.kyc_status = 'verified'
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
$$;

revoke all on function public.update_current_provider_activity(uuid,bigint,bigint,boolean)
  from public, anon;
grant execute on function public.update_current_provider_activity(uuid,bigint,bigint,boolean)
  to authenticated;

comment on function public.update_current_provider_activity(uuid,bigint,bigint,boolean)
  is 'Updates only the authenticated provider own hourly activity; historical invoice snapshots remain immutable.';
