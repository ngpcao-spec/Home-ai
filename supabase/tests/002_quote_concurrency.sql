-- Run only against a disposable Supabase test database after applying migrations.
-- This test uses two database sessions to prove that acceptance and item mutation serialize.
create schema if not exists extensions;
create extension if not exists dblink with schema extensions;

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
declare caught_state text; caught_message text;
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

begin;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'concurrent-c@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'concurrent-p@test.invalid', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, role, display_name) values
  ('11000000-0000-0000-0000-000000000001', 'customer', 'Concurrent Customer'),
  ('21000000-0000-0000-0000-000000000001', 'provider', 'Concurrent Provider');
insert into public.provider_profiles (provider_id, specialty, kyc_status, active)
values ('21000000-0000-0000-0000-000000000001', 'HVAC', 'verified', true);
insert into public.missions (
  id, client_id, provider_id, service_category, problem_description,
  address_text, client_latitude, client_longitude, status
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'hvac', 'Concurrency test', 'Nha Trang', 12.24, 109.19, 'quote_pending'
);
insert into public.quotes (
  id, mission_id, version, type, status, diagnosis, total_amount, created_by
) values (
  '41000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  1, 'initial', 'pending', 'Concurrency diagnosis', 290000,
  '21000000-0000-0000-0000-000000000001'
);
insert into public.quote_items (quote_id, item_type, description, amount, position) values
  ('41000000-0000-0000-0000-000000000001', 'part', 'Part', 190000, 1),
  ('41000000-0000-0000-0000-000000000001', 'labor', 'Labour', 100000, 2);
commit;

select extensions.dblink_connect(
  'quote_accept',
  format('host=127.0.0.1 port=%s dbname=%s user=%s', current_setting('port'), current_database(), current_user)
);
select extensions.dblink_connect(
  'item_mutation',
  format('host=127.0.0.1 port=%s dbname=%s user=%s', current_setting('port'), current_database(), current_user)
);

-- Session A accepts the quote and deliberately holds the transaction open for two seconds.
select extensions.dblink_send_query(
  'quote_accept',
  $remote$
    with accepted as (
      update public.quotes
      set status = 'accepted',
          decided_by = '11000000-0000-0000-0000-000000000001',
          decided_at = now()
      where id = '41000000-0000-0000-0000-000000000001'
      returning 1
    )
    select count(*)
    from accepted
    cross join lateral (select pg_catalog.pg_sleep(2)) hold_lock
  $remote$
);

select pg_catalog.pg_sleep(0.25);

-- Session B reaches the item trigger while A owns the quote advisory lock.
select extensions.dblink_send_query(
  'item_mutation',
  $remote$
    insert into public.quote_items (quote_id, item_type, description, amount, position)
    values ('41000000-0000-0000-0000-000000000001', 'service', 'Late mutation', 0, 3)
    returning id
  $remote$
);

select test_support.is_equal(
  (select updated_count from extensions.dblink_get_result('quote_accept') as result(updated_count bigint)),
  1::bigint,
  'The acceptance transaction commits exactly one quote'
);

select test_support.throws_ok(
  $$select id from extensions.dblink_get_result('item_mutation') as result(id uuid)$$,
  '23514',
  'Items of an accepted quote are immutable; create a new quote version instead.',
  'A concurrent item mutation waits, then fails after quote acceptance commits'
);

select extensions.dblink_disconnect('quote_accept');
select extensions.dblink_disconnect('item_mutation');
select test_support.finish(2);
