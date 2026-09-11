-- Run after 20260911005000_provider_availability_schedule.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('52000000-0000-0000-0000-000000000000'::uuid,'schedule-customer@test.invalid'),
  ('52000000-0000-0000-0000-000000000001'::uuid,'schedule-provider@test.invalid'),
  ('52000000-0000-0000-0000-000000000002'::uuid,'schedule-other@test.invalid')
) users(id,email);
insert into public.profiles(user_id,role,display_name) values
  ('52000000-0000-0000-0000-000000000000','customer','Schedule Customer'),
  ('52000000-0000-0000-0000-000000000001','provider','Schedule Provider'),
  ('52000000-0000-0000-0000-000000000002','provider','Other Provider');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active,service_radius_km) values
  ('52000000-0000-0000-0000-000000000001','Electricity','verified',true,5),
  ('52000000-0000-0000-0000-000000000002','Electricity','verified',true,20);
insert into public.provider_status(provider_id,online,available,last_latitude,last_longitude,last_location_at) values
  ('52000000-0000-0000-0000-000000000001',true,true,12,109,now()),
  ('52000000-0000-0000-0000-000000000002',false,false,12,109,now());
insert into public.provider_services(provider_id,service_category,enabled) values
  ('52000000-0000-0000-0000-000000000001','electricity',true),
  ('52000000-0000-0000-0000-000000000002','electricity',true);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if public.get_current_provider_availability_preferences()<>
    '{"mode":"manual","available_24h":false,"weekly_schedule":[]}'::jsonb then
    raise exception 'Default manual mode is invalid'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Manual online provider inside radius was excluded'; end if;
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.06,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Provider outside radius remained eligible'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_current_provider_availability_preferences('scheduled',false,
  jsonb_build_array(jsonb_build_object('day',(extract(dow from now() at time zone 'Asia/Ho_Chi_Minh')::integer+3)%7,'start','08:00','end','18:00')));
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Provider outside configured hours remained eligible'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_current_provider_availability_preferences('scheduled',false,
  jsonb_build_array(jsonb_build_object(
    'day',extract(dow from now() at time zone 'Asia/Ho_Chi_Minh')::integer,
    'start',to_char((now() at time zone 'Asia/Ho_Chi_Minh')-interval '5 minutes','HH24:MI'),
    'end',to_char((now() at time zone 'Asia/Ho_Chi_Minh')+interval '5 minutes','HH24:MI'))));
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Provider inside configured hours was excluded'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_current_provider_availability_preferences('scheduled',true,'[]');
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception '24h online provider was excluded'; end if;
end $$;

reset role;
update public.provider_status set online=false,available=false where provider_id='52000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Offline provider remained eligible'; end if;
end $$;

reset role;
update public.provider_status set online=true,available=false where provider_id='52000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Busy provider remained eligible'; end if;
end $$;

reset role;
update public.provider_status set available=true,last_location_at=now()-interval '10 minutes' where provider_id='52000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='52000000-0000-0000-0000-000000000001') then
    raise exception 'Stale GPS provider remained eligible'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"52000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ declare affected integer;
begin
  begin
    update public.provider_availability_preferences set availability_mode='manual'
      where provider_id='52000000-0000-0000-0000-000000000002';
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Provider changed another provider schedule'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_current_provider_availability_preferences('scheduled',false,'[]');
    raise exception 'Empty scheduled mode was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

reset role;
do $$ declare candidate_body text:=pg_get_functiondef('public.get_matching_provider_candidates(text,double precision,double precision,integer,interval)'::regprocedure);
  dispatch_body text:=pg_get_functiondef('private.dispatch_next_mission_offer(uuid,interval,interval)'::regprocedure);
  accept_body text:=pg_get_functiondef('public.accept_current_provider_offer(uuid)'::regprocedure);
begin
  if candidate_body not like '%provider_schedule_allows%' or dispatch_body not like '%provider_schedule_allows%'
     or accept_body not like '%provider_schedule_allows%' then
    raise exception 'A server matching path does not enforce the provider schedule'; end if;
end $$;

rollback;
