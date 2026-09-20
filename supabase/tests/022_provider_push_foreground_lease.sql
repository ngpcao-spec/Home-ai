-- Run after 20260920130000_provider_push_foreground_lease.sql. No rows persist.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('62200000-0000-0000-0000-000000000001'::uuid,'lease-provider-a@test.invalid'),
  ('62200000-0000-0000-0000-000000000002'::uuid,'lease-provider-b@test.invalid'),
  ('62200000-0000-0000-0000-000000000003'::uuid,'lease-customer@test.invalid')) u(id,email);
insert into public.profiles(user_id,role,display_name,phone) values
  ('62200000-0000-0000-0000-000000000001','provider','Lease Provider A','+84910000301'),
  ('62200000-0000-0000-0000-000000000002','provider','Lease Provider B','+84910000302'),
  ('62200000-0000-0000-0000-000000000003','customer','Lease Customer','+84910000303');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('62200000-0000-0000-0000-000000000001','Electricity','verified',true),
  ('62200000-0000-0000-0000-000000000002','Electricity','verified',true);
insert into public.provider_push_subscriptions(provider_id,installation_id,endpoint,p256dh,auth_key) values
  ('62200000-0000-0000-0000-000000000001','62200000-0000-0000-0000-000000000011',
   'https://push.example.test/lease-a','pppppppppppppppppppppppppppppppppppppppp','aaaaaaaaaaaaaaaaaaaa'),
  ('62200000-0000-0000-0000-000000000002','62200000-0000-0000-0000-000000000012',
   'https://push.example.test/lease-b','pppppppppppppppppppppppppppppppppppppppp','aaaaaaaaaaaaaaaaaaaa');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"62200000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if not public.touch_current_provider_push_installation('62200000-0000-0000-0000-000000000011',true) then
    raise exception 'Own foreground touch refused'; end if;
  if public.touch_current_provider_push_installation('62200000-0000-0000-0000-000000000012',false) then
    raise exception 'Other Provider installation touched'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.provider_push_subscriptions
    where installation_id='62200000-0000-0000-0000-000000000011'
    and foreground_until between now()+interval '44 seconds' and now()+interval '46 seconds') then
    raise exception 'Foreground lease is not 45 seconds'; end if;
  if exists(select 1 from public.provider_push_subscriptions
    where installation_id='62200000-0000-0000-0000-000000000012' and foreground_until is not null) then
    raise exception 'Other Provider lease changed'; end if;
end $$;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"62200000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.touch_current_provider_push_installation('62200000-0000-0000-0000-000000000011',false);
reset role;
do $$ begin
  if exists(select 1 from public.provider_push_subscriptions
    where installation_id='62200000-0000-0000-0000-000000000011' and foreground_until is not null) then
    raise exception 'Hidden did not clear foreground lease'; end if;
  if has_function_privilege('anon','public.touch_current_provider_push_installation(uuid,boolean)','execute') then
    raise exception 'Anon can touch Provider installation'; end if;
end $$;
rollback;
