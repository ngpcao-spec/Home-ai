begin;

do $$
declare
  mission_policy text;
  message_policy text;
begin
  select qual into mission_policy from pg_policies
  where schemaname='public' and tablename='missions'
    and policyname='missions_select_participant_or_admin';
  if mission_policy is null
     or mission_policy like '%is_mission_participant%'
     or mission_policy not like '%client_id%auth.uid%'
     or mission_policy not like '%provider_id%auth.uid%'
     or mission_policy not like '%is_admin%' then
    raise exception 'missions SELECT policy is not the direct optimized policy';
  end if;

  if exists(select 1 from pg_policies where schemaname='public' and tablename='missions'
    and policyname in ('missions_participant_select','missions_admin_all')) then
    raise exception 'recursive or duplicate missions policy remains';
  end if;

  select qual into message_policy from pg_policies
  where schemaname='public' and tablename='mission_messages'
    and policyname='mission_messages_participants';
  if message_policy is null or message_policy not like '%SELECT auth.uid()%' then
    raise exception 'mission_messages auth.uid is not an initPlan';
  end if;

  if exists(select 1 from pg_indexes where schemaname='public' and tablename='quote_items'
    and indexname='quote_items_quote_idx') then
    raise exception 'redundant quote_items index remains';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='quote_items'
    and indexname='quote_items_quote_id_position_key') then
    raise exception 'quote_items unique constraint index is missing';
  end if;
end $$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('59900000-0000-0000-0000-000000000001'::uuid,'cpu-provider@test.invalid'),
  ('59900000-0000-0000-0000-000000000002'::uuid,'cpu-customer@test.invalid'),
  ('59900000-0000-0000-0000-000000000003'::uuid,'cpu-other@test.invalid'),
  ('59900000-0000-0000-0000-000000000004'::uuid,'cpu-admin@test.invalid')
) u(id,email);

insert into public.profiles(user_id,role,display_name,phone) values
  ('59900000-0000-0000-0000-000000000001','provider','CPU Provider','+84990000001'),
  ('59900000-0000-0000-0000-000000000002','customer','CPU Customer','+84990000002'),
  ('59900000-0000-0000-0000-000000000003','customer','CPU Other','+84990000003'),
  ('59900000-0000-0000-0000-000000000004','admin','CPU Admin','+84990000004');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('59900000-0000-0000-0000-000000000001','Electricity','verified',true);
insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('59900000-0000-0000-0000-000000000010','59900000-0000-0000-0000-000000000002',
   '59900000-0000-0000-0000-000000000001','electricity','CPU RLS test','Nha Trang',12.2,109.2,'accepted');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"59900000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if not exists(select from public.missions where id='59900000-0000-0000-0000-000000000010') then
    raise exception 'Customer cannot read own mission'; end if;
end $$;
set local "request.jwt.claims"='{"sub":"59900000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if not exists(select from public.missions where id='59900000-0000-0000-0000-000000000010') then
    raise exception 'Provider cannot read assigned mission'; end if;
end $$;
set local "request.jwt.claims"='{"sub":"59900000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if exists(select from public.missions where id='59900000-0000-0000-0000-000000000010') then
    raise exception 'Unrelated customer can read mission'; end if;
end $$;
set local "request.jwt.claims"='{"sub":"59900000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if not exists(select from public.missions where id='59900000-0000-0000-0000-000000000010') then
    raise exception 'Admin lost mission read access'; end if;
end $$;

rollback;
