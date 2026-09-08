create or replace function public.cancel_current_customer_mission(
  target_mission_id uuid,
  expected_version integer
) returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  mission_row public.missions;
  result public.missions;
  expired_offer_count integer := 0;
begin
  if current_user_id is null
     or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Authenticated customer required.' using errcode = '42501';
  end if;

  -- Keep the mission-first lock order used by provider offer acceptance. The
  -- first transaction to lock the mission decides its state atomically.
  select * into mission_row
  from public.missions
  where id = target_mission_id
  for update;

  if mission_row.id is null or mission_row.client_id <> current_user_id then
    raise exception 'Customer mission not found.' using errcode = '42501';
  end if;
  if mission_row.version <> expected_version
     or mission_row.provider_id is not null
     or mission_row.status not in ('requested', 'searching', 'offered') then
    raise exception 'Mission changed concurrently.' using errcode = '40001';
  end if;

  update public.mission_offers
  set status = 'expired', responded_at = statement_timestamp()
  where mission_id = mission_row.id and status = 'pending';
  get diagnostics expired_offer_count = row_count;

  update public.missions
  set status = 'cancelled', cancelled_at = statement_timestamp(), version = version + 1
  where id = mission_row.id
  returning * into result;

  insert into public.mission_events(mission_id, event_type, actor_user_id, actor_role, payload)
  values(result.id, 'mission.cancelled', current_user_id, 'customer',
    jsonb_build_object('expiredPendingOfferCount', expired_offer_count));
  return result;
end;
$$;

revoke all on function public.cancel_current_customer_mission(uuid, integer) from public, anon;
grant execute on function public.cancel_current_customer_mission(uuid, integer) to authenticated;
