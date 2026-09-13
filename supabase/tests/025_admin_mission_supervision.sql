-- Proposed migration must run after BEGIN, in this transaction. All fixtures roll back.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('59500000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','supervision-'||n||'@test.invalid','',now(),'{}','{}',now(),now() from generate_series(1,4) n;
insert into public.profiles(user_id,role,display_name,phone) values
  ('59500000-0000-0000-0000-000000000001','admin','Synthetic Admin',null),
  ('59500000-0000-0000-0000-000000000002','customer','Synthetic Customer','+84995550002'),
  ('59500000-0000-0000-0000-000000000003','provider','Synthetic Provider','+84995550003');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active,description) values
  ('59500000-0000-0000-0000-000000000003','Electricity','verified',true,'Synthetic introduction');
insert into public.provider_services(id,provider_id,service_category,pricing_model,hourly_rate,minimum_charge) values
  ('59500000-0000-0000-0000-000000000050','59500000-0000-0000-0000-000000000003','electricity','hourly',900000,0);
insert into public.provider_status(provider_id,online,available) values('59500000-0000-0000-0000-000000000003',true,true);
-- One active mission per customer remains enforced, including pagination fixtures.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('59520000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','page-customer-'||n||'@test.invalid','',now(),'{}','{}',now(),now()
from (select generate_series(1,13) n union all select generate_series(100,155)) customers;
insert into public.profiles(user_id,role,display_name)
select ('59520000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'customer','Synthetic pagination customer'
from (select generate_series(1,13) n union all select generate_series(100,155)) customers;
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,payment_status,final_authorized_amount)
select ('59510000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  case when n=11 then '59500000-0000-0000-0000-000000000002'::uuid else ('59520000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid end,
  case when status in ('requested','searching','offered','cancelled','expired') then null else '59500000-0000-0000-0000-000000000003'::uuid end,
  'electricity','Synthetic request','Synthetic test zone',12.2,109.2,status,
  case when status='completed' then 'paid_external' else 'unpaid' end,case when status='completed' then 200000 else null end
from (select enumlabel::public.mission_status as status,row_number() over(order by enumsortorder) as n from pg_enum where enumtypid='public.mission_status'::regtype) statuses;
insert into public.missions(id,client_id,service_category,problem_description,address_text,client_latitude,client_longitude,status)
select ('59510000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('59520000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'electricity','Pagination fixture','Synthetic zone',12.2,109.2,'searching' from generate_series(100,155) n;
insert into public.mission_invoices(mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,hourly_rate,minimum_charge,labor_amount,material_amount,total_amount)
values('59510000-0000-0000-0000-000000000011','59500000-0000-0000-0000-000000000003','59500000-0000-0000-0000-000000000002',
  '59500000-0000-0000-0000-000000000050','hourly',95,300000,400000,475000,150000,625000);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59500000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin perform public.create_current_customer_review('59510000-0000-0000-0000-000000000011',5,'Synthetic review'); end $$;
reset role;
insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,created_at,payload)
select '59510000-0000-0000-0000-000000000011',event_type,
  case when n in (1,7) then '59500000-0000-0000-0000-000000000002'::uuid else '59500000-0000-0000-0000-000000000003'::uuid end,
  case when n in (1,7) then 'customer'::public.app_role else 'provider'::public.app_role end,
  now()+n*interval '1 second','{"private_test_marker":"DO_NOT_RETURN"}'
from (values(1,'mission.created'),(2,'mission.offer.accepted'),(3,'mission.provider.travelling'),(4,'mission.provider.arrived'),
  (5,'mission.intervention.started'),(6,'mission.invoice.submitted'),(7,'mission.completed.external_payment')) e(n,event_type);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59500000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ declare result jsonb; item jsonb; f text; begin
  result:=public.get_admin_missions();
  if jsonb_array_length(result->'items')<>50 or result->>'hasMore'<>'true' then raise exception 'Pagination first page'; end if;
  if jsonb_array_length(public.get_admin_missions('all',50)->'items')=0 then raise exception 'Pagination next page'; end if;
  foreach f in array array['active','completed','cancelled'] loop
    for item in select value from jsonb_array_elements(public.get_admin_missions(f)->'items') loop
      if f='active' and item->>'status' in ('completed','cancelled','expired') or f='completed' and item->>'status'<>'completed'
        or f='cancelled' and item->>'status' not in ('cancelled','expired') then raise exception 'Wrong filter'; end if;
    end loop;
  end loop;
  result:=public.get_admin_mission_detail('59510000-0000-0000-0000-000000000011');
  if result->>'finalAmount'<>'625000' or result->'invoice'->>'hourlyRate'<>'300000' or result->'invoice'->>'minimumCharge'<>'400000'
    or result->'invoice'->>'laborAmount'<>'475000' or result->'invoice'->>'materialAmount'<>'150000' then raise exception 'Historical invoice mismatch'; end if;
  if result->>'paymentStatus'<>'paid_external' or result->'review'->>'rating'<>'5' or jsonb_array_length(result->'events')<>7 then raise exception 'Payment/review/timeline'; end if;
  if result::text like '%DO_NOT_RETURN%' or result::text like '%849955500%' or result ?| array['phone','identity_number','documentPath','clientLatitude','clientLongitude','payload','callerUserId','roomName'] then raise exception 'Private data exposed'; end if;
  if public.get_admin_mission_detail('59510000-0000-0000-0000-000000000002')->'providerName'<>'null'::jsonb then raise exception 'Unassigned provider'; end if;
  result:=public.get_admin_provider_profile('59500000-0000-0000-0000-000000000003');
  if result->>'name'<>'Synthetic Provider' or result->>'completedJobs'<>'1' or (result->>'ratingAverage')::numeric<>5
    or result ?| array['phone','identity_number','documentPath','nationality','lastLatitude','lastLongitude'] then raise exception 'Provider projection'; end if;
  perform public.get_admin_providers();
  begin perform public.get_admin_missions('invalid');raise exception 'Invalid filter';exception when sqlstate '22023' then null;end;
  begin update public.missions set status='cancelled' where id='59510000-0000-0000-0000-000000000002';raise exception 'Admin mutation';exception when insufficient_privilege then null;end;
  begin update public.missions set final_authorized_amount=1 where id='59510000-0000-0000-0000-000000000011';raise exception 'Admin price mutation';exception when insufficient_privilege then null;end;
  begin update public.provider_profiles set description='changed' where provider_id='59500000-0000-0000-0000-000000000003';raise exception 'Admin provider mutation';exception when insufficient_privilege then null;end;
  begin update public.profiles set role='admin' where user_id='59500000-0000-0000-0000-000000000002';raise exception 'Admin role mutation';exception when insufficient_privilege then null;end;
  begin perform public.get_profile_phone('59500000-0000-0000-0000-000000000003');raise exception 'Phone RPC exposed';exception when insufficient_privilege then null;end;
  begin perform public.get_mission_messages('59510000-0000-0000-0000-000000000005');raise exception 'Admin chat access';exception when insufficient_privilege then null;end;
  begin perform public.start_mission_call('59510000-0000-0000-0000-000000000005');raise exception 'Admin call access';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare actor uuid; begin
  for actor in select id from auth.users where id in ('59500000-0000-0000-0000-000000000002','59500000-0000-0000-0000-000000000003','59500000-0000-0000-0000-000000000004') loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin perform public.get_admin_missions();raise exception 'Foreign mission listing';exception when insufficient_privilege then null;end;
    begin perform public.get_admin_mission_detail('59510000-0000-0000-0000-000000000011');raise exception 'Foreign mission detail';exception when insufficient_privilege then null;end;
    begin perform public.get_admin_providers();raise exception 'Foreign provider listing';exception when insufficient_privilege then null;end;
    begin perform public.get_admin_provider_profile('59500000-0000-0000-0000-000000000003');raise exception 'Foreign provider detail';exception when insufficient_privilege then null;end;
    execute 'reset role';
  end loop;
end $$;
set local role anon;
set local "request.jwt.claims"='{}';
do $$ begin
  begin perform public.get_admin_missions();raise exception 'Anon listing';exception when insufficient_privilege then null;end;
  begin perform public.get_admin_mission_detail('59510000-0000-0000-0000-000000000011');raise exception 'Anon detail';exception when insufficient_privilege then null;end;
  begin perform public.get_admin_providers();raise exception 'Anon providers';exception when insufficient_privilege then null;end;
  begin perform public.get_admin_provider_profile('59500000-0000-0000-0000-000000000003');raise exception 'Anon provider';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Participant writes remain usable; no business permission changes.
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59500000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  perform public.update_current_provider_professional_profile('Synthetic Provider','+84995550003',2,'unchanged workflow',null);
  perform public.start_current_provider_intervention('59510000-0000-0000-0000-000000000006',1);
  perform public.submit_current_provider_hourly_invoice('59510000-0000-0000-0000-000000000006',2,1,35,150000);
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59500000-0000-0000-0000-000000000002","role":"authenticated"}';
-- This customer does not own the arrived fixture; payment stays owner-only.
do $$ begin
  begin perform public.complete_current_customer_external_payment('59510000-0000-0000-0000-000000000006',3);raise exception 'Wrong client payment';exception when insufficient_privilege then null;end;
end $$;
set local "request.jwt.claims"='{"sub":"59520000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  perform public.complete_current_customer_external_payment('59510000-0000-0000-0000-000000000006',3);
end $$;
reset role;
rollback;
