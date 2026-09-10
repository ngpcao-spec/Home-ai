-- Run after 20260911000100_historical_hourly_rate_reference.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('31000000-0000-0000-0000-000000000000'::uuid,'rate-customer@test.invalid'),
  ('31000000-0000-0000-0000-000000000001'::uuid,'rate-origin@test.invalid'),
  ('31000000-0000-0000-0000-000000000002'::uuid,'rate-p1@test.invalid'),
  ('31000000-0000-0000-0000-000000000003'::uuid,'rate-p2@test.invalid'),
  ('31000000-0000-0000-0000-000000000004'::uuid,'rate-p3@test.invalid'),
  ('31000000-0000-0000-0000-000000000005'::uuid,'rate-p4@test.invalid'),
  ('31000000-0000-0000-0000-000000000006'::uuid,'rate-p5@test.invalid'),
  ('31000000-0000-0000-0000-000000000007'::uuid,'rate-p6@test.invalid')
) users(id,email);

insert into public.profiles(user_id,role,display_name) values
  ('31000000-0000-0000-0000-000000000000','customer','Rate Customer'),
  ('31000000-0000-0000-0000-000000000001','provider','Rate Origin'),
  ('31000000-0000-0000-0000-000000000002','provider','Rate Peer 1'),
  ('31000000-0000-0000-0000-000000000003','provider','Rate Peer 2'),
  ('31000000-0000-0000-0000-000000000004','provider','Rate Peer 3'),
  ('31000000-0000-0000-0000-000000000005','provider','Rate Peer 4'),
  ('31000000-0000-0000-0000-000000000006','provider','Rate Peer 5'),
  ('31000000-0000-0000-0000-000000000007','provider','Rate Peer 6');

insert into public.provider_profiles(provider_id,specialty,kyc_status,active)
select user_id,'Rate fixture','verified',true from public.profiles
where user_id between '31000000-0000-0000-0000-000000000001'::uuid
                  and '31000000-0000-0000-0000-000000000007'::uuid;
insert into public.provider_status(provider_id,online,available,last_latitude,last_longitude,last_location_at)
values('31000000-0000-0000-0000-000000000001',true,true,12,109,now());

insert into public.provider_services(id,provider_id,service_category,pricing_model,hourly_rate,minimum_charge,enabled) values
  ('32000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','electricity','hourly',900000,0,true),
  ('32000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000003','electricity','hourly',850000,0,true),
  ('32000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000004','electricity','hourly',750000,0,true),
  ('32000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000005','plumbing','hourly',950000,0,true),
  ('32000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000006','air-conditioning','hourly',980000,0,true),
  ('32000000-0000-0000-0000-000000000007','31000000-0000-0000-0000-000000000007','electricity','hourly',999999,0,true);

insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,completed_at) values
  ('33000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000002','electricity','Older completed mission','Nha Trang',12.018,109,'completed',now()-interval '4 days'),
  ('33000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000002','electricity','Latest completed mission','Nha Trang',12.020,109,'completed',now()-interval '1 day'),
  ('33000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000003','electricity','Second provider','Nha Trang',12.027,109,'completed',now()-interval '2 days'),
  ('33000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000005','plumbing','Ten kilometre sample','Nha Trang',12.063,109,'completed',now()),
  ('33000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000006','air-conditioning','Twenty kilometre sample','Nha Trang',12.135,109,'completed',now()),
  ('33000000-0000-0000-0000-000000000007','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000007','electricity','Incomplete mission','Nha Trang',12.009,109,'accepted',null),
  ('33000000-0000-0000-0000-000000000008','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000003','cleaning','Different service','Nha Trang',12.005,109,'completed',now());

insert into public.mission_invoices(mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,hourly_rate,minimum_charge,labor_amount,material_amount,total_amount,submitted_at) values
  ('33000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000002','hourly',60,100000,0,100000,900000,1000000,now()-interval '4 days'),
  ('33000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000002','hourly',60,200000,0,200000,800000,1000000,now()-interval '1 day'),
  ('33000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000003','hourly',60,400000,0,400000,700000,1100000,now()-interval '2 days'),
  ('33000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000005','hourly',60,500000,0,500000,600000,1100000,now()),
  ('33000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000006','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000006','hourly',60,700000,0,700000,500000,1200000,now()),
  ('33000000-0000-0000-0000-000000000007','31000000-0000-0000-0000-000000000007','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000007','hourly',60,1,0,1,999999999,1000000000,now()),
  ('33000000-0000-0000-0000-000000000008','31000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000003','hourly',60,2,0,2,999999998,1000000000,now());

set local role authenticated;
set local "request.jwt.claims"='{"sub":"31000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare reference jsonb;
begin
  reference:=public.get_current_provider_hourly_rate_reference('electricity');
  if reference <> '{"median_hourly_rate": 300000, "provider_count": 2, "radius_km": 5}'::jsonb then
    raise exception 'Even median, completed filter or latest-provider mission failed: %',reference;
  end if;
end $$;

reset role;
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,completed_at)
values('33000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000000','31000000-0000-0000-0000-000000000004','electricity','Third provider','Nha Trang',12.036,109,'completed',now());
insert into public.mission_invoices(mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,hourly_rate,minimum_charge,labor_amount,material_amount,total_amount)
values('33000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000000','32000000-0000-0000-0000-000000000004','hourly',60,800000,0,800000,400000,1200000);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"31000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare reference jsonb;
begin
  reference:=public.get_current_provider_hourly_rate_reference('electricity');
  if reference <> '{"median_hourly_rate": 400000, "provider_count": 3, "radius_km": 5}'::jsonb then
    raise exception 'Odd median failed: %',reference;
  end if;
  reference:=public.get_current_provider_hourly_rate_reference('plumbing');
  if reference <> '{"median_hourly_rate": 500000, "provider_count": 1, "radius_km": 10}'::jsonb then
    raise exception '10 km expansion failed: %',reference;
  end if;
  reference:=public.get_current_provider_hourly_rate_reference('air-conditioning');
  if reference <> '{"median_hourly_rate": 700000, "provider_count": 1, "radius_km": 20}'::jsonb then
    raise exception '20 km expansion failed: %',reference;
  end if;
  reference:=public.get_current_provider_hourly_rate_reference('appliances');
  if reference <> '{"median_hourly_rate": null, "provider_count": 0, "radius_km": null}'::jsonb then
    raise exception 'Empty sample failed: %',reference;
  end if;
end $$;

rollback;
