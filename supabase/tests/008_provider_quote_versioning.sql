-- Run after migration 008 against a disposable database. Proves latest-parent
-- enforcement and serialization of simultaneous version creation.
create schema if not exists extensions;
create extension if not exists dblink with schema extensions;

begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','18000000-0000-0000-0000-000000000008','authenticated','authenticated','quote-c@test.invalid','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','28000000-0000-0000-0000-000000000008','authenticated','authenticated','quote-p@test.invalid','',now(),'{}','{}',now(),now());
insert into public.profiles(user_id,role,display_name) values
 ('18000000-0000-0000-0000-000000000008','customer','Quote Customer'),
 ('28000000-0000-0000-0000-000000000008','provider','Quote Provider');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
 ('28000000-0000-0000-0000-000000000008','Electricity','verified',true);
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status) values
 ('38000000-0000-0000-0000-000000000008','18000000-0000-0000-0000-000000000008','28000000-0000-0000-0000-000000000008','electricity','Version race','Nha Trang',12.24,109.19,'in_progress');
insert into public.quotes(id,mission_id,version,type,status,diagnosis,total_amount,created_by,decided_by,decided_at) values
 ('48000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000008',1,'initial','accepted','v1',100000,'28000000-0000-0000-0000-000000000008','18000000-0000-0000-0000-000000000008',now());
insert into public.quote_items(quote_id,item_type,description,amount,position) values
 ('48000000-0000-0000-0000-000000000001','labor','v1',100000,1);
insert into public.quotes(id,mission_id,version,parent_quote_id,type,status,diagnosis,total_amount,created_by,decided_by,decided_at) values
 ('48000000-0000-0000-0000-000000000002','38000000-0000-0000-0000-000000000008',2,'48000000-0000-0000-0000-000000000001','supplement','accepted','v2',150000,'28000000-0000-0000-0000-000000000008','18000000-0000-0000-0000-000000000008',now());
insert into public.quote_items(quote_id,item_type,description,amount,position) values
 ('48000000-0000-0000-0000-000000000002','service','v2',150000,1);
commit;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000008',true);
do $$ begin
  begin
    perform public.create_current_provider_quote_version('38000000-0000-0000-0000-000000000008','stale parent',30,
      '[{"item_type":"service","description":"v3","amount":180000}]'::jsonb,'48000000-0000-0000-0000-000000000001');
    raise exception 'parent v1 was accepted even though v2 is the latest accepted quote';
  exception when sqlstate '55000' then null; end;
end $$;

select extensions.dblink_connect('quote_create_one',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
select extensions.dblink_connect('quote_create_two',format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
select extensions.dblink_send_query('quote_create_one',$remote$
  with auth_context as (select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000008',true)),
  created as (select public.create_current_provider_quote_version('38000000-0000-0000-0000-000000000008','v3 latest parent',30,
    '[{"item_type":"service","description":"v3","amount":180000}]'::jsonb,'48000000-0000-0000-0000-000000000002') from auth_context)
  select count(*) from created cross join lateral(select pg_sleep(2)) hold_lock;
$remote$);
select pg_sleep(.25);
select extensions.dblink_send_query('quote_create_two',$remote$
  with auth_context as (select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000008',true))
  select (public.create_current_provider_quote_version('38000000-0000-0000-0000-000000000008','concurrent v3',30,
    '[{"item_type":"service","description":"v3 concurrent","amount":190000}]'::jsonb,'48000000-0000-0000-0000-000000000002')).id from auth_context;
$remote$);
select * from extensions.dblink_get_result('quote_create_one') as result(created_count bigint);
do $$ begin
  begin perform id from extensions.dblink_get_result('quote_create_two') as result(id uuid);
  exception when sqlstate '55000' then null; end;
  if (select count(*) from public.quotes where mission_id='38000000-0000-0000-0000-000000000008' and version=3 and status='supplement_pending')<>1 then
    raise exception 'Concurrent quote version creation produced more than one pending v3';
  end if;
end $$;
select extensions.dblink_disconnect('quote_create_one');
select extensions.dblink_disconnect('quote_create_two');
rollback;
