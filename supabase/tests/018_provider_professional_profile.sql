-- Run after 20260911060203_provider_professional_profile.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now() from(values
('54000000-0000-0000-0000-000000000001'::uuid,'profile-provider-a@test.invalid'),
('54000000-0000-0000-0000-000000000002'::uuid,'profile-provider-b@test.invalid'),
('54000000-0000-0000-0000-000000000003'::uuid,'profile-customer-a@test.invalid'),
('54000000-0000-0000-0000-000000000004'::uuid,'profile-customer-b@test.invalid'))u(id,email);

insert into public.profiles(user_id,role,display_name,phone) values
('54000000-0000-0000-0000-000000000001','provider','Provider A','+84911111111'),
('54000000-0000-0000-0000-000000000002','provider','Provider B','+84922222222'),
('54000000-0000-0000-0000-000000000003','customer','Customer A','+84933333333'),
('54000000-0000-0000-0000-000000000004','customer','Customer B','+84944444444');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active,experience_years,rating_average,review_count) values
('54000000-0000-0000-0000-000000000001','Electricity','verified',true,7,4.75,12),
('54000000-0000-0000-0000-000000000002','Plumbing','verified',true,2,5,1);
insert into public.provider_services(provider_id,service_category,activity_name,activity_description,enabled)
values('54000000-0000-0000-0000-000000000001','electricity','Thợ điện','Sửa chữa điện dân dụng',true);
insert into public.provider_kyc_submissions(provider_id,status,document_path,ai_extraction,full_name,
  identity_number,date_of_birth,nationality,residence_address)
values('54000000-0000-0000-0000-000000000001','verified',
  'provider/54000000-0000-0000-0000-000000000001/identity/front/54000000-0000-0000-0000-000000000020.jpg',
  '{}','Private KYC Name','123456789012','1990-01-01','Private nationality','Private address');
insert into storage.objects(bucket_id,name,owner_id)
values('provider-kyc','provider/54000000-0000-0000-0000-000000000001/identity/front/54000000-0000-0000-0000-000000000020.jpg',
  '54000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$ declare profile jsonb;
begin
  profile:=public.update_current_provider_professional_profile('Nguyễn Văn A','+84912345678',9,'Làm việc cẩn thận.',null);
  if profile->>'name'<>'Nguyễn Văn A' or profile->>'phone'<>'+84912345678'
     or (profile->>'experienceYears')::integer<>9 or profile->>'introduction'<>'Làm việc cẩn thận.' then
    raise exception 'Own profile update failed'; end if;
  begin perform public.update_current_provider_professional_profile('A','123',0,null,null);
    raise exception 'Invalid phone accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.update_current_provider_professional_profile('A','+84912345678',-1,null,null);
    raise exception 'Negative experience accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.update_current_provider_professional_profile('A','+84912345678',0,repeat('x',301),null);
    raise exception 'Long introduction accepted'; exception when sqlstate '22023' then null; end;
end $$;

insert into storage.objects(bucket_id,name,owner_id) values
  ('provider-avatars','54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000021.jpg',
   '54000000-0000-0000-0000-000000000001');
do $$ declare profile jsonb;
begin
  profile:=public.update_current_provider_professional_profile('Nguyễn Văn A','+84912345678',9,
    'Làm việc cẩn thận.','54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000021.jpg');
  if profile->>'avatarPath'<>'54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000021.jpg' then
    raise exception 'Initial avatar upload was not saved'; end if;
end $$;
insert into storage.objects(bucket_id,name,owner_id) values
  ('provider-avatars','54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000022.webp',
   '54000000-0000-0000-0000-000000000001');
do $$ declare profile jsonb;
begin
  profile:=public.update_current_provider_professional_profile('Nguyễn Văn A','+84912345678',9,
    'Làm việc cẩn thận.','54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000022.webp');
  if profile->>'avatarPath'<>'54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000022.webp' then
    raise exception 'Replacement avatar was not saved'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare public_profile jsonb;
begin
  public_profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001',null);
  if public_profile->'phone'<>'null'::jsonb then raise exception 'Phone exposed before an accepted mission'; end if;
  if public_profile ?| array['identity_number','date_of_birth','residence_address','nationality',
    'documentPath','document_path','ai_extraction'] then
    raise exception 'Private KYC fields exposed'; end if;
  if (public_profile->>'ratingAverage')::numeric<>4.75 or (public_profile->>'reviewCount')::integer<>12 then
    raise exception 'Real rating aggregates missing'; end if;
  if jsonb_array_length(public_profile->'activities')<>1 then raise exception 'Active activities missing'; end if;
  if exists(select 1 from public.provider_kyc_submissions
    where provider_id='54000000-0000-0000-0000-000000000001') then
    raise exception 'Customer can directly read provider KYC row'; end if;
end $$;

reset role;
insert into public.missions(id,client_id,service_category,problem_description,address_text,
  provider_id,client_latitude,client_longitude,status)
values('54000000-0000-0000-0000-000000000011','54000000-0000-0000-0000-000000000003',
  'electricity','Searching test','Nha Trang','54000000-0000-0000-0000-000000000001',12.2,109.2,'offered');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare profile jsonb;
begin
  profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000011');
  if profile->'phone'<>'null'::jsonb then raise exception 'Phone exposed before provider acceptance'; end if;
  begin
    perform public.get_profile_phone('54000000-0000-0000-0000-000000000001');
    raise exception 'Legacy phone RPC exposed provider before acceptance';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
update public.missions set status='cancelled'
where id='54000000-0000-0000-0000-000000000011';
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,
  client_latitude,client_longitude,status,accepted_at)
values('54000000-0000-0000-0000-000000000010','54000000-0000-0000-0000-000000000003',
  '54000000-0000-0000-0000-000000000001','electricity','Test','Nha Trang',12.2,109.2,'accepted',now());

set local role authenticated;
set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare profile jsonb;
begin
  profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000010');
  if profile->>'phone'<>'+84912345678' then raise exception 'Assigned customer cannot see provider phone'; end if;
  if public.get_profile_phone('54000000-0000-0000-0000-000000000001')<>'+84912345678' then
    raise exception 'Assigned customer cannot use existing secure phone RPC'; end if;
  begin perform phone from public.profiles where user_id='54000000-0000-0000-0000-000000000001';
    raise exception 'Direct phone select was allowed'; exception when insufficient_privilege then null; end;
end $$;

set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ declare affected integer;
begin
  update public.provider_profiles set description='attack'
    where provider_id='54000000-0000-0000-0000-000000000001';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Provider A can modify Provider B'; end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values(
      'provider-avatars','54000000-0000-0000-0000-000000000001/avatar/54000000-0000-0000-0000-000000000099.jpg',
      '54000000-0000-0000-0000-000000000002');
    raise exception 'Provider A can upload into Provider B avatar folder';
  exception when insufficient_privilege then null; when check_violation then null;
  end;
  if exists(select 1 from storage.objects where bucket_id='provider-kyc'
    and name='provider/54000000-0000-0000-0000-000000000001/identity/front/54000000-0000-0000-0000-000000000020.jpg') then
    raise exception 'Provider B can read Provider A KYC object or sign its URL'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ declare profile jsonb;
begin
  profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000010');
  if profile->'phone'<>'null'::jsonb then raise exception 'Other customer can see provider phone'; end if;
  begin
    perform public.get_profile_phone('54000000-0000-0000-0000-000000000001');
    raise exception 'Other customer can use legacy phone RPC';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
update public.missions set status='completed' where id='54000000-0000-0000-0000-000000000010';

set local role authenticated;
set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare profile jsonb;
begin
  profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000010');
  if profile->>'phone'<>'+84912345678' then raise exception 'Existing completed-mission contact behavior changed'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"54000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ declare profile jsonb;
begin
  profile:=public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000010');
  if profile->'phone'<>'null'::jsonb then raise exception 'Other customer can see phone after mission completion'; end if;
  begin
    perform public.get_profile_phone('54000000-0000-0000-0000-000000000001');
    raise exception 'Other customer can use legacy phone RPC after mission completion';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
set local "request.jwt.claims"='{"role":"anon"}';
do $$ begin
  begin
    perform public.get_provider_professional_profile('54000000-0000-0000-0000-000000000001',null);
    raise exception 'Anonymous public-profile RPC access allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_profile_phone('54000000-0000-0000-0000-000000000001');
    raise exception 'Anonymous phone RPC access allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.provider_kyc_submissions limit 1;
    raise exception 'Anonymous KYC table access allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  if not (select public from storage.buckets where id='provider-avatars') then raise exception 'Avatar bucket is not public'; end if;
  if (select public from storage.buckets where id='provider-kyc') then raise exception 'KYC bucket became public'; end if;
end $$;

rollback;
