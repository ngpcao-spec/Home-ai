-- Run after 20260911000227_edit_provider_activity.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('41000000-0000-0000-0000-000000000000'::uuid,'edit-customer@test.invalid'),
  ('41000000-0000-0000-0000-000000000001'::uuid,'edit-provider@test.invalid'),
  ('41000000-0000-0000-0000-000000000002'::uuid,'edit-other@test.invalid')
) users(id,email);

insert into public.profiles(user_id,role,display_name) values
  ('41000000-0000-0000-0000-000000000000','customer','Edit Customer'),
  ('41000000-0000-0000-0000-000000000001','provider','Edit Provider'),
  ('41000000-0000-0000-0000-000000000002','provider','Other Provider');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active,service_radius_km) values
  ('41000000-0000-0000-0000-000000000001','Electricity','verified',true,20),
  ('41000000-0000-0000-0000-000000000002','Electricity','verified',true,20);
insert into public.provider_status(provider_id,online,available,last_latitude,last_longitude,last_location_at) values
  ('41000000-0000-0000-0000-000000000001',true,true,12.24,109.19,now()),
  ('41000000-0000-0000-0000-000000000002',true,true,12.24,109.19,now());
insert into public.provider_services(id,provider_id,service_category,pricing_model,hourly_rate,minimum_charge,enabled) values
  ('42000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','electricity','hourly',300000,400000,true),
  ('42000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000002','electricity','hourly',250000,0,true);

insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,completed_at) values
  ('43000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000000','41000000-0000-0000-0000-000000000001','electricity','Historical job','Nha Trang',12.24,109.19,'completed',now());
insert into public.mission_invoices(mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,hourly_rate,minimum_charge,labor_amount,material_amount,total_amount) values
  ('43000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000000','42000000-0000-0000-0000-000000000001','hourly',60,300000,400000,400000,0,400000);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare activity public.provider_services;
begin
  activity:=public.update_current_provider_activity('42000000-0000-0000-0000-000000000001',350000,0,false);
  if activity.hourly_rate<>350000 or activity.minimum_charge<>0 or activity.enabled then
    raise exception 'Activity pricing or deactivation was not persisted';
  end if;
  if (select hourly_rate<>300000 or minimum_charge<>400000 from public.mission_invoices where mission_id='43000000-0000-0000-0000-000000000001') then
    raise exception 'Historical invoice snapshot changed';
  end if;
end $$;

set local "request.jwt.claims"='{"sub":"41000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    perform public.update_current_provider_activity('42000000-0000-0000-0000-000000000001',1,0,true);
    raise exception 'A provider updated another provider activity';
  exception when insufficient_privilege then null;
  end;
end $$;

set local "request.jwt.claims"='{"sub":"41000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.24,109.19,20,interval '5 minutes') where provider_id='41000000-0000-0000-0000-000000000001') then
    raise exception 'Disabled activity remained eligible for matching';
  end if;
end $$;

set local "request.jwt.claims"='{"sub":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.update_current_provider_activity('42000000-0000-0000-0000-000000000001',360000,0,true);

set local "request.jwt.claims"='{"sub":"41000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.24,109.19,20,interval '5 minutes') where provider_id='41000000-0000-0000-0000-000000000001') then
    raise exception 'Reactivated activity did not regain matching eligibility';
  end if;
end $$;

rollback;
