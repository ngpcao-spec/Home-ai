-- Synthetic identities only; execute with the proposed migration in this transaction.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{"role":"admin"}',now(),now()
from (values
  ('59400000-0000-0000-0000-000000000001'::uuid,'admin@test.invalid'),
  ('59400000-0000-0000-0000-000000000002'::uuid,'customer@test.invalid'),
  ('59400000-0000-0000-0000-000000000003'::uuid,'provider@test.invalid'),
  ('59400000-0000-0000-0000-000000000004'::uuid,'no-profile@test.invalid')
) u(id,email);
insert into public.profiles(user_id,role,display_name) values
  ('59400000-0000-0000-0000-000000000001','admin','Synthetic Admin'),
  ('59400000-0000-0000-0000-000000000002','customer','Synthetic Customer'),
  ('59400000-0000-0000-0000-000000000003','provider','Synthetic Provider');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59400000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if public.require_current_admin()<>jsonb_build_object('authorized',true,'userId',auth.uid()) then raise exception 'Admin access invalid'; end if;
end $$;
reset role;

do $$ declare actor uuid; begin
  for actor in select id from auth.users where id in (
    '59400000-0000-0000-0000-000000000002','59400000-0000-0000-0000-000000000003','59400000-0000-0000-0000-000000000004') loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
    execute 'set local role authenticated';
    begin perform public.require_current_admin(); raise exception 'Non-admin authorized'; exception when insufficient_privilege then null; end;
    if exists(select user_id from public.profiles where user_id='59400000-0000-0000-0000-000000000001') then raise exception 'Non-admin reads admin profile'; end if;
    begin update public.profiles set role='admin' where user_id=actor; exception when insufficient_privilege then null; end;
    begin insert into public.profiles(user_id,role,display_name) values(actor,'admin','Spoofed Admin'); raise exception 'Frontend promotion allowed'; exception when insufficient_privilege then null; end;
    begin perform public.upsert_current_customer_profile('role attempt',null,null); exception when insufficient_privilege then null; end;
    begin perform public.require_current_admin(); raise exception 'Self-promotion succeeded'; exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
end $$;

update public.profiles set status='suspended' where user_id='59400000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59400000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  begin perform public.require_current_admin(); raise exception 'Suspended Admin allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
set local "request.jwt.claims"='{}';
do $$ begin
  begin perform public.require_current_admin(); raise exception 'Anon Admin allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.require_current_admin()','EXECUTE') then raise exception 'Anon RPC grant'; end if;
  if not has_function_privilege('authenticated','public.require_current_admin()','EXECUTE') then raise exception 'Missing authenticated RPC grant'; end if;
end $$;
rollback;
