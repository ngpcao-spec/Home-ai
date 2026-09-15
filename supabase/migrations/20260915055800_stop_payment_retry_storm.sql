-- SQLSTATE 40001 means a database serialization failure and PostgREST 14.5
-- retries it automatically. A stale external-payment confirmation is a
-- deterministic business conflict, so return a non-retryable PL/pgSQL error.
-- Authorization, locking, lifecycle checks and mutations remain unchanged.

create or replace function public.complete_current_customer_external_payment(
  target_mission_id uuid,
  expected_version integer
)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions
  where id=target_mission_id for update;
  if mission_row.id is null or mission_row.client_id is distinct from uid then
    raise exception 'Customer mission not found.' using errcode='42501';
  end if;
  if mission_row.version is distinct from expected_version
     or mission_row.status<>'completed_pending_payment'
     or mission_row.payment_status<>'unpaid'
     or mission_row.provider_id is null
     or mission_row.final_authorized_amount is null then
    raise exception 'Mission cannot be completed.' using errcode='P0001';
  end if;
  update public.missions
  set status='completed',payment_status='paid_external',
      completed_at=statement_timestamp(),version=version+1
  where id=mission_row.id and client_id=uid and version=expected_version
  returning * into mission_row;
  update public.provider_status
  set current_mission_id=null,available=online,updated_at=statement_timestamp()
  where provider_id=mission_row.provider_id and current_mission_id=mission_row.id;
  update public.provider_profiles
  set completed_jobs=completed_jobs+1,updated_at=statement_timestamp()
  where provider_id=mission_row.provider_id;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role)
  values(mission_row.id,'mission.completed.external_payment',uid,'customer');
  return mission_row;
end
$$;
