-- Provider professional profile: public presentation data, private phone access,
-- and a profile-photo bucket kept strictly separate from private KYC documents.

alter table public.provider_profiles
  alter column experience_years drop not null;

alter table public.provider_profiles
  add column avatar_storage_path text,
  add column professional_profile_updated_at timestamptz,
  add constraint provider_profiles_description_length
    check (description is null or char_length(description) <= 300),
  add constraint provider_profiles_avatar_path
    check (avatar_storage_path is null or avatar_storage_path ~ '^[0-9a-f-]{36}/avatar/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('provider-avatars','provider-avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy provider_avatar_objects_insert_self on storage.objects
  for insert to authenticated with check (
    bucket_id='provider-avatars'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and (storage.foldername(name))[2]='avatar'
    and name ~ '^[0-9a-f-]{36}/avatar/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    and exists(select 1 from public.profiles p where p.user_id=(select auth.uid())
      and p.role='provider' and p.status='active')
  );

create policy provider_avatar_objects_update_self on storage.objects
  for update to authenticated using (
    bucket_id='provider-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
  ) with check (
    bucket_id='provider-avatars'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and (storage.foldername(name))[2]='avatar'
    and name ~ '^[0-9a-f-]{36}/avatar/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  );

create policy provider_avatar_objects_delete_self on storage.objects
  for delete to authenticated using (
    bucket_id='provider-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
  );

-- Keep the legacy contact endpoint compatible, while requiring a real accepted
-- relationship before either participant can read the other one's phone.
create or replace function public.get_profile_phone(target_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare uid uuid:=(select auth.uid()); result text;
begin
  if uid is null or (select auth.role())<>'authenticated' then
    raise exception 'Authentication required.' using errcode='42501';
  end if;
  if target_user_id<>uid and not private.is_admin() and not exists(
    select 1 from public.missions m
    where ((m.client_id=uid and m.provider_id=target_user_id)
        or (m.provider_id=uid and m.client_id=target_user_id))
      and m.status in ('accepted','travelling','arrived','quote_pending','in_progress',
        'supplement_pending','completed_pending_payment','completed')
  ) then
    raise exception 'Phone access requires an accepted mission relationship.' using errcode='42501';
  end if;
  select p.phone into result from public.profiles p where p.user_id=target_user_id;
  return result;
end $$;

create or replace function public.get_current_provider_professional_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare uid uuid:=(select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated'
     or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;

  select jsonb_build_object(
    'providerId',pp.provider_id,
    'name',case when pp.professional_profile_updated_at is null then coalesce(
      (select s.full_name from public.provider_kyc_submissions s
        where s.provider_id=uid and s.status='verified'),p.display_name)
      else p.display_name end,
    'phone',p.phone,
    'avatarPath',pp.avatar_storage_path,
    'experienceYears',pp.experience_years,
    'introduction',pp.description,
    'kycStatus',pp.kyc_status,
    'ratingAverage',pp.rating_average,
    'reviewCount',pp.review_count
  ) into result
  from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  where pp.provider_id=uid;

  if result is null then
    raise exception 'Provider profile not found.' using errcode='42501';
  end if;
  return result;
end $$;

create or replace function public.update_current_provider_professional_profile(
  new_display_name text,
  new_phone text,
  new_experience_years integer default null,
  new_introduction text default null,
  new_avatar_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare uid uuid:=(select auth.uid()); normalized_phone text:=nullif(trim(new_phone),'');
begin
  if uid is null or (select auth.role())<>'authenticated'
     or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  if nullif(trim(new_display_name),'') is null or char_length(trim(new_display_name))>120
     or (normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$')
     or new_experience_years is not null and new_experience_years not between 0 and 80
     or char_length(coalesce(new_introduction,''))>300 then
    raise exception 'Invalid provider profile.' using errcode='22023';
  end if;
  if new_avatar_path is not null and (
    new_avatar_path !~ ('^'||uid::text||'/avatar/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
    or not exists(select 1 from storage.objects o where o.bucket_id='provider-avatars' and o.name=new_avatar_path)
  ) then
    raise exception 'Invalid provider avatar.' using errcode='22023';
  end if;

  update public.profiles set display_name=trim(new_display_name),phone=normalized_phone,
    updated_at=statement_timestamp() where user_id=uid and role='provider';
  update public.provider_profiles set experience_years=new_experience_years,
    description=nullif(trim(new_introduction),''),avatar_storage_path=new_avatar_path,
    professional_profile_updated_at=statement_timestamp(),updated_at=statement_timestamp()
    where provider_id=uid;
  return public.get_current_provider_professional_profile();
end $$;

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
declare uid uuid:=(select auth.uid()); result jsonb; can_view_phone boolean:=false;
begin
  if uid is null or (select auth.role())<>'authenticated' then
    raise exception 'Authentication required.' using errcode='42501';
  end if;

  can_view_phone := uid=target_provider_id or private.is_admin() or exists(
    select 1 from public.missions m
    where m.id=target_mission_id and m.client_id=uid and m.provider_id=target_provider_id
      and m.status in ('accepted','travelling','arrived','quote_pending',
        'in_progress','supplement_pending','completed_pending_payment','completed')
  );

  select jsonb_build_object(
    'providerId',pp.provider_id,'name',case when pp.professional_profile_updated_at is null then
      coalesce((select s.full_name from public.provider_kyc_submissions s
        where s.provider_id=pp.provider_id and s.status='verified'),p.display_name)
      else p.display_name end,'avatarPath',pp.avatar_storage_path,
    'verified',pp.kyc_status='verified','ratingAverage',pp.rating_average,
    'reviewCount',pp.review_count,'experienceYears',pp.experience_years,
    'introduction',pp.description,'phone',case when can_view_phone then p.phone else null end,
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
end $$;

revoke all on function public.get_current_provider_professional_profile() from public,anon;
revoke all on function public.update_current_provider_professional_profile(text,text,integer,text,text) from public,anon;
revoke all on function public.get_provider_professional_profile(uuid,uuid) from public,anon;
revoke all on function public.get_profile_phone(uuid) from public,anon;
grant execute on function public.get_current_provider_professional_profile() to authenticated;
grant execute on function public.update_current_provider_professional_profile(text,text,integer,text,text) to authenticated;
grant execute on function public.get_provider_professional_profile(uuid,uuid) to authenticated;
grant execute on function public.get_profile_phone(uuid) to authenticated;
