-- Run after all migrations against an isolated Supabase database.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '13000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'match-c@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'match-p1@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'match-p2@test.invalid', '', now(), '{}', '{}', now(), now());
insert into public.profiles (user_id, role, display_name) values
  ('13000000-0000-0000-0000-000000000001', 'customer', 'Match Customer'),
  ('23000000-0000-0000-0000-000000000001', 'provider', 'Near Provider'),
  ('23000000-0000-0000-0000-000000000002', 'provider', 'Far Provider');
insert into public.provider_profiles (provider_id, specialty, kyc_status, active, service_radius_km, reliability_score) values
  ('23000000-0000-0000-0000-000000000001', 'HVAC', 'verified', true, 20, 90),
  ('23000000-0000-0000-0000-000000000002', 'HVAC', 'verified', true, 20, 99);
insert into public.provider_services (provider_id, service_category, enabled) values
  ('23000000-0000-0000-0000-000000000001', 'hvac', true),
  ('23000000-0000-0000-0000-000000000002', 'hvac', true);
insert into public.provider_status (provider_id, online, available, last_latitude, last_longitude, last_location_at) values
  ('23000000-0000-0000-0000-000000000001', true, true, 12.241, 109.191, now()),
  ('23000000-0000-0000-0000-000000000002', true, true, 12.28, 109.23, now());

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"13000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare mission_row public.missions; candidate_ids uuid[]; offer_rows public.mission_offers[];
begin
  select array_agg(provider_id order by straight_line_distance_km, provider_id)
  into candidate_ids
  from public.get_matching_provider_candidates('hvac', 12.24, 109.19, 20, interval '5 minutes');
  if candidate_ids <> array[
    '23000000-0000-0000-0000-000000000001'::uuid,
    '23000000-0000-0000-0000-000000000002'::uuid
  ] then raise exception 'Matching is not geographically deterministic'; end if;

  mission_row := public.create_current_customer_mission(
    'hvac', 'Matching test', null, null, 'Nha Trang', 12.24, 109.19, null
  );
  select array_agg(o order by o.match_rank) into offer_rows
  from public.create_current_customer_mission_offers(mission_row.id, 10) o;
  if cardinality(offer_rows) <> 2 or (offer_rows[1]).provider_id <> candidate_ids[1]
     or (offer_rows[1]).match_rank <> 1 then
    raise exception 'Offers were not persisted in deterministic order';
  end if;

  begin
    insert into public.mission_offers (mission_id, provider_id, expires_at)
    values (mission_row.id, candidate_ids[1], now() + interval '1 minute');
    raise exception 'Direct offer insert bypassed RPC ownership';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relrowsecurity) <> 14 then
    raise exception 'RLS is not enabled on all 14 public tables';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('get_matching_provider_candidates','create_current_customer_mission_offers','accept_current_provider_offer')
        and p.prosecdef and 'search_path=' = any(p.proconfig)
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee=0 and a.privilege_type='EXECUTE')) <> 3 then
    raise exception 'Matching RPC security configuration is invalid';
  end if;
end;
$$;

rollback;
