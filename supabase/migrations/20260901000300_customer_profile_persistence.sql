-- Authenticated customer self-service. No browser caller can choose a role or user id.

create or replace function public.upsert_current_customer_profile(
  new_display_name text,
  new_phone text default null,
  new_avatar_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result public.profiles;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if char_length(trim(new_display_name)) not between 1 and 120 then
    raise exception 'Invalid display name.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.user_id = current_user_id and p.role <> 'customer'
  ) then
    raise exception 'Only customer profiles can use customer self-service.' using errcode = '42501';
  end if;

  insert into public.profiles (user_id, role, display_name, phone, avatar_url)
  values (
    current_user_id,
    'customer',
    trim(new_display_name),
    nullif(trim(new_phone), ''),
    nullif(trim(new_avatar_url), '')
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      avatar_url = excluded.avatar_url
  where public.profiles.user_id = current_user_id
    and public.profiles.role = 'customer'
  returning * into result;

  if result.user_id is null then
    raise exception 'Customer profile update denied.' using errcode = '42501';
  end if;
  return result;
end;
$$;

create or replace function public.save_current_customer_address(
  target_address_id uuid,
  new_label text,
  new_address_text text,
  make_default boolean default false
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result public.customer_addresses;
  must_be_default boolean;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  if char_length(trim(new_label)) not between 1 and 80
     or char_length(trim(new_address_text)) not between 1 and 500 then
    raise exception 'Invalid customer address.' using errcode = '22023';
  end if;

  perform 1 from public.customer_addresses a
  where a.customer_id = current_user_id for update;
  must_be_default := coalesce(make_default, false) or not exists (
    select 1 from public.customer_addresses a where a.customer_id = current_user_id
  );
  if must_be_default then
    update public.customer_addresses set is_default = false
    where customer_id = current_user_id and is_default;
  end if;

  if target_address_id is null then
    insert into public.customer_addresses (customer_id, label, address_text, is_default)
    values (current_user_id, trim(new_label), trim(new_address_text), must_be_default)
    returning * into result;
  else
    update public.customer_addresses
    set label = trim(new_label), address_text = trim(new_address_text),
        is_default = case when must_be_default then true else is_default end
    where id = target_address_id and customer_id = current_user_id
    returning * into result;
    if result.id is null then
      raise exception 'Customer address not found.' using errcode = 'P0002';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.set_current_customer_default_address(target_address_id uuid)
returns public.customer_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result public.customer_addresses;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  perform 1 from public.customer_addresses a
  where a.customer_id = current_user_id for update;
  if not exists (select 1 from public.customer_addresses where id = target_address_id and customer_id = current_user_id) then
    raise exception 'Customer address not found.' using errcode = 'P0002';
  end if;
  update public.customer_addresses set is_default = false
  where customer_id = current_user_id and is_default;
  update public.customer_addresses set is_default = true
  where id = target_address_id and customer_id = current_user_id;
  select * into result from public.customer_addresses where id = target_address_id;
  return result;
end;
$$;

create or replace function public.delete_current_customer_address(target_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deleted_default boolean;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  perform 1 from public.customer_addresses a
  where a.customer_id = current_user_id for update;
  delete from public.customer_addresses
  where id = target_address_id and customer_id = current_user_id
  returning is_default into deleted_default;
  if deleted_default is null then
    raise exception 'Customer address not found.' using errcode = 'P0002';
  end if;
  if deleted_default then
    update public.customer_addresses set is_default = true
    where id = (
      select id from public.customer_addresses
      where customer_id = current_user_id order by created_at, id limit 1
    );
  end if;
end;
$$;

revoke all on function public.upsert_current_customer_profile(text, text, text) from public, anon;
revoke all on function public.save_current_customer_address(uuid, text, text, boolean) from public, anon;
revoke all on function public.set_current_customer_default_address(uuid) from public, anon;
revoke all on function public.delete_current_customer_address(uuid) from public, anon;
grant execute on function public.upsert_current_customer_profile(text, text, text) to authenticated;
grant execute on function public.save_current_customer_address(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_current_customer_default_address(uuid) to authenticated;
grant execute on function public.delete_current_customer_address(uuid) to authenticated;
