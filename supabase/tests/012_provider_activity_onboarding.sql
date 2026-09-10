-- Run after all migrations against an isolated Supabase database.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('14000000-0000-0000-0000-000000000001'::uuid,'activity-c@test.invalid'),
  ('24000000-0000-0000-0000-000000000001'::uuid,'activity-origin@test.invalid'),
  ('24000000-0000-0000-0000-000000000002'::uuid,'activity-p1@test.invalid'),
  ('24000000-0000-0000-0000-000000000003'::uuid,'activity-p2@test.invalid'),
  ('24000000-0000-0000-0000-000000000004'::uuid,'activity-p3@test.invalid'),
  ('24000000-0000-0000-0000-000000000005'::uuid,'activity-p4@test.invalid')
) users(id,email);

insert into public.profiles(user_id,role,display_name) values
  ('14000000-0000-0000-0000-000000000001','customer','Activity Customer'),
  ('24000000-0000-0000-0000-000000000001','provider','Activity Origin'),
  ('24000000-0000-0000-0000-000000000002','provider','Activity Peer 1'),
  ('24000000-0000-0000-0000-000000000003','provider','Activity Peer 2'),
  ('24000000-0000-0000-0000-000000000004','provider','Activity Peer 3'),
  ('24000000-0000-0000-0000-000000000005','provider','Activity Peer 4');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('24000000-0000-0000-0000-000000000001','Origin','verified',true),
  ('24000000-0000-0000-0000-000000000002','Electricity','verified',true),
  ('24000000-0000-0000-0000-000000000003','Electricity','verified',true),
  ('24000000-0000-0000-0000-000000000004','Plumbing','verified',true),
  ('24000000-0000-0000-0000-000000000005','Air conditioning','verified',true);
insert into public.provider_status(provider_id,online,available,last_latitude,last_longitude,last_location_at) values
  ('24000000-0000-0000-0000-000000000001',true,true,12,109,now()),
  ('24000000-0000-0000-0000-000000000002',false,false,12.018,109,now()),
  ('24000000-0000-0000-0000-000000000003',false,false,12.027,109,now()),
  ('24000000-0000-0000-0000-000000000004',false,false,12.063,109,now()),
  ('24000000-0000-0000-0000-000000000005',false,false,12.135,109,now());
insert into public.provider_services(provider_id,service_category,pricing_model,hourly_rate,minimum_charge,enabled) values
  ('24000000-0000-0000-0000-000000000002','electricity','hourly',100000,0,true),
  ('24000000-0000-0000-0000-000000000003','electricity','hourly',300000,0,true),
  ('24000000-0000-0000-0000-000000000004','plumbing','hourly',500000,0,true),
  ('24000000-0000-0000-0000-000000000005','air-conditioning','hourly',700000,0,true);

insert into public.missions(client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,completed_at) values
  ('14000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000002','electricity','First peer job','Nha Trang',12.018,109,'completed',now()-interval '3 days'),
  ('14000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000002','electricity','Duplicate peer job','Nha Trang',12.020,109,'completed',now()-interval '1 day'),
  ('14000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000003','electricity','Second peer job','Nha Trang',12.027,109,'completed',now()-interval '2 days'),
  ('14000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000004','plumbing','Ten km expansion','Nha Trang',12.063,109,'completed',now()),
  ('14000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000005','air-conditioning','Twenty km expansion','Nha Trang',12.135,109,'completed',now());

set local role authenticated;
set local "request.jwt.claims"='{"sub":"24000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare activity public.provider_services;
begin
  activity:=public.create_current_provider_activity('appliances','Sửa đồ gia dụng','Sửa chữa thiết bị gia dụng.','hourly',250000,100000);
  if activity.provider_id <> auth.uid() or activity.hourly_rate <> 250000 or activity.minimum_charge <> 100000 then
    raise exception 'Activity creation is not bound to the authenticated provider';
  end if;
  begin
    insert into public.provider_services(provider_id,service_category,enabled)
    values(auth.uid(),'forbidden-direct-write',true);
    raise exception 'Direct provider_services write bypassed RPC ownership';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
