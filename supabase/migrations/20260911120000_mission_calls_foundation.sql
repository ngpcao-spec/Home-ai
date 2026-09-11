-- VoIP foundation only: server-owned call state. No LiveKit integration yet.

create type public.mission_call_status as enum (
  'ringing',
  'active',
  'declined',
  'missed',
  'ended'
);

create table public.mission_calls (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  caller_user_id uuid not null references public.profiles(user_id) on delete restrict,
  callee_user_id uuid not null references public.profiles(user_id) on delete restrict,
  room_name text not null unique,
  status public.mission_call_status not null default 'ringing',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(user_id) on delete restrict,
  constraint mission_calls_distinct_participants check (caller_user_id <> callee_user_id),
  constraint mission_calls_opaque_room_name check (room_name ~ '^call_[0-9a-f]{32}$'),
  constraint mission_calls_expiry_after_creation check (expires_at > created_at),
  constraint mission_calls_ended_by_participant check (
    ended_by is null or ended_by in (caller_user_id, callee_user_id)
  ),
  constraint mission_calls_state_timestamps check (
    (status = 'ringing' and answered_at is null and ended_at is null and ended_by is null)
    or (status = 'active' and answered_at is not null and ended_at is null and ended_by is null)
    or (status in ('declined', 'missed') and answered_at is null and ended_at is not null)
    or (status = 'ended' and ended_at is not null)
  )
);

create unique index mission_calls_one_open_per_mission_idx
  on public.mission_calls(mission_id)
  where status in ('ringing', 'active');
create index mission_calls_caller_created_idx
  on public.mission_calls(caller_user_id, created_at desc);
create index mission_calls_callee_created_idx
  on public.mission_calls(callee_user_id, created_at desc);
create index mission_calls_due_ringing_idx
  on public.mission_calls(expires_at, id)
  where status = 'ringing';

alter table public.mission_calls enable row level security;

revoke all on table public.mission_calls from public, anon, authenticated;
grant select on table public.mission_calls to authenticated;

create policy mission_calls_participant_select on public.mission_calls
  for select to authenticated
  using (
    caller_user_id = (select auth.uid())
    or callee_user_id = (select auth.uid())
  );

create or replace function private.expire_due_mission_calls(target_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare affected integer;
begin
  if target_limit not between 1 and 1000 then
    raise exception 'Invalid expiration batch size.' using errcode = '22023';
  end if;

  with due as (
    select mc.id
    from public.mission_calls mc
    where mc.status = 'ringing' and mc.expires_at <= statement_timestamp()
    order by mc.expires_at, mc.id
    limit target_limit
    for update skip locked
  )
  update public.mission_calls mc
  set status = 'missed', ended_at = statement_timestamp(), ended_by = null
  from due
  where mc.id = due.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.start_mission_call(target_mission_id uuid)
returns public.mission_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions;
  result public.mission_calls;
  callee_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into mission_row
  from public.missions m where m.id = target_mission_id
  for update;

  if mission_row.id is null
     or not (
       (mission_row.client_id = uid and private.profile_has_role(uid, 'customer'))
       or (mission_row.provider_id = uid and private.profile_has_role(uid, 'provider'))
     ) then
    raise exception 'Mission call access denied.' using errcode = '42501';
  end if;
  if mission_row.status not in (
    'accepted', 'travelling', 'arrived', 'quote_pending', 'in_progress',
    'supplement_pending', 'completed_pending_payment'
  ) then
    raise exception 'Mission status does not allow calls.' using errcode = '55000';
  end if;

  callee_id := case when mission_row.client_id = uid
    then mission_row.provider_id else mission_row.client_id end;
  if callee_id is null then
    raise exception 'Mission call participant is unavailable.' using errcode = '55000';
  end if;

  update public.mission_calls
  set status = 'missed', ended_at = statement_timestamp(), ended_by = null
  where mission_id = mission_row.id and status = 'ringing'
    and expires_at <= statement_timestamp();

  if exists (
    select 1 from public.mission_calls mc
    where mc.mission_id = mission_row.id and mc.status in ('ringing', 'active')
  ) then
    raise exception 'A mission call is already open.' using errcode = '40001';
  end if;

  insert into public.mission_calls(
    mission_id, caller_user_id, callee_user_id, room_name, status, expires_at
  ) values (
    mission_row.id, uid, callee_id,
    'call_' || replace(gen_random_uuid()::text, '-', ''),
    'ringing', statement_timestamp() + interval '30 seconds'
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.answer_mission_call(target_call_id uuid)
returns public.mission_calls
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid()); mission_id_to_lock uuid;
  mission_row public.missions; call_row public.mission_calls;
begin
  if uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select mc.mission_id into mission_id_to_lock from public.mission_calls mc where mc.id = target_call_id;
  select * into mission_row from public.missions m where m.id = mission_id_to_lock for update;
  select * into call_row from public.mission_calls mc where mc.id = target_call_id for update;
  if call_row.id is null or call_row.callee_user_id <> uid then
    raise exception 'Mission call access denied.' using errcode = '42501';
  end if;
  if mission_row.status not in ('accepted','travelling','arrived','quote_pending','in_progress',
      'supplement_pending','completed_pending_payment') then
    raise exception 'Mission status does not allow calls.' using errcode = '55000';
  end if;
  if call_row.status = 'ringing' and call_row.expires_at <= statement_timestamp() then
    update public.mission_calls set status='missed',ended_at=statement_timestamp(),ended_by=null
    where id=call_row.id returning * into call_row;
    return call_row;
  end if;
  if call_row.status <> 'ringing' then return call_row; end if;
  update public.mission_calls set status='active',answered_at=statement_timestamp()
  where id=call_row.id returning * into call_row;
  return call_row;
end;
$$;

create or replace function public.decline_mission_call(target_call_id uuid)
returns public.mission_calls
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid()); mission_id_to_lock uuid;
  call_row public.mission_calls;
begin
  if uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select mc.mission_id into mission_id_to_lock from public.mission_calls mc where mc.id=target_call_id;
  perform 1 from public.missions m where m.id=mission_id_to_lock for update;
  select * into call_row from public.mission_calls mc where mc.id=target_call_id for update;
  if call_row.id is null or call_row.callee_user_id <> uid then
    raise exception 'Mission call access denied.' using errcode = '42501';
  end if;
  if call_row.status = 'ringing' and call_row.expires_at <= statement_timestamp() then
    update public.mission_calls set status='missed',ended_at=statement_timestamp(),ended_by=null
    where id=call_row.id returning * into call_row;
    return call_row;
  end if;
  if call_row.status <> 'ringing' then return call_row; end if;
  update public.mission_calls set status='declined',ended_at=statement_timestamp(),ended_by=uid
  where id=call_row.id returning * into call_row;
  return call_row;
end;
$$;

create or replace function public.end_mission_call(target_call_id uuid)
returns public.mission_calls
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid()); mission_id_to_lock uuid;
  call_row public.mission_calls;
begin
  if uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select mc.mission_id into mission_id_to_lock from public.mission_calls mc where mc.id=target_call_id;
  perform 1 from public.missions m where m.id=mission_id_to_lock for update;
  select * into call_row from public.mission_calls mc where mc.id=target_call_id for update;
  if call_row.id is null or uid not in (call_row.caller_user_id, call_row.callee_user_id) then
    raise exception 'Mission call access denied.' using errcode = '42501';
  end if;
  if call_row.status = 'ringing' and call_row.expires_at <= statement_timestamp() then
    update public.mission_calls set status='missed',ended_at=statement_timestamp(),ended_by=null
    where id=call_row.id returning * into call_row;
    return call_row;
  end if;
  if call_row.status not in ('ringing','active') then return call_row; end if;
  update public.mission_calls set status='ended',ended_at=statement_timestamp(),ended_by=uid
  where id=call_row.id returning * into call_row;
  return call_row;
end;
$$;

create or replace function public.get_current_mission_call(target_mission_id uuid)
returns public.mission_calls
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; result public.mission_calls;
begin
  if uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select * into mission_row from public.missions m where m.id=target_mission_id;
  if mission_row.id is null or uid not in (mission_row.client_id, mission_row.provider_id) then
    raise exception 'Mission call access denied.' using errcode = '42501';
  end if;
  select * into result from public.mission_calls mc
  where mc.mission_id=mission_row.id and (
    mc.status='active' or (mc.status='ringing' and mc.expires_at>statement_timestamp())
  ) order by mc.created_at desc limit 1;
  return result;
end;
$$;

create or replace function private.close_mission_calls_on_terminal_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed','cancelled','expired')
     and old.status is distinct from new.status then
    update public.mission_calls
    set status='ended',ended_at=statement_timestamp(),ended_by=null
    where mission_id=new.id and status in ('ringing','active');
  end if;
  return new;
end;
$$;

create trigger missions_close_calls_after_terminal_status
after update of status on public.missions
for each row execute function private.close_mission_calls_on_terminal_status();

-- The former targeted phone endpoint stays present only as an explicit denial so
-- stale clients cannot regain cross-user phone access if a grant is added later.
create or replace function public.get_profile_phone(target_user_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  raise exception 'Phone access is disabled.' using errcode = '42501';
end;
$$;

create or replace function public.get_current_profile_phone()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid()); result text;
begin
  if uid is null or not exists(
    select 1 from public.profiles p where p.user_id=uid and p.status='active'
  ) then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  select p.phone into result from public.profiles p where p.user_id=uid;
  return result;
end;
$$;

create or replace function public.get_provider_professional_profile(
  target_provider_id uuid,
  target_mission_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
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
  where pp.provider_id=target_provider_id and pp.active and pp.kyc_status='verified' and p.status='active';

  if result is null then
    raise exception 'Provider profile not found.' using errcode='42501';
  end if;
  return result;
end;
$$;

revoke select(phone) on public.profiles from anon, authenticated;
revoke all on function public.get_profile_phone(uuid) from public, anon, authenticated;
revoke all on function public.get_current_profile_phone() from public, anon;
grant execute on function public.get_current_profile_phone() to authenticated;

revoke all on function public.start_mission_call(uuid) from public, anon;
revoke all on function public.answer_mission_call(uuid) from public, anon;
revoke all on function public.decline_mission_call(uuid) from public, anon;
revoke all on function public.end_mission_call(uuid) from public, anon;
revoke all on function public.get_current_mission_call(uuid) from public, anon;
grant execute on function public.start_mission_call(uuid) to authenticated;
grant execute on function public.answer_mission_call(uuid) to authenticated;
grant execute on function public.decline_mission_call(uuid) to authenticated;
grant execute on function public.end_mission_call(uuid) to authenticated;
grant execute on function public.get_current_mission_call(uuid) to authenticated;

revoke all on function private.expire_due_mission_calls(integer) from public, anon, authenticated;
revoke all on function private.close_mission_calls_on_terminal_status() from public, anon, authenticated;

do $$
begin
  if not exists(select 1 from cron.job where jobname='home_ai_expire_mission_calls') then
    perform cron.schedule(
      'home_ai_expire_mission_calls',
      '10 seconds',
      'select private.expire_due_mission_calls(100)'
    );
  end if;
end;
$$;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='mission_calls'
  ) then
    alter publication supabase_realtime add table public.mission_calls;
  end if;
end;
$$;

comment on table public.mission_calls is
  'Server-owned VoIP call state for mission participants. Contains no phone number or LiveKit credential.';
