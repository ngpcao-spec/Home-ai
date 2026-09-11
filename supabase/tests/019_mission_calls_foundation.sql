-- Run after 20260911120000_mission_calls_foundation.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('59000000-0000-0000-0000-000000000001'::uuid,'call-provider-a@test.invalid'),
  ('59000000-0000-0000-0000-000000000002'::uuid,'call-provider-b@test.invalid'),
  ('59000000-0000-0000-0000-000000000003'::uuid,'call-customer-a@test.invalid'),
  ('59000000-0000-0000-0000-000000000004'::uuid,'call-customer-b@test.invalid'),
  ('59000000-0000-0000-0000-000000000005'::uuid,'call-customer-searching@test.invalid')
) u(id,email);

insert into public.profiles(user_id,role,display_name,phone) values
  ('59000000-0000-0000-0000-000000000001','provider','Call Provider A','+84910000001'),
  ('59000000-0000-0000-0000-000000000002','provider','Call Provider B','+84910000002'),
  ('59000000-0000-0000-0000-000000000003','customer','Call Customer A','+84910000003'),
  ('59000000-0000-0000-0000-000000000004','customer','Call Customer B','+84910000004'),
  ('59000000-0000-0000-0000-000000000005','customer','Call Customer Searching','+84910000005');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('59000000-0000-0000-0000-000000000001','Electricity','verified',true),
  ('59000000-0000-0000-0000-000000000002','Plumbing','verified',true);

insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('59000000-0000-0000-0000-000000000010','59000000-0000-0000-0000-000000000003','59000000-0000-0000-0000-000000000001','electricity','Accepted call','Nha Trang',12.2,109.2,'accepted'),
  ('59000000-0000-0000-0000-000000000011','59000000-0000-0000-0000-000000000005',null,'electricity','Searching call','Nha Trang',12.2,109.2,'searching'),
  ('59000000-0000-0000-0000-000000000012','59000000-0000-0000-0000-000000000003','59000000-0000-0000-0000-000000000001','electricity','Completed call','Nha Trang',12.2,109.2,'completed'),
  ('59000000-0000-0000-0000-000000000013','59000000-0000-0000-0000-000000000003',null,'electricity','Cancelled call','Nha Trang',12.2,109.2,'cancelled');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$ declare c public.mission_calls; profile jsonb; caught text;
begin
  c:=public.start_mission_call('59000000-0000-0000-0000-000000000010');
  if c.caller_user_id<>'59000000-0000-0000-0000-000000000003'
     or c.callee_user_id<>'59000000-0000-0000-0000-000000000001'
     or c.status<>'ringing' or c.room_name !~ '^call_[0-9a-f]{32}$' then
    raise exception 'Client call participants or room were not derived by the server'; end if;
  if to_jsonb(c) ? 'phone' then raise exception 'Phone leaked into mission_calls'; end if;
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000010');
    raise exception 'Second open call was created';
  exception when sqlstate '40001' then null; end;
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000012');
    raise exception 'Call after completed was allowed';
  exception when sqlstate '55000' then null; end;
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000013');
    raise exception 'Call after cancelled was allowed';
  exception when sqlstate '55000' then null; end;
  begin perform public.get_profile_phone('59000000-0000-0000-0000-000000000001');
    raise exception 'Legacy phone RPC remained executable';
  exception when insufficient_privilege then null; end;
  begin perform phone from public.profiles where user_id='59000000-0000-0000-0000-000000000001';
    raise exception 'Direct phone select remained available';
  exception when insufficient_privilege then null; end;
  profile:=public.get_provider_professional_profile('59000000-0000-0000-0000-000000000001','59000000-0000-0000-0000-000000000010');
  if profile ? 'phone' then raise exception 'Public provider profile still contains phone'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$
begin
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000011');
    raise exception 'Call before accepted was allowed';
  exception when sqlstate '55000' then null; end;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$ declare c public.mission_calls;
begin
  select * into c from public.get_current_mission_call('59000000-0000-0000-0000-000000000010');
  if c.id is null then raise exception 'Participant cannot read current call'; end if;
  begin
    insert into public.mission_calls(mission_id,caller_user_id,callee_user_id,room_name,expires_at)
    values('59000000-0000-0000-0000-000000000010','59000000-0000-0000-0000-000000000003',
      '59000000-0000-0000-0000-000000000001','call_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now()+interval '1 minute');
    raise exception 'Authenticated caller inserted call directly';
  exception when insufficient_privilege then null; end;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ declare call_id uuid;
begin
  select id into call_id from public.mission_calls where mission_id='59000000-0000-0000-0000-000000000010';
  if call_id is not null then raise exception 'RLS exposed another client call'; end if;
  begin perform public.get_current_mission_call('59000000-0000-0000-0000-000000000010');
    raise exception 'Other client accessed mission call';
  exception when insufficient_privilege then null; end;
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000010');
    raise exception 'Other client started mission call';
  exception when insufficient_privilege then null; end;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ declare call_id uuid;
begin
  select id into call_id from public.mission_calls where mission_id='59000000-0000-0000-0000-000000000010';
  if call_id is not null then raise exception 'RLS exposed another provider call'; end if;
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000010');
    raise exception 'Other provider started mission call';
  exception when insufficient_privilege then null; end;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ declare c public.mission_calls;
begin
  select * into c from public.get_current_mission_call('59000000-0000-0000-0000-000000000010');
  c:=public.decline_mission_call(c.id);
  if c.status<>'declined' or c.ended_by<>'59000000-0000-0000-0000-000000000001' then
    raise exception 'Provider decline failed'; end if;
  c:=public.start_mission_call('59000000-0000-0000-0000-000000000010');
  if c.caller_user_id<>'59000000-0000-0000-0000-000000000001'
     or c.callee_user_id<>'59000000-0000-0000-0000-000000000003' then
    raise exception 'Provider callback participants were not derived'; end if;
end $$;

set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare c public.mission_calls;
begin
  select * into c from public.get_current_mission_call('59000000-0000-0000-0000-000000000010');
  c:=public.answer_mission_call(c.id);
  if c.status<>'active' or c.answered_at is null then raise exception 'Answer failed'; end if;
  c:=public.end_mission_call(c.id);
  if c.status<>'ended' or c.ended_by<>'59000000-0000-0000-0000-000000000003' then
    raise exception 'End failed'; end if;
end $$;

reset role;
do $$ declare candidate public.mission_status; c public.mission_calls;
begin
  foreach candidate in array array[
    'accepted','travelling','arrived','quote_pending','in_progress',
    'supplement_pending','completed_pending_payment'
  ]::public.mission_status[] loop
    update public.missions set status=candidate where id='59000000-0000-0000-0000-000000000010';
    perform set_config('request.jwt.claims',
      '{"sub":"59000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
    c:=public.start_mission_call('59000000-0000-0000-0000-000000000010');
    if c.status<>'ringing' then raise exception 'Callable status % did not start a call',candidate; end if;
    perform set_config('request.jwt.claims',
      '{"sub":"59000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
    c:=public.decline_mission_call(c.id);
    if c.status<>'declined' then raise exception 'Callable status % could not close its call',candidate; end if;
  end loop;
end $$;

do $$ declare candidate public.mission_status;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"59000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
  foreach candidate in array array[
    'requested','searching','offered','cancelled','expired'
  ]::public.mission_status[] loop
    update public.missions set status=candidate where id='59000000-0000-0000-0000-000000000011';
    begin
      perform public.start_mission_call('59000000-0000-0000-0000-000000000011');
      raise exception 'Non-callable status % started a call',candidate;
    exception when sqlstate '55000' then null; end;
  end loop;
end $$;

update public.missions set status='accepted' where id='59000000-0000-0000-0000-000000000010';
insert into public.mission_calls(mission_id,caller_user_id,callee_user_id,room_name,status,expires_at,created_at)
values('59000000-0000-0000-0000-000000000010','59000000-0000-0000-0000-000000000003',
  '59000000-0000-0000-0000-000000000001','call_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','ringing',
  statement_timestamp()-interval '1 second',statement_timestamp()-interval '1 minute');
do $$
begin
  if private.expire_due_mission_calls(100)<>1 then raise exception 'Missed expiration did not run'; end if;
  if not exists(select 1 from public.mission_calls where room_name='call_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' and status='missed') then
    raise exception 'Expired ringing call did not become missed'; end if;
end $$;

-- The partial unique index is the final transaction-safe concurrency guard.
do $$
begin
  insert into public.mission_calls(mission_id,caller_user_id,callee_user_id,room_name,status,expires_at)
  values('59000000-0000-0000-0000-000000000010','59000000-0000-0000-0000-000000000003',
    '59000000-0000-0000-0000-000000000001','call_cccccccccccccccccccccccccccccccc','ringing',now()+interval '1 minute');
  begin
    insert into public.mission_calls(mission_id,caller_user_id,callee_user_id,room_name,status,expires_at)
    values('59000000-0000-0000-0000-000000000010','59000000-0000-0000-0000-000000000001',
      '59000000-0000-0000-0000-000000000003','call_dddddddddddddddddddddddddddddddd','ringing',now()+interval '1 minute');
    raise exception 'Unique index allowed two open calls';
  exception when unique_violation then null; end;
end $$;

update public.missions set status='completed' where id='59000000-0000-0000-0000-000000000010';
do $$
begin
  if exists(select 1 from public.mission_calls where mission_id='59000000-0000-0000-0000-000000000010'
      and status in ('ringing','active')) then raise exception 'Terminal mission left an open call'; end if;
end $$;

-- A cancellation must close an already-open call too.
insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('59000000-0000-0000-0000-000000000014','59000000-0000-0000-0000-000000000004',
   '59000000-0000-0000-0000-000000000001','electricity','Cancelled active call',
   'Nha Trang',12.2,109.2,'accepted');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ declare c public.mission_calls;
begin
  c:=public.start_mission_call('59000000-0000-0000-0000-000000000014');
  if c.status<>'ringing' then raise exception 'Cancellation fixture call did not start'; end if;
end $$;
reset role;
update public.missions set status='cancelled' where id='59000000-0000-0000-0000-000000000014';
do $$
begin
  if exists(select 1 from public.mission_calls where mission_id='59000000-0000-0000-0000-000000000014'
      and status in ('ringing','active')) then raise exception 'Cancelled mission left an open call'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin perform public.start_mission_call('59000000-0000-0000-0000-000000000010');
    raise exception 'Completed mission accepted a new call';
  exception when sqlstate '55000' then null; end;
end $$;

reset role;
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='mission_calls') then raise exception 'mission_calls is not published'; end if;
  if not exists(select 1 from cron.job where jobname='home_ai_expire_mission_calls' and active) then
    raise exception 'mission call expiration job is inactive'; end if;
end $$;

rollback;
