-- Reuse the private CCCD/OCR pipeline as optional profile data entry during
-- Provider V1 onboarding. This never verifies KYC and never gates matching.

alter table public.provider_onboarding_progress
  add column identity_assist_completed_at timestamptz;

-- Existing providers keep their current flow. Only newly provisioned providers
-- are shown the assisted-entry step.
update public.provider_onboarding_progress
set identity_assist_completed_at=coalesce(identity_assist_completed_at,statement_timestamp()),
    updated_at=statement_timestamp();

create or replace function private.current_provider_onboarding_state(target_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when pp.provider_id is null then jsonb_build_object(
    'providerExists',false,'providerId',target_user_id,'kycStatus',null,'kycSubmissionStatus',null,
    'identityAssistComplete',false,'professionalProfileComplete',false,'hasActivity',false,
    'serviceAreaComplete',false,'availabilityComplete',false,'onboardingComplete',false,'readyForMissions',false
  ) else jsonb_build_object(
    'providerExists',true,'providerId',pp.provider_id,'kycStatus',pp.kyc_status,
    'kycSubmissionStatus',(select s.status::text from public.provider_kyc_submissions s where s.provider_id=pp.provider_id),
    'identityAssistComplete',op.identity_assist_completed_at is not null,
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

create or replace function public.mark_current_provider_onboarding_step(target_step text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); state jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  if target_step='identity_assist' then
    update public.provider_onboarding_progress
    set identity_assist_completed_at=coalesce(identity_assist_completed_at,statement_timestamp()),updated_at=statement_timestamp()
    where provider_id=uid;
  elsif target_step='service_area' then
    if not exists(select 1 from public.provider_profiles where provider_id=uid and service_radius_km in (5,10,20,30,50)) then
      raise exception 'Valid service area required.' using errcode='22023'; end if;
    update public.provider_onboarding_progress set service_area_completed_at=coalesce(service_area_completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
  elsif target_step='availability' then
    if not exists(select 1 from public.provider_availability_preferences where provider_id=uid) then
      raise exception 'Availability preferences required.' using errcode='22023'; end if;
    update public.provider_onboarding_progress set availability_completed_at=coalesce(availability_completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
  else raise exception 'Invalid onboarding step.' using errcode='22023'; end if;
  state:=private.current_provider_onboarding_state(uid);
  if (state->>'identityAssistComplete')::boolean and (state->>'professionalProfileComplete')::boolean
    and (state->>'hasActivity')::boolean and (state->>'serviceAreaComplete')::boolean
    and (state->>'availabilityComplete')::boolean then
    update public.provider_onboarding_progress set completed_at=coalesce(completed_at,statement_timestamp()),updated_at=statement_timestamp() where provider_id=uid;
    state:=private.current_provider_onboarding_state(uid);
  end if;
  return state;
end $$;

create or replace function public.complete_current_provider_identity_assist(
  target_submission_id uuid,
  new_fields jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=(select auth.uid());
  submission public.provider_kyc_submissions;
  allowed text[]:=array['address','date_of_birth','expiry_date','full_name','identity_number','nationality','sex'];
  identity_value text:=nullif(trim(new_fields->>'identity_number'),'');
  confirmed_name text:=nullif(trim(new_fields->>'full_name'),'');
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  select * into submission from public.provider_kyc_submissions where id=target_submission_id for update;
  if submission.id is null or submission.provider_id<>uid then
    raise exception 'Identity extraction not found.' using errcode='42501';
  end if;
  if submission.status<>'draft' or jsonb_typeof(new_fields)<>'object'
     or (select array_agg(key order by key) from jsonb_object_keys(new_fields) key) is distinct from allowed
     or confirmed_name is null or char_length(confirmed_name)>120
     or (identity_value is not null and identity_value !~ '^[0-9]{9,12}$') then
    raise exception 'Invalid assisted profile fields.' using errcode='22023';
  end if;

  -- Keep the identity record as a private draft for the dormant V2 KYC flow.
  -- No pending_review/verified transition is performed by V1 onboarding.
  update public.provider_kyc_submissions set
    full_name=confirmed_name,identity_number=identity_value,
    date_of_birth=nullif(left(trim(new_fields->>'date_of_birth'),40),''),
    sex=nullif(left(trim(new_fields->>'sex'),40),''),
    nationality=nullif(left(trim(new_fields->>'nationality'),80),''),
    expiry_date=nullif(left(trim(new_fields->>'expiry_date'),40),''),
    residence_address=nullif(left(trim(new_fields->>'address'),500),''),
    submitted_at=null,reviewed_at=null,updated_at=statement_timestamp()
  where id=submission.id;
  update public.profiles set display_name=confirmed_name,updated_at=statement_timestamp()
  where user_id=uid and role='provider';
  update public.provider_onboarding_progress set
    identity_assist_completed_at=coalesce(identity_assist_completed_at,statement_timestamp()),updated_at=statement_timestamp()
  where provider_id=uid;
  return private.current_provider_onboarding_state(uid);
end $$;

revoke all on function public.complete_current_provider_identity_assist(uuid,jsonb) from public,anon;
grant execute on function public.complete_current_provider_identity_assist(uuid,jsonb) to authenticated;
