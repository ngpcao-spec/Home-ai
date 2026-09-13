-- Run with the proposed migration in one transaction; all fixtures roll back.
begin;
insert into auth.users(instance_id,id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated','arrival-'||id||'@test.invalid','{}','{}',now(),now()
from (select ('59700000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid id from generate_series(1,6)n)v;
insert into public.profiles(user_id,role,display_name)values
('59700000-0000-0000-0000-000000000001','provider','Synthetic arrival A'),
('59700000-0000-0000-0000-000000000002','provider','Synthetic arrival B'),
('59700000-0000-0000-0000-000000000003','customer','Synthetic arrival client');
insert into public.profiles(user_id,role,display_name)select ('59700000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'customer','Synthetic arrival client'from generate_series(4,6)n;
insert into public.provider_profiles(provider_id,active,kyc_status,specialty)values
('59700000-0000-0000-0000-000000000001',true,'verified','Electricity'),('59700000-0000-0000-0000-000000000002',true,'verified','Electricity');
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status)
select ('59700000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('59700000-0000-0000-0000-'||lpad((n-7)::text,12,'0'))::uuid,'59700000-0000-0000-0000-000000000001','electricity','Synthetic arrival','Test',12.2,109.2,'travelling'from generate_series(10,13)n;
insert into public.provider_status(provider_id,online,available,current_mission_id,last_latitude,last_longitude,last_location_at)values
('59700000-0000-0000-0000-000000000001',true,false,'59700000-0000-0000-0000-000000000010',12.2,109.2,now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
 begin perform public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000010','arrived',12.2,109.2);raise exception 'other provider accepted';exception when insufficient_privilege then null;end;
end $$;
set local "request.jwt.claims"='{"sub":"59700000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000010','arrived',12.2,109.2);
do $$ begin
 if not exists(select 1 from public.missions where id='59700000-0000-0000-0000-000000000010'and status='arrived')then raise exception 'near arrival failed';end if;
 begin perform public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000010','arrived',12.2,109.2);raise exception 'invalid state accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update public.provider_status set current_mission_id='59700000-0000-0000-0000-000000000011'where provider_id='59700000-0000-0000-0000-000000000001';
set local role authenticated;
select public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000011','arrived',12.3,109.3);
do $$ begin
 if not exists(select 1 from public.mission_events where mission_id='59700000-0000-0000-0000-000000000011'and payload->>'arrival_mode'='manual'and(payload->>'observed_distance_km')::numeric>0.15)then raise exception 'far arrival audit missing';end if;
end $$;
reset role;
update public.provider_status set current_mission_id='59700000-0000-0000-0000-000000000012',last_location_at=now()-interval '1 hour'where provider_id='59700000-0000-0000-0000-000000000001';
set local role authenticated;
select public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000012','arrived',null,null);
do $$ begin
 if not exists(select 1 from public.provider_status where provider_id='59700000-0000-0000-0000-000000000001'and last_location_at<now()-interval '30 minutes'and last_latitude=12.3)then raise exception 'manual arrival falsified GPS';end if;
end $$;
reset role;
update public.provider_status set current_mission_id='59700000-0000-0000-0000-000000000013',last_latitude=null,last_longitude=null,last_location_at=null where provider_id='59700000-0000-0000-0000-000000000001';
set local role authenticated;
select public.update_current_provider_mission_progress('59700000-0000-0000-0000-000000000013','arrived',null,null);
reset role;
do $$ begin
 if has_function_privilege('anon','public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision)','EXECUTE')then raise exception 'anonymous RPC exposure';end if;
 if not(select relrowsecurity from pg_class where oid='public.missions'::regclass)then raise exception 'RLS disabled';end if;
end $$;
select 'PASS: near/far/missing/stale arrival; owner/status/anonymous security; GPS integrity' as result;
rollback;
