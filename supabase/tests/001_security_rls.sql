-- Run only against an isolated Supabase test database after applying migrations.
begin;

create schema test_support;
create table test_support.results (test_name text primary key);

create function test_support.is_equal(actual anycompatible, expected anycompatible, test_name text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'not ok - % (actual %, expected %)', test_name, actual, expected;
  end if;
  insert into test_support.results values (test_name);
  raise notice 'ok - %', test_name;
end;
$$;

create function test_support.throws_ok(command text, expected_state text, expected_message text, test_name text)
returns void language plpgsql as $$
declare
  caught_state text;
  caught_message text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics caught_state = returned_sqlstate, caught_message = message_text;
    if caught_state is distinct from expected_state or caught_message is distinct from expected_message then
      raise exception 'not ok - % (state %, message %)', test_name, caught_state, caught_message;
    end if;
    insert into test_support.results values (test_name);
    raise notice 'ok - %', test_name;
    return;
  end;
  raise exception 'not ok - % (expected an exception)', test_name;
end;
$$;

create function test_support.finish(expected_count integer)
returns void language plpgsql as $$
declare actual_count integer;
begin
  select count(*) into actual_count from test_support.results;
  if actual_count <> expected_count then
    raise exception 'Expected % tests, executed %', expected_count, actual_count;
  end if;
  raise notice 'PASS - % tests', actual_count;
end;
$$;

grant usage on schema test_support to authenticated;
grant execute on all functions in schema test_support to authenticated;
grant select, insert on test_support.results to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c1@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c2@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p1@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p2@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (user_id, role, display_name, phone) values
  ('10000000-0000-0000-0000-000000000001', 'customer', 'Customer One', '+84900000001'),
  ('10000000-0000-0000-0000-000000000002', 'customer', 'Customer Two', '+84900000002'),
  ('20000000-0000-0000-0000-000000000001', 'provider', 'Provider One', '+84900000101'),
  ('20000000-0000-0000-0000-000000000002', 'provider', 'Provider Two', '+84900000102'),
  ('90000000-0000-0000-0000-000000000001', 'admin', 'Administrator', '+84900000999');

insert into public.provider_profiles (provider_id, specialty, kyc_status, active) values
  ('20000000-0000-0000-0000-000000000001', 'HVAC', 'verified', true),
  ('20000000-0000-0000-0000-000000000002', 'Electrical', 'verified', true);

insert into public.missions (
  id, client_id, provider_id, service_category, problem_description,
  address_text, client_latitude, client_longitude, status
) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'hvac', 'Mission one', 'Nha Trang 1', 12.24, 109.19, 'in_progress'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'electrical', 'Mission two', 'Nha Trang 2', 12.25, 109.18, 'in_progress');

insert into public.provider_locations (
  mission_id, provider_id, latitude, longitude, recorded_at
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 12.241, 109.191, now()),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 12.251, 109.181, now());

insert into public.mission_events (mission_id, event_type, actor_user_id, actor_role)
values (
  '30000000-0000-0000-0000-000000000001', 'mission.created',
  '10000000-0000-0000-0000-000000000001', 'customer'
);

insert into public.quotes (
  id, mission_id, version, type, status, diagnosis, total_amount, created_by
) values (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, 'initial', 'pending',
  'Replace capacitor', 290000, '20000000-0000-0000-0000-000000000001'
);
insert into public.quote_items (quote_id, item_type, description, amount, position) values
  ('40000000-0000-0000-0000-000000000001', 'part', 'Capacitor', 190000, 1),
  ('40000000-0000-0000-0000-000000000001', 'labor', 'Labour', 100000, 2);
set constraints all immediate;
set constraints all deferred;

update public.quotes
set status = 'accepted',
    decided_by = '10000000-0000-0000-0000-000000000001',
    decided_at = now()
where id = '40000000-0000-0000-0000-000000000001';

update public.missions
set status = 'completed', completed_at = now()
where id = '30000000-0000-0000-0000-000000000001';
insert into public.reviews (mission_id, client_id, provider_id, rating)
values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 5
);

-- Intentionally inconsistent until the deferred-total assertion below.
insert into public.quotes (
  id, mission_id, version, type, status, diagnosis, total_amount, created_by
) values (
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002', 1, 'initial', 'pending',
  'Deferred total test', 1, '20000000-0000-0000-0000-000000000002'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select test_support.is_equal(
  (select count(*) from public.missions), 1::bigint,
  'A customer sees only missions in which they participate'
);
select test_support.is_equal(
  (select count(*) from public.provider_locations), 1::bigint,
  'A customer sees locations only for their own mission'
);

update public.profiles
set role = 'admin'
where user_id = '10000000-0000-0000-0000-000000000001';
select test_support.is_equal(
  (select role::text from public.profiles where user_id = '10000000-0000-0000-0000-000000000001'),
  'customer',
  'A customer cannot change their own role'
);

select test_support.throws_ok(
  $$select public.get_profile_phone('20000000-0000-0000-0000-000000000002')$$,
  '42501',
  'Phone access requires mission participation.',
  'A customer cannot read an unrelated provider phone'
);
select test_support.is_equal(
  public.get_profile_phone('20000000-0000-0000-0000-000000000001'),
  '+84900000101',
  'A customer can read the assigned provider phone'
);

reset role;

select test_support.throws_ok(
  $$insert into public.quotes (id, mission_id, version, parent_quote_id, type, status, diagnosis, total_amount, created_by) values ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 2, '40000000-0000-0000-0000-000000000002', 'supplement', 'supplement_pending', 'Cross-mission parent', 0, '20000000-0000-0000-0000-000000000001')$$,
  '23503',
  'A supplement parent must be an earlier accepted quote for the same mission.',
  'A supplement cannot reference a quote from another mission'
);
select test_support.throws_ok(
  $$set constraints quotes_total_matches_items immediate$$,
  '23514',
  'Quote total (1) must equal the sum of quote items (0).',
  'A quote total must equal the transactional sum of its items'
);

select test_support.throws_ok(
  $$update public.quotes set diagnosis = 'Changed' where id = '40000000-0000-0000-0000-000000000001'$$,
  '23514',
  'An accepted quote is immutable; create a new quote version instead.',
  'Accepted quote content is immutable'
);
select test_support.throws_ok(
  $$update public.quote_items set amount = 1 where quote_id = '40000000-0000-0000-0000-000000000001' and position = 1$$,
  '23514',
  'Items of an accepted quote are immutable; create a new quote version instead.',
  'Accepted quote items are immutable'
);
select test_support.throws_ok(
  $$update public.quotes set status = 'declined', decided_by = '10000000-0000-0000-0000-000000000001', decided_at = now() where id = '40000000-0000-0000-0000-000000000001'$$,
  '23514',
  'An accepted quote is immutable; create a new quote version instead.',
  'Accepted quote status cannot change'
);

select test_support.throws_ok(
  $$insert into public.provider_locations (mission_id, provider_id, latitude, longitude, recorded_at) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 12.24, 109.19, now())$$,
  '23503',
  'Location provider_id must be the provider assigned to the mission.',
  'A wrong provider cannot publish a mission location'
);
select test_support.throws_ok(
  $$insert into public.mission_offers (mission_id, provider_id, expires_at) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', now() + interval '5 minutes')$$,
  '23503',
  'An assigned mission cannot be offered to another provider.',
  'An assigned mission cannot be offered to a different provider'
);
select test_support.throws_ok(
  $$insert into public.reviews (mission_id, client_id, provider_id, rating) values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 5)$$,
  '23503',
  'Review parties must match a completed mission.',
  'A review cannot use the wrong customer'
);
select test_support.throws_ok(
  $$insert into public.customer_addresses (customer_id, label, address_text) values ('20000000-0000-0000-0000-000000000001', 'Bad role', 'Nha Trang')$$,
  '23503',
  'customer_id must reference an active customer.',
  'A provider cannot be used as a customer'
);
select test_support.throws_ok(
  $$insert into public.provider_profiles (provider_id, specialty) values ('10000000-0000-0000-0000-000000000002', 'Bad role')$$,
  '23503',
  'provider_id must reference an active provider.',
  'A customer cannot be used as a provider'
);

select test_support.throws_ok(
  $$update public.mission_events set payload = '{"changed":true}' where mission_id = '30000000-0000-0000-0000-000000000001'$$,
  '23514',
  'mission_events is append-only',
  'Mission events are append-only'
);
select test_support.throws_ok(
  $$delete from public.reviews where mission_id = '30000000-0000-0000-0000-000000000001'$$,
  '23514',
  'reviews is append-only',
  'Reviews are append-only'
);

select test_support.finish(17);
rollback;
