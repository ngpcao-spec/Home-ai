-- Run only against a disposable Supabase test database after applying migrations.
-- Two sessions race on the same mission; the mission row lock permits one winner.
create schema if not exists extensions;
create extension if not exists dblink with schema extensions;

begin;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '14000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'race-c@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'race-p1@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'race-p2@test.invalid', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, role, display_name) values
  ('14000000-0000-0000-0000-000000000001', 'customer', 'Race Customer'),
  ('24000000-0000-0000-0000-000000000001', 'provider', 'Race Provider One'),
  ('24000000-0000-0000-0000-000000000002', 'provider', 'Race Provider Two');
insert into public.provider_profiles (provider_id, specialty, kyc_status, active) values
  ('24000000-0000-0000-0000-000000000001', 'HVAC', 'verified', true),
  ('24000000-0000-0000-0000-000000000002', 'HVAC', 'verified', true);
insert into public.provider_status (provider_id, online, available, last_latitude, last_longitude, last_location_at) values
  ('24000000-0000-0000-0000-000000000001', true, true, 12.241, 109.191, now()),
  ('24000000-0000-0000-0000-000000000002', true, true, 12.242, 109.192, now());
insert into public.missions (
  id, client_id, service_category, problem_description, address_text,
  client_latitude, client_longitude, status
) values (
  '34000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001', 'hvac', 'Offer race',
  'Nha Trang', 12.24, 109.19, 'offered'
);
insert into public.mission_offers (id, mission_id, provider_id, status, expires_at, match_rank) values
  ('44000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', 'pending', now() + interval '5 minutes', 1),
  ('44000000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000002', 'pending', now() + interval '5 minutes', 2);
commit;

select extensions.dblink_connect('offer_one', format('host=127.0.0.1 port=%s dbname=%s user=%s', current_setting('port'), current_database(), current_user));
select extensions.dblink_connect('offer_two', format('host=127.0.0.1 port=%s dbname=%s user=%s', current_setting('port'), current_database(), current_user));

select extensions.dblink_send_query('offer_one', $remote$
  with claims as (
    select set_config('request.jwt.claims', '{"sub":"24000000-0000-0000-0000-000000000001","role":"authenticated"}', true)
  ), accepted as (
    select (public.accept_current_provider_offer('44000000-0000-0000-0000-000000000001')).id from claims
  )
  select accepted.id from accepted cross join lateral (select pg_sleep(2)) hold_lock
$remote$);
select pg_sleep(0.25);
select extensions.dblink_send_query('offer_two', $remote$
  with claims as (
    select set_config('request.jwt.claims', '{"sub":"24000000-0000-0000-0000-000000000002","role":"authenticated"}', true)
  )
  select (public.accept_current_provider_offer('44000000-0000-0000-0000-000000000002')).id from claims
$remote$);

do $$
declare winner uuid; loser_state text;
begin
  select id into winner from extensions.dblink_get_result('offer_one') as result(id uuid);
  if winner <> '34000000-0000-0000-0000-000000000001' then
    raise exception 'First acceptance did not return the mission';
  end if;
  begin
    perform id from extensions.dblink_get_result('offer_two') as result(id uuid);
    raise exception 'Concurrent offer unexpectedly won';
  exception when others then
    get stacked diagnostics loser_state = returned_sqlstate;
    if loser_state <> '40001' then raise; end if;
  end;
  if (select count(*) from public.mission_offers where mission_id='34000000-0000-0000-0000-000000000001' and status='accepted') <> 1
     or (select provider_id from public.missions where id='34000000-0000-0000-0000-000000000001') <> '24000000-0000-0000-0000-000000000001' then
    raise exception 'Atomic offer winner invariant failed';
  end if;
  if (select status from public.mission_offers where id='44000000-0000-0000-0000-000000000002') <> 'expired'
     or exists (
       select 1 from public.mission_offers
       where mission_id='34000000-0000-0000-0000-000000000001' and status='declined'
     ) then
    raise exception 'Competing active offers must expire and must never be implicitly declined';
  end if;
end;
$$;

select extensions.dblink_disconnect('offer_one');
select extensions.dblink_disconnect('offer_two');

begin;
delete from public.missions where id='34000000-0000-0000-0000-000000000001';
delete from auth.users where id in (
  '14000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000002'
);
commit;
