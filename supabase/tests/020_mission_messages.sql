-- Run after mission_messages migration. All fixtures are rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('59200000-0000-0000-0000-000000000001'::uuid,'call-provider-a@test.invalid'),
  ('59200000-0000-0000-0000-000000000002'::uuid,'call-provider-b@test.invalid'),
  ('59200000-0000-0000-0000-000000000003'::uuid,'call-customer-a@test.invalid'),
  ('59200000-0000-0000-0000-000000000004'::uuid,'call-customer-b@test.invalid'),
  ('59200000-0000-0000-0000-000000000005'::uuid,'call-customer-searching@test.invalid')
) u(id,email);

insert into public.profiles(user_id,role,display_name,phone) values
  ('59200000-0000-0000-0000-000000000001','provider','Call Provider A','+84910000001'),
  ('59200000-0000-0000-0000-000000000002','provider','Call Provider B','+84910000002'),
  ('59200000-0000-0000-0000-000000000003','customer','Call Customer A','+84910000003'),
  ('59200000-0000-0000-0000-000000000004','customer','Call Customer B','+84910000004'),
  ('59200000-0000-0000-0000-000000000005','customer','Call Customer Searching','+84910000005');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('59200000-0000-0000-0000-000000000001','Electricity','verified',true),
  ('59200000-0000-0000-0000-000000000002','Plumbing','verified',true);

insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('59200000-0000-0000-0000-000000000010','59200000-0000-0000-0000-000000000003','59200000-0000-0000-0000-000000000001','electricity','Accepted call','Nha Trang',12.2,109.2,'accepted'),
  ('59200000-0000-0000-0000-000000000011','59200000-0000-0000-0000-000000000005',null,'electricity','Searching call','Nha Trang',12.2,109.2,'searching'),
  ('59200000-0000-0000-0000-000000000012','59200000-0000-0000-0000-000000000003','59200000-0000-0000-0000-000000000001','electricity','Completed call','Nha Trang',12.2,109.2,'completed'),
  ('59200000-0000-0000-0000-000000000013','59200000-0000-0000-0000-000000000003',null,'electricity','Cancelled call','Nha Trang',12.2,109.2,'cancelled');


set local role authenticated;
set local "request.jwt.claims"='{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare r public.mission_messages; n integer;
begin
 r:=public.send_mission_message('59200000-0000-0000-0000-000000000010','Client message');
 if r.sender_user_id<>auth.uid() then raise exception 'Sender not derived';end if;
 perform public.send_mission_message(r.mission_id,repeat('a',500));
 begin perform public.send_mission_message(r.mission_id,repeat('a',501));raise exception 'Oversize allowed';exception when sqlstate '22023' then null;end;
 begin perform public.send_mission_message(r.mission_id,'  ');raise exception 'Blank allowed';exception when sqlstate '22023' then null;end;
 begin insert into public.mission_messages(mission_id,sender_user_id,body)values(r.mission_id,auth.uid(),'Direct');raise exception 'Direct insert allowed';exception when insufficient_privilege then null;end;
 begin update public.mission_messages set body='Tamper';raise exception 'Direct update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.mission_messages;raise exception 'Direct delete allowed';exception when insufficient_privilege then null;end;
 select count(*) into n from public.get_mission_messages(r.mission_id);if n<>2 then raise exception 'Owner list failed';end if;
 begin perform public.send_mission_message('59200000-0000-0000-0000-000000000012','Completed');raise exception 'Completed allowed';exception when sqlstate '55000' then null;end;
 begin perform public.get_mission_messages('59200000-0000-0000-0000-000000000012');raise exception 'Completed list allowed';exception when sqlstate '55000' then null;end;
end $$;
set local "request.jwt.claims"='{"sub":"59200000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ declare r public.mission_messages; n integer;
begin
 r:=public.send_mission_message('59200000-0000-0000-0000-000000000010','Provider message');if r.sender_user_id<>auth.uid() then raise exception 'Provider sender';end if;
 select count(*) into n from public.mission_messages where mission_id=r.mission_id;if n<>3 then raise exception 'Participant RLS';end if;
end $$;
set local "request.jwt.claims"='{"sub":"59200000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
 if exists(select from public.mission_messages) then raise exception 'Other provider RLS';end if;
 begin perform public.send_mission_message('59200000-0000-0000-0000-000000000010','Other');raise exception 'Other provider allowed';exception when insufficient_privilege then null;end;
 begin perform public.get_mission_messages('59200000-0000-0000-0000-000000000010');raise exception 'Other provider list';exception when insufficient_privilege then null;end;
end $$;
set local "request.jwt.claims"='{"sub":"59200000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
 if exists(select from public.mission_messages) then raise exception 'Other client RLS';end if;
 begin perform public.send_mission_message('59200000-0000-0000-0000-000000000010','Other');raise exception 'Other client allowed';exception when insufficient_privilege then null;end;
 begin perform public.get_mission_messages('59200000-0000-0000-0000-000000000010');raise exception 'Other client list';exception when insufficient_privilege then null;end;
end $$;
set local "request.jwt.claims"='{"sub":"59200000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
 begin perform public.send_mission_message('59200000-0000-0000-0000-000000000011','Searching');raise exception 'Searching allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
set local "request.jwt.claims"='{}';
do $$ begin
 begin perform public.send_mission_message('59200000-0000-0000-0000-000000000010','Anon');raise exception 'Anonymous send';exception when insufficient_privilege then null;end;
 begin perform public.get_mission_messages('59200000-0000-0000-0000-000000000010');raise exception 'Anonymous list';exception when insufficient_privilege then null;end;
 begin perform * from public.mission_messages;raise exception 'Anonymous select';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare candidate public.mission_status; r public.mission_messages;
begin
 perform set_config('request.jwt.claims','{"sub":"59200000-0000-0000-0000-000000000003","role":"authenticated"}',true);
 foreach candidate in array array['completed','cancelled','expired']::public.mission_status[] loop
  update public.missions set status='accepted' where id='59200000-0000-0000-0000-000000000010';
  r:=public.send_mission_message('59200000-0000-0000-0000-000000000010','Temporary');
  update public.missions set status=candidate where id=r.mission_id;
  if exists(select from public.mission_messages where mission_id=r.mission_id)then raise exception 'Terminal retained messages %',candidate;end if;
  begin perform public.send_mission_message(r.mission_id,'Terminal');raise exception 'Terminal send %',candidate;exception when sqlstate '55000' then null;end;
  begin perform public.get_mission_messages(r.mission_id);raise exception 'Terminal list %',candidate;exception when sqlstate '55000' then null;end;
 end loop;
 foreach candidate in array array['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment']::public.mission_status[] loop
  update public.missions set status=candidate where id='59200000-0000-0000-0000-000000000010';
  r:=public.send_mission_message('59200000-0000-0000-0000-000000000010','Active');
  if r.id is null then raise exception 'Active denied %',candidate;end if;
 end loop;
 foreach candidate in array array['requested','searching','offered']::public.mission_status[] loop
  update public.missions set status=candidate where id='59200000-0000-0000-0000-000000000010';
  begin perform public.send_mission_message('59200000-0000-0000-0000-000000000010','Before acceptance');raise exception 'Preaccepted send %',candidate;exception when sqlstate '55000' then null;end;
  begin perform public.get_mission_messages('59200000-0000-0000-0000-000000000010');raise exception 'Preaccepted list %',candidate;exception when sqlstate '55000' then null;end;
 end loop;
 if not exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mission_messages')then raise exception 'Not published';end if;
end $$;
rollback;
