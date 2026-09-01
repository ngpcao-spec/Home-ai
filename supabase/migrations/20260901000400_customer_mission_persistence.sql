-- Customer mission intake. Assignment and provider-side transitions remain server/provider owned.

alter table public.missions add column scheduled_for timestamptz;

create unique index missions_one_active_per_customer_idx
  on public.missions (client_id)
  where status not in ('completed', 'cancelled', 'expired');

create or replace function public.create_current_customer_mission(
  new_service_category text,
  new_problem_description text,
  new_diagnostic_summary text,
  new_address_id uuid,
  new_address_text text,
  new_client_latitude double precision,
  new_client_longitude double precision,
  new_scheduled_for timestamptz default null
)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result public.missions;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  select * into result from public.missions
  where client_id = current_user_id
    and status not in ('completed', 'cancelled', 'expired')
  order by created_at desc limit 1;
  if result.id is not null then return result; end if;
  if new_address_id is not null and not exists (
    select 1 from public.customer_addresses
    where id = new_address_id and customer_id = current_user_id
  ) then
    raise exception 'Mission address must belong to the customer.' using errcode = '23503';
  end if;

  insert into public.missions (
    client_id, service_category, problem_description, diagnostic_summary,
    address_id, address_text, client_latitude, client_longitude, status, scheduled_for
  ) values (
    current_user_id, trim(new_service_category), trim(new_problem_description),
    nullif(trim(new_diagnostic_summary), ''), new_address_id, trim(new_address_text),
    new_client_latitude, new_client_longitude, 'searching', new_scheduled_for
  ) returning * into result;
  insert into public.mission_events (mission_id, event_type, actor_user_id, actor_role)
  values (result.id, 'mission.created', current_user_id, 'customer');
  return result;
end;
$$;

create or replace function public.cancel_current_customer_mission(
  target_mission_id uuid,
  expected_version integer
)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result public.missions;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  update public.missions
  set status = 'cancelled', cancelled_at = now(), version = version + 1
  where id = target_mission_id and client_id = current_user_id
    and version = expected_version and status in ('requested', 'searching', 'offered')
  returning * into result;
  if result.id is null then
    raise exception 'Mission cannot be cancelled or version is stale.' using errcode = '40001';
  end if;
  insert into public.mission_events (mission_id, event_type, actor_user_id, actor_role)
  values (result.id, 'mission.cancelled', current_user_id, 'customer');
  return result;
end;
$$;

revoke all on function public.create_current_customer_mission(text, text, text, uuid, text, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.cancel_current_customer_mission(uuid, integer) from public, anon;
grant execute on function public.create_current_customer_mission(text, text, text, uuid, text, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.cancel_current_customer_mission(uuid, integer) to authenticated;
