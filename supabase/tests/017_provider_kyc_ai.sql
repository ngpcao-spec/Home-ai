-- Run after 20260911020000_provider_kyc_ai.sql.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now() from(values
('53000000-0000-0000-0000-000000000001'::uuid,'kyc-a@test.invalid'),('53000000-0000-0000-0000-000000000002'::uuid,'kyc-b@test.invalid'))u(id,email);
insert into public.profiles(user_id,role,display_name) values
('53000000-0000-0000-0000-000000000001','provider','KYC A'),('53000000-0000-0000-0000-000000000002','provider','KYC B');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
('53000000-0000-0000-0000-000000000001','Electricity','pending',true),('53000000-0000-0000-0000-000000000002','Plumbing','pending',true);

do $$ begin
  if (select public from storage.buckets where id='provider-kyc') then raise exception 'KYC bucket is public'; end if;
  if not (select allowed_mime_types @> array['image/heic','image/heif'] from storage.buckets where id='provider-kyc') then
    raise exception 'KYC bucket does not allow HEIC and HEIF'; end if;
end $$;

set local role anon;
set local "request.jwt.claims"='{"role":"anon"}';
do $$ begin
  begin
    insert into storage.objects(bucket_id,name) values('provider-kyc','provider/53000000-0000-0000-0000-000000000001/identity/front/53000000-0000-0000-0000-000000000099.jpg');
    raise exception 'Anonymous KYC upload was accepted';
  exception when insufficient_privilege then null; when check_violation then null;
  end;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"53000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into storage.objects(bucket_id,name,owner_id) values('provider-kyc','provider/53000000-0000-0000-0000-000000000001/identity/front/53000000-0000-0000-0000-000000000010.jpg','53000000-0000-0000-0000-000000000001');
select public.save_current_provider_kyc_extraction(
 'provider/53000000-0000-0000-0000-000000000001/identity/front/53000000-0000-0000-0000-000000000010.jpg',
 '{"documentReadable":true,"fields":{"full_name":{"value":"Nguyen Van A","confidence":0.55},"identity_number":{"value":"123456789012","confidence":0.99},"date_of_birth":{"value":"01/01/1990","confidence":0.9},"sex":{"value":null,"confidence":0},"nationality":{"value":"Viet Nam","confidence":0.8},"expiry_date":{"value":null,"confidence":0},"address":{"value":null,"confidence":0}}}'::jsonb);

do $$ declare submission_id uuid; affected integer;
begin
  select id into submission_id from public.provider_kyc_submissions where provider_id='53000000-0000-0000-0000-000000000001';
  if submission_id is null or (select status<>'draft' from public.provider_kyc_submissions where id=submission_id) then raise exception 'AI extraction did not create a draft'; end if;
  perform public.confirm_current_provider_kyc_submission(submission_id,
    '{"full_name":"Nguyễn Văn A","identity_number":"123456789012","date_of_birth":"01/01/1990","sex":"Nam","nationality":"Việt Nam","expiry_date":null,"address":"Nha Trang"}'::jsonb);
  if (select status<>'pending_review' from public.provider_kyc_submissions where id=submission_id) then raise exception 'Confirmation did not create pending_review'; end if;
  if (select document_path<>'provider/53000000-0000-0000-0000-000000000001/identity/front/53000000-0000-0000-0000-000000000010.jpg' from public.provider_kyc_submissions where id=submission_id) then
    raise exception 'Manual correction silently changed the original document'; end if;
  if (select kyc_status='verified' from public.provider_profiles where provider_id='53000000-0000-0000-0000-000000000001') then raise exception 'Provider confirmation created verified KYC'; end if;
  begin
    update public.provider_kyc_submissions set status='verified' where id=submission_id;
    raise exception 'Provider directly created verified KYC';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.provider_profiles set kyc_status='verified' where provider_id='53000000-0000-0000-0000-000000000001';
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Provider directly changed operational KYC'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

set local "request.jwt.claims"='{"sub":"53000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.provider_kyc_submissions where provider_id='53000000-0000-0000-0000-000000000001')
     or exists(select 1 from storage.objects where bucket_id='provider-kyc' and name like 'provider/53000000-0000-0000-0000-000000000001/%') then
    raise exception 'Provider B can read Provider A KYC'; end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values(
      'provider-kyc','provider/53000000-0000-0000-0000-000000000001/identity/front/53000000-0000-0000-0000-000000000011.heic',
      '53000000-0000-0000-0000-000000000002');
    raise exception 'Provider B can write into Provider A KYC folder';
  exception when insufficient_privilege then null; when check_violation then null;
  end;
end $$;
rollback;
