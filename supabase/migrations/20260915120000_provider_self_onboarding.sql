-- Secure, resumable self-onboarding for users who explicitly enter the Provider app.
-- This grants only the provider role to auth.uid(); it cannot grant admin or target another user.

create table public.provider_onboarding_progress (
  provider_id uuid primary key references public.provider_profiles(provider_id) on delete cascade,
  service_area_completed_at timestamptz,
  availability_completed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.provider_onboarding_progress enable row level security;
revoke all on table public.provider_onboarding_progress from public, anon, authenticated;

-- Existing providers are grandfathered into the completed onboarding state.
insert into public.provider_onboarding_progress(provider_id,service_area_completed_at,availability_completed_at,completed_at)
select provider_id,statement_timestamp(),statement_timestamp(),statement_timestamp()
from public.provider_profiles
on conflict(provider_id) do nothing;

create or replace function private.current_provider_onboarding_state(target_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when pp.provider_id is null then jsonb_build_object(
    'providerExists',false,'providerId',target_user_id,'kycStatus',null,'kycSubmissionStatus',null,
    'professionalProfileComplete',false,'hasActivity',false,'serviceAreaComplete',false,
    'availabilityComplete',false,'onboardingComplete',false,'readyForMissions',false
  ) else jsonb_build_object(
    'providerExists',true,'providerId',pp.provider_id,'kycStatus',pp.kyc_status,
    'kycSubmissionStatus',(select s.status::text from public.provider_kyc_submissions s where s.provider_id=pp.provider_id),
    'professionalProfileComplete',pp.professional_profile_updated_at is not null,
    'hasActivity',exists(select 1 from public.provider_services ps where ps.provider_id=pp.provider_id and ps.enabled),
    'serviceAreaComplete',op.service_area_completed_at is not null,
    'availabilityComplete',op.availability_completed_at is not null,
    'onboardingComplete',op.completed_at is not null,
    'readyForMissions',pp.active and op.completed_at is not null
      and exists(select 1 from public.provider_services ps where ps.provider_id=pp.provider_id and ps.enabled)
      and op.service_area_completed_at is not null and op.availability_completed_at is not null
  ) end
  from (select target_user_id provider_id) requested
  left join public.provider_profiles pp on pp.provider_id=requested.provider_id
  left join public.provider_onboarding_progress op on op.provider_id=pp.provider_id
$$;

revoke all on function private.current_provider_onboarding_state(uuid) from public,anon,authenticated;

create or replace function public.get_current_provider_onboarding_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); existing_role public.app_role;
begin
  if uid is null or (select auth.role())<>'authenticated' then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  select role into existing_role from public.profiles where user_id=uid;
  if existing_role is not null and existing_role<>'provider' then
    raise exception 'This account already has another HOME AI role.' using errcode='42501';
  end if;
  return private.current_provider_onboarding_state(uid);
end $$;

create or replace function public.provision_current_provider()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); existing_role public.app_role; provider_name text;
begin
  if uid is null or (select auth.role())<>'authenticated' then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,771731));
  select role into existing_role from public.profiles where user_id=uid for update;
  if existing_role is not null and existing_role<>'provider' then
    raise exception 'This account already has another HOME AI role.' using errcode='42501';
  end if;
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),
    nullif(trim(raw_user_meta_data->>'name'),''),'Đối tác HOME AI') into provider_name
  from auth.users where id=uid;
  if provider_name is null then raise exception 'Authenticated user not found.' using errcode='42501'; end if;
  if existing_role is null then
    insert into public.profiles(user_id,role,display_name,status)
    values(uid,'provider',left(provider_name,120),'active');
  end if;
  insert into public.provider_profiles(provider_id,kyc_status,specialty,experience_years,service_radius_km,active)
  values(uid,'pending','Chưa thiết lập',null,20,true)
  on conflict(provider_id) do nothing;
  insert into public.provider_status(provider_id,online,available)
  values(uid,false,false) on conflict(provider_id) do nothing;
  insert into public.provider_onboarding_progress(provider_id)
  values(uid) on conflict(provider_id) do nothing;
  return private.current_provider_onboarding_state(uid);
end $$;

create or replace function public.mark_current_provider_onboarding_step(target_step text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); state jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  if target_step='service_area' then
    if not exists(select 1 from public.provider_profiles where provider_id=uid and service_radius_km in (5,10,20,30,50)) then
      raise exception 'Valid service area required.' using errcode='22023'; end if;
    update public.provider_onboarding_progress set service_area_completed_at=coalesce(service_area_completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
  elsif target_step='availability' then
    if not exists(select 1 from public.provider_availability_preferences where provider_id=uid) then
      raise exception 'Availability preferences required.' using errcode='22023'; end if;
    update public.provider_onboarding_progress set availability_completed_at=coalesce(availability_completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
  else raise exception 'Invalid onboarding step.' using errcode='22023'; end if;
  state:=private.current_provider_onboarding_state(uid);
  if (state->>'professionalProfileComplete')::boolean and (state->>'hasActivity')::boolean and (state->>'serviceAreaComplete')::boolean
    and (state->>'availabilityComplete')::boolean then
    update public.provider_onboarding_progress set completed_at=coalesce(completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
    state:=private.current_provider_onboarding_state(uid);
  end if;
  return state;
end $$;

revoke all on function public.get_current_provider_onboarding_state() from public,anon;
revoke all on function public.provision_current_provider() from public,anon;
revoke all on function public.mark_current_provider_onboarding_step(text) from public,anon;
grant execute on function public.get_current_provider_onboarding_state() to authenticated;
grant execute on function public.provision_current_provider() to authenticated;
grant execute on function public.mark_current_provider_onboarding_step(text) to authenticated;
