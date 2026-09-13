-- Live Provider tracking security and persistence. All fixtures roll back.
begin;

insert into auth.users(instance_id,id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',
  'tracking-'||id||'@test.invalid','{}','{}',now(),now()
from (values
  ('59800000-0000-0000-0000-000000000001'::uuid),
  ('59800000-0000-0000-0000-000000000002'::uuid),
  ('59800000-0000-0000-0000-000000000003'::uuid),
  ('59800000-0000-0000-0000-000000000004'::uuid)
) users(id);

insert into public.profiles(user_id,role,display_name) values
  ('59800000-0000-0000-0000-000000000001','provider','Synthetic tracking provider A'),
  ('59800000-0000-0000-0000-000000000002','provider','Synthetic tracking provider B'),
  ('59800000-0000-0000-0000-000000000003','customer','Synthetic tracking customer A'),
  ('59800000-0000-0000-0000-000000000004','customer','Synthetic tracking customer B');
insert into public.provider_profiles(provider_id,active,kyc_status,specialty) values
  ('59800000-0000-0000-0000-000000000001',true,'verified','Electricity'),
  ('59800000-0000-0000-0000-000000000002',true,'verified','Electricity');
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,
  client_latitude,client_longitude,status) values
  ('59810000-0000-0000-0000-000000000001','59800000-0000-0000-0000-000000000003',
   '59800000-0000-0000-0000-000000000001','electricity','Synthetic tracking','Test',12.25,109.20,'travelling');
insert into public.provider_status(provider_id,online,available,current_mission_id) values
  ('59800000-0000-0000-0000-000000000001',true,false,'59810000-0000-0000-0000-000000000001'),
  ('59800000-0000-0000-0000-000000000002',true,true,null);

create temporary table tracking_times(sequence integer primary key, recorded_at timestamptz);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59800000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.update_current_provider_location(12.245000,109.190000);
reset role;
insert into tracking_times select 1,last_location_at from public.provider_status where provider_id='59800000-0000-0000-0000-000000000001';
select pg_sleep(0.01);
set local role authenticated;
select public.update_current_provider_location(12.246000,109.191000);
reset role;
insert into tracking_times select 2,last_location_at from public.provider_status where provider_id='59800000-0000-0000-0000-000000000001';
select pg_sleep(0.01);
set local role authenticated;
select public.update_current_provider_location(12.247000,109.192000);
reset role;
insert into tracking_times select 3,last_location_at from public.provider_status where provider_id='59800000-0000-0000-0000-000000000001';

do $$ begin
  if not exists(select 1 from public.provider_status where provider_id='59800000-0000-0000-0000-000000000001'
    and last_latitude=12.247000 and last_longitude=109.192000) then raise exception 'backend did not persist P3'; end if;
  if (select count(*) from tracking_times where recorded_at is not null)<>3 then raise exception 'backend timestamp missing'; end if;
end $$;

-- Provider B can update only the row derived from its own auth.uid().
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59800000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.update_current_provider_location(1,1);
reset role;
do $$ begin
  if not exists(select 1 from public.provider_status where provider_id='59800000-0000-0000-0000-000000000001'
    and last_latitude=12.247000 and last_longitude=109.192000) then raise exception 'other provider overwrote tracking row'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59800000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.provider_status where current_mission_id='59810000-0000-0000-0000-000000000001')<>1 then raise exception 'owning customer cannot follow provider';end if;end $$;
set local "request.jwt.claims"='{"sub":"59800000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin if (select count(*) from public.provider_status where current_mission_id='59810000-0000-0000-0000-000000000001')<>0 then raise exception 'other customer followed provider';end if;end $$;

do $$ begin
  if has_function_privilege('anon','public.update_current_provider_location(double precision,double precision)','EXECUTE')
    then raise exception 'anonymous location update exposed'; end if;
end $$;

rollback;
