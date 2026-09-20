-- Run after 20260920120000_mission_message_provider_push.sql. No rows persist.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('62100000-0000-0000-0000-000000000001'::uuid,'message-push-provider-a@test.invalid'),
  ('62100000-0000-0000-0000-000000000002'::uuid,'message-push-provider-b@test.invalid'),
  ('62100000-0000-0000-0000-000000000003'::uuid,'message-push-client-a@test.invalid'),
  ('62100000-0000-0000-0000-000000000004'::uuid,'message-push-client-b@test.invalid')) u(id,email);
insert into public.profiles(user_id,role,display_name,phone) values
  ('62100000-0000-0000-0000-000000000001','provider','Push Provider A','+84910000201'),
  ('62100000-0000-0000-0000-000000000002','provider','Push Provider B','+84910000202'),
  ('62100000-0000-0000-0000-000000000003','customer','Push Client A','+84910000203'),
  ('62100000-0000-0000-0000-000000000004','customer','Push Client B','+84910000204');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('62100000-0000-0000-0000-000000000001','Electricity','verified',true),
  ('62100000-0000-0000-0000-000000000002','Electricity','verified',true);
insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('62100000-0000-0000-0000-000000000010','62100000-0000-0000-0000-000000000003','62100000-0000-0000-0000-000000000001','electricity','Synthetic message test','Test area',12.2,109.2,'accepted'),
  ('62100000-0000-0000-0000-000000000011','62100000-0000-0000-0000-000000000003','62100000-0000-0000-0000-000000000001','electricity','Synthetic completed test','Test area',12.2,109.2,'completed');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"62100000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.send_mission_message('62100000-0000-0000-0000-000000000010','Synthetic message');
do $$ begin
  begin perform 1 from public.provider_push_outbox;
    raise exception 'Authenticated frontend read Push outbox';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ declare message_ref uuid; begin
  select id into message_ref from public.mission_messages where mission_id='62100000-0000-0000-0000-000000000010';
  if (select count(*) from public.provider_push_outbox where message_id=message_ref and offer_id is null
      and provider_id='62100000-0000-0000-0000-000000000001')<>1 then
    raise exception 'Client message not targeted to assigned Provider'; end if;
  if (select count(*) from public.provider_push_outbox where message_id=message_ref)<>1 then
    raise exception 'Message refresh duplicated Push'; end if;
  if has_table_privilege('authenticated','public.provider_push_outbox','select')
     or has_table_privilege('anon','public.provider_push_outbox','select') then
    raise exception 'Outbox became publicly readable'; end if;
  if not has_column_privilege('service_role','public.mission_messages','mission_id','select')
     or not has_column_privilege('service_role','public.missions','client_id','select') then
    raise exception 'Push backend lacks minimal message routing columns'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"62100000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.send_mission_message('62100000-0000-0000-0000-000000000010','Provider response');
do $$ declare ref uuid; begin
  select id into ref from public.mission_messages where mission_id='62100000-0000-0000-0000-000000000010' and sender_user_id='62100000-0000-0000-0000-000000000003';
  if public.resolve_current_provider_push_message(ref)<>'62100000-0000-0000-0000-000000000010' then
    raise exception 'Assigned Provider cannot resolve message'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.provider_push_outbox where message_id is not null)<>1 then
    raise exception 'Provider self-message produced Push'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"62100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ declare ref uuid; begin
  select id into ref from public.mission_messages where mission_id='62100000-0000-0000-0000-000000000010' limit 1;
  if public.resolve_current_provider_push_message(ref) is not null then raise exception 'Other Provider resolved message'; end if;
  begin perform public.send_mission_message('62100000-0000-0000-0000-000000000010','Foreign');raise exception 'Foreign Provider sent message';
  exception when insufficient_privilege then null; end;
end $$;
set local "request.jwt.claims"='{"sub":"62100000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  begin perform public.send_mission_message('62100000-0000-0000-0000-000000000010','Foreign');raise exception 'Foreign Client sent message';
  exception when insufficient_privilege then null; end;
end $$;
set local "request.jwt.claims"='{"sub":"62100000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  begin perform public.send_mission_message('62100000-0000-0000-0000-000000000011','Terminal');raise exception 'Terminal message sent';
  exception when sqlstate '55000' then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.provider_push_outbox where message_id is not null)<>1 then
    raise exception 'Denied send produced Push'; end if;
  update public.missions set status='completed' where id='62100000-0000-0000-0000-000000000010';
  if exists(select 1 from public.provider_push_outbox where message_id is not null) then
    raise exception 'Terminal mission retained message Push metadata'; end if;
  if has_function_privilege('anon','public.resolve_current_provider_push_message(uuid)','execute') then
    raise exception 'Anon can resolve message notification'; end if;
end $$;
rollback;
