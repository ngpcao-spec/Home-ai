-- Run after all migrations against an isolated Supabase database.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'profile-customer@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'profile-customer2@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'profile-provider@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (user_id, role, display_name)
values
  ('11000000-0000-0000-0000-000000000002', 'customer', 'Other customer'),
  ('21000000-0000-0000-0000-000000000001', 'provider', 'Provider protected');
insert into public.customer_addresses (id, customer_id, label, address_text, is_default)
values ('51000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'Private', 'Other address', true);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.upsert_current_customer_profile('Customer persisted', '+84912345678', null);
do $$
declare created_role public.app_role;
begin
  select role into created_role from public.profiles where user_id = auth.uid();
  if created_role <> 'customer' then raise exception 'RPC created a non-customer role'; end if;
end;
$$;

select public.save_current_customer_address(null, 'Nhà', 'Nha Trang', true);
select public.save_current_customer_address(null, 'Văn phòng', 'Trần Phú, Nha Trang', false);
do $$
begin
  if (select count(*) from public.customer_addresses where customer_id = auth.uid()) <> 2 then
    raise exception 'Customer addresses were not persisted';
  end if;
  if (select count(*) from public.customer_addresses where customer_id = auth.uid() and is_default) <> 1 then
    raise exception 'Exactly one default address is required';
  end if;
end;
$$;

-- The caller cannot target another identity or choose provider/admin fields: RPC signatures expose neither.
do $$
begin
  begin
    perform public.save_current_customer_address(
      (select id from public.customer_addresses where customer_id = auth.uid() limit 1),
      'Nhà cập nhật', 'Nha Trang', true
    );
  exception when others then
    raise exception 'Owner address update unexpectedly failed: %', sqlerrm;
  end;
  if exists (
    select 1 from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'upsert_current_customer_profile%'
      and parameter_name in ('role', 'user_id', 'status')
  ) then raise exception 'Privilege-bearing profile parameter exposed'; end if;

  begin
    perform public.delete_current_customer_address('51000000-0000-0000-0000-000000000002');
    raise exception 'Cross-customer address deletion succeeded';
  exception when sqlstate 'P0002' then null;
  end;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'upsert_current_customer_profile', 'save_current_customer_address',
        'set_current_customer_default_address', 'delete_current_customer_address'
      )
      and not ('search_path=' = any(coalesce(p.proconfig, array[]::text[])))
  ) then raise exception 'A customer persistence RPC has an unsafe search_path'; end if;
end;
$$;

set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  begin
    perform public.upsert_current_customer_profile('Escalated', '+84999999999', null);
    raise exception 'Provider used customer profile RPC';
  exception when sqlstate '42501' then null;
  end;
  if (select role from public.profiles where user_id = auth.uid()) <> 'provider' then
    raise exception 'Provider role changed';
  end if;
end;
$$;

reset role;
rollback;
