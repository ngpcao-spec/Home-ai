-- Run after all migrations against an isolated Supabase database.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '12000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mission-c1@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '12000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mission-c2@test.invalid', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, role, display_name) values
  ('12000000-0000-0000-0000-000000000001', 'customer', 'Mission Customer One'),
  ('12000000-0000-0000-0000-000000000002', 'customer', 'Mission Customer Two');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table mission_test_state (id uuid not null);

do $$
declare first_mission public.missions; repeated public.missions;
begin
  first_mission := public.create_current_customer_mission(
    'hvac', 'Air conditioner stopped', 'Cooling failure', null,
    'Nha Trang', 12.24, 109.19, null
  );
  repeated := public.create_current_customer_mission(
    'plumbing', 'Must not create another active mission', null, null,
    'Nha Trang', 12.24, 109.19, null
  );
  if first_mission.id <> repeated.id or first_mission.client_id <> auth.uid()
     or first_mission.status <> 'searching' or first_mission.provider_id is not null then
    raise exception 'Mission creation is not safe or idempotent';
  end if;
  if (select count(*) from public.mission_events where mission_id = first_mission.id and event_type = 'mission.created') <> 1 then
    raise exception 'Mission creation event missing or duplicated';
  end if;
  insert into mission_test_state values (first_mission.id);
end;
$$;

do $$
begin
  begin
    insert into public.missions (
      client_id, service_category, problem_description, address_text,
      client_latitude, client_longitude
    ) values (auth.uid(), 'hvac', 'Direct write', 'Nha Trang', 12.24, 109.19);
    raise exception 'Direct mission insert bypassed RPC ownership';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.missions set status = 'accepted'
    where id = (select id from mission_test_state);
    raise exception 'Direct mission status update bypassed RPC ownership';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local "request.jwt.claims" = '{"sub":"12000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare target_id uuid;
begin
  select id into target_id from mission_test_state;
  begin
    perform public.cancel_current_customer_mission(target_id, 1);
    raise exception 'Cross-customer cancellation succeeded';
  exception when sqlstate '40001' then null;
  end;
end;
$$;

set local "request.jwt.claims" = '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare cancelled public.missions;
begin
  cancelled := public.cancel_current_customer_mission((select id from mission_test_state), 1);
  if cancelled.status <> 'cancelled' or cancelled.version <> 2 or cancelled.cancelled_at is null then
    raise exception 'Owner cancellation did not persist status/version/timestamp';
  end if;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('create_current_customer_mission', 'cancel_current_customer_mission')
        and p.prosecdef and 'search_path=' = any(p.proconfig)
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        )) <> 2 then
    raise exception 'Mission RPC security configuration is invalid';
  end if;
end;
$$;

rollback;
