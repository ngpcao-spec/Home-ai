-- Private provider identity submissions. AI extraction remains advisory.

create type public.provider_kyc_submission_status as enum ('draft','pending_review','verified','rejected');

create table public.provider_kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.provider_profiles(provider_id) on delete cascade,
  status public.provider_kyc_submission_status not null default 'draft',
  document_path text not null,
  ai_extraction jsonb not null,
  full_name text,
  identity_number text,
  date_of_birth text,
  sex text,
  nationality text,
  expiry_date text,
  residence_address text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (document_path ~ '^provider/[0-9a-f-]{36}/identity/front/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$'),
  check (identity_number is null or identity_number ~ '^[0-9]{9,12}$')
);

alter table public.provider_kyc_submissions enable row level security;
create policy provider_kyc_submissions_select_self on public.provider_kyc_submissions
  for select to authenticated using (provider_id=(select auth.uid()));
create policy provider_kyc_submissions_admin_all on public.provider_kyc_submissions
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
revoke all on table public.provider_kyc_submissions from public,anon;
grant select on table public.provider_kyc_submissions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('provider-kyc','provider-kyc',false,8388608,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy provider_kyc_objects_insert_self on storage.objects
  for insert to authenticated with check (
    bucket_id='provider-kyc' and (storage.foldername(name))[1]='provider'
    and (storage.foldername(name))[2]=(select auth.uid())::text
    and (storage.foldername(name))[3]='identity' and (storage.foldername(name))[4]='front'
    and name ~ '^provider/[0-9a-f-]{36}/identity/front/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$'
    and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.role='provider' and p.status='active')
  );
create policy provider_kyc_objects_select_self on storage.objects
  for select to authenticated using (
    bucket_id='provider-kyc' and (storage.foldername(name))[1]='provider'
    and (storage.foldername(name))[2]=(select auth.uid())::text
    and (storage.foldername(name))[3]='identity' and (storage.foldername(name))[4]='front'
    and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.role='provider' and p.status='active')
  );
create policy provider_kyc_objects_admin_select on storage.objects
  for select to authenticated using (bucket_id='provider-kyc' and exists(
    select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.role='admin' and p.status='active'
  ));

create or replace function private.valid_provider_kyc_extraction(value jsonb)
returns boolean language plpgsql immutable strict set search_path='' as $$
declare field_name text; field_value jsonb; expected text[]:=array['address','date_of_birth','expiry_date','full_name','identity_number','nationality','sex'];
begin
  if jsonb_typeof(value)<>'object' or value ? 'documentReadable' is false or value ? 'fields' is false
     or jsonb_typeof(value->'documentReadable')<>'boolean' or jsonb_typeof(value->'fields')<>'object' then return false; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(value->'fields') key) is distinct from expected then return false; end if;
  for field_name,field_value in select key,val from jsonb_each(value->'fields') fields(key,val) loop
    if jsonb_typeof(field_value)<>'object' or not (field_value ? 'value' and field_value ? 'confidence')
       or (select count(*) from jsonb_object_keys(field_value))<>2
       or jsonb_typeof(field_value->'confidence')<>'number'
       or (field_value->>'confidence')::numeric not between 0 and 1
       or jsonb_typeof(field_value->'value') not in ('string','null')
       or length(coalesce(field_value->>'value',''))>500 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function private.valid_provider_kyc_extraction(jsonb) from public,anon,authenticated;

create or replace function public.get_current_provider_kyc_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501'; end if;
  select jsonb_build_object('provider',jsonb_build_object('id',pp.provider_id,'name',p.display_name,
    'kycStatus',pp.kyc_status),'submission',case when s.id is null then null else jsonb_build_object(
    'id',s.id,'status',s.status,'documentPath',s.document_path,'extraction',s.ai_extraction,
    'confirmedFields',jsonb_build_object('full_name',s.full_name,'identity_number',s.identity_number,
      'date_of_birth',s.date_of_birth,'sex',s.sex,'nationality',s.nationality,
      'expiry_date',s.expiry_date,'address',s.residence_address),'submittedAt',s.submitted_at) end)
  into result from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  left join public.provider_kyc_submissions s on s.provider_id=pp.provider_id where pp.provider_id=uid;
  if result is null then raise exception 'Provider profile not found.' using errcode='42501'; end if;
  return result;
end $$;

create or replace function public.save_current_provider_kyc_extraction(new_document_path text,new_extraction jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501'; end if;
  if new_document_path !~ ('^provider/'||uid::text||'/identity/front/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$')
     or not private.valid_provider_kyc_extraction(new_extraction) then
    raise exception 'Invalid KYC extraction.' using errcode='22023'; end if;
  if not exists(select 1 from storage.objects where bucket_id='provider-kyc' and name=new_document_path) then
    raise exception 'KYC document not found.' using errcode='22023'; end if;
  if exists(select 1 from public.provider_profiles where provider_id=uid and kyc_status='verified') then
    raise exception 'Verified KYC cannot be replaced.' using errcode='55000'; end if;
  insert into public.provider_kyc_submissions(provider_id,status,document_path,ai_extraction)
  values(uid,'draft',new_document_path,new_extraction)
  on conflict(provider_id) do update set status='draft',document_path=excluded.document_path,
    ai_extraction=excluded.ai_extraction,full_name=null,identity_number=null,date_of_birth=null,
    sex=null,nationality=null,expiry_date=null,residence_address=null,submitted_at=null,
    reviewed_at=null,updated_at=statement_timestamp();
  update public.provider_profiles set kyc_status='pending',updated_at=statement_timestamp()
    where provider_id=uid and kyc_status='rejected';
  return public.get_current_provider_kyc_state();
end $$;

create or replace function public.confirm_current_provider_kyc_submission(target_submission_id uuid,new_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); submission public.provider_kyc_submissions;
  allowed text[]:=array['address','date_of_birth','expiry_date','full_name','identity_number','nationality','sex'];
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501'; end if;
  select * into submission from public.provider_kyc_submissions where id=target_submission_id for update;
  if submission.id is null or submission.provider_id<>uid then raise exception 'KYC submission not found.' using errcode='42501'; end if;
  if submission.status<>'draft' or jsonb_typeof(new_fields)<>'object'
     or (select array_agg(key order by key) from jsonb_object_keys(new_fields) key) is distinct from allowed
     or nullif(trim(new_fields->>'full_name'),'') is null
     or coalesce(new_fields->>'identity_number','') !~ '^[0-9]{9,12}$'
     or nullif(trim(new_fields->>'date_of_birth'),'') is null then
    raise exception 'Invalid confirmed KYC fields.' using errcode='22023'; end if;
  update public.provider_kyc_submissions set status='pending_review',
    full_name=left(trim(new_fields->>'full_name'),200),identity_number=new_fields->>'identity_number',
    date_of_birth=left(trim(new_fields->>'date_of_birth'),40),sex=nullif(left(trim(new_fields->>'sex'),40),''),
    nationality=nullif(left(trim(new_fields->>'nationality'),80),''),
    expiry_date=nullif(left(trim(new_fields->>'expiry_date'),40),''),
    residence_address=nullif(left(trim(new_fields->>'address'),500),''),submitted_at=statement_timestamp(),
    updated_at=statement_timestamp() where id=submission.id;
  update public.provider_profiles set kyc_status='pending' where provider_id=uid and kyc_status<>'verified';
  return public.get_current_provider_kyc_state();
end $$;

revoke all on function public.get_current_provider_kyc_state() from public,anon;
revoke all on function public.save_current_provider_kyc_extraction(text,jsonb) from public,anon;
revoke all on function public.confirm_current_provider_kyc_submission(uuid,jsonb) from public,anon;
grant execute on function public.get_current_provider_kyc_state() to authenticated;
grant execute on function public.save_current_provider_kyc_extraction(text,jsonb) to authenticated;
grant execute on function public.confirm_current_provider_kyc_submission(uuid,jsonb) to authenticated;
