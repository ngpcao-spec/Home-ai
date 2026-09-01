-- HOME AI MVP - Authorization helpers, invariants and minimal RLS policies.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.status = 'active'
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

create or replace function private.is_mission_participant(target_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.missions m
    where m.id = target_mission_id
      and ((select auth.uid()) = m.client_id or (select auth.uid()) = m.provider_id)
  )
$$;

create or replace function private.is_client_for_mission(target_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.missions m
    where m.id = target_mission_id and m.client_id = (select auth.uid())
  )
$$;

create or replace function private.is_provider_for_mission(target_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.missions m
    where m.id = target_mission_id and m.provider_id = (select auth.uid())
  )
$$;

create or replace function private.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id = (select auth.uid())
    or private.is_admin()
    or exists (
      select 1
      from public.provider_profiles pp
      join public.profiles p on p.user_id = pp.provider_id
      where pp.provider_id = target_user_id
        and pp.active
        and pp.kyc_status = 'verified'
        and p.status = 'active'
    )
    or exists (
      select 1
      from public.missions m
      where ((select auth.uid()) = m.client_id or (select auth.uid()) = m.provider_id)
        and (target_user_id = m.client_id or target_user_id = m.provider_id)
    )
$$;

create or replace function private.can_create_review(target_mission_id uuid, target_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.missions m
    where m.id = target_mission_id
      and m.client_id = (select auth.uid())
      and m.provider_id = target_provider_id
      and m.status = 'completed'
  )
$$;

create or replace function private.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.role()) = 'service_role', false)
$$;

create or replace function private.profile_has_role(target_user_id uuid, expected_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = target_user_id
      and p.role = expected_role
      and p.status = 'active'
  )
$$;

create or replace function private.lock_quote(target_quote_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_quote_id::text, 4815162342)
  )
$$;

create or replace function private.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and not private.is_admin()
     and not private.is_service_role() then
    raise exception 'Only an administrator or the service role may change an application role.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role and old.role = 'customer' and (
    exists (select 1 from public.customer_addresses a where a.customer_id = old.user_id)
    or exists (select 1 from public.missions m where m.client_id = old.user_id)
  ) then
    raise exception 'A customer role cannot change while customer-owned records exist.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.role is distinct from old.role and old.role = 'provider' and exists (
    select 1 from public.provider_profiles pp where pp.provider_id = old.user_id
  ) then
    raise exception 'A provider role cannot change while a provider profile exists.'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create or replace function private.validate_business_relationships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mission_row public.missions%rowtype;
  profile_role public.app_role;
  parent_row public.quotes%rowtype;
begin
  if tg_table_name = 'customer_addresses' then
    if not private.profile_has_role(new.customer_id, 'customer') then
      raise exception 'customer_id must reference an active customer.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'provider_profiles' then
    if not private.profile_has_role(new.provider_id, 'provider') then
      raise exception 'provider_id must reference an active provider.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'missions' then
    if tg_op = 'UPDATE' and old.client_id is distinct from new.client_id then
      raise exception 'A mission customer is immutable.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE'
       and old.provider_id is not null
       and old.provider_id is distinct from new.provider_id then
      raise exception 'An assigned mission provider is immutable.' using errcode = 'check_violation';
    end if;
    if not private.profile_has_role(new.client_id, 'customer') then
      raise exception 'client_id must reference an active customer.' using errcode = 'foreign_key_violation';
    end if;
    if new.provider_id is not null and not private.profile_has_role(new.provider_id, 'provider') then
      raise exception 'provider_id must reference an active provider.' using errcode = 'foreign_key_violation';
    end if;
    if new.address_id is not null and not exists (
      select 1 from public.customer_addresses a
      where a.id = new.address_id and a.customer_id = new.client_id
    ) then
      raise exception 'address_id must belong to the mission customer.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'mission_offers' then
    if not private.profile_has_role(new.provider_id, 'provider') then
      raise exception 'Offer provider_id must reference an active provider.' using errcode = 'foreign_key_violation';
    end if;
    select * into strict mission_row from public.missions where id = new.mission_id;
    if mission_row.provider_id is not null and mission_row.provider_id <> new.provider_id then
      raise exception 'An assigned mission cannot be offered to another provider.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'provider_status' then
    if new.current_mission_id is not null then
      select * into strict mission_row from public.missions where id = new.current_mission_id;
      if mission_row.provider_id is distinct from new.provider_id then
        raise exception 'current_mission_id must be assigned to this provider.' using errcode = 'foreign_key_violation';
      end if;
    end if;

  elsif tg_table_name = 'provider_locations' then
    if not private.profile_has_role(new.provider_id, 'provider') then
      raise exception 'Location provider_id must reference an active provider.' using errcode = 'foreign_key_violation';
    end if;
    select * into strict mission_row from public.missions where id = new.mission_id;
    if mission_row.provider_id is distinct from new.provider_id then
      raise exception 'Location provider_id must be the provider assigned to the mission.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'reviews' then
    select * into strict mission_row from public.missions where id = new.mission_id;
    if mission_row.client_id is distinct from new.client_id
       or mission_row.provider_id is distinct from new.provider_id
       or mission_row.status <> 'completed' then
      raise exception 'Review parties must match a completed mission.' using errcode = 'foreign_key_violation';
    end if;

  elsif tg_table_name = 'quotes' then
    if tg_op = 'INSERT' and (
      (new.type = 'initial' and new.status <> 'pending')
      or (new.type = 'supplement' and new.status <> 'supplement_pending')
    ) then
      raise exception 'A quote must be created in its pending status.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and old.status is distinct from new.status and not (
      (old.status = 'pending' and new.status in ('accepted', 'declined'))
      or (old.status = 'supplement_pending' and new.status in ('accepted', 'rejected'))
    ) then
      raise exception 'Invalid quote status transition: % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    select * into strict mission_row from public.missions where id = new.mission_id;
    if mission_row.provider_id is null
       or mission_row.provider_id is distinct from new.created_by
       or not private.profile_has_role(new.created_by, 'provider') then
      raise exception 'Quote creator must be the provider assigned to the mission.' using errcode = 'foreign_key_violation';
    end if;
    if new.decided_by is not null and new.decided_by is distinct from mission_row.client_id then
      raise exception 'Quote decision must be made by the mission customer.' using errcode = 'foreign_key_violation';
    end if;
    if new.parent_quote_id is not null then
      select * into strict parent_row from public.quotes where id = new.parent_quote_id;
      if parent_row.mission_id is distinct from new.mission_id
         or parent_row.version >= new.version
         or parent_row.status <> 'accepted' then
        raise exception 'A supplement parent must be an earlier accepted quote for the same mission.'
          using errcode = 'foreign_key_violation';
      end if;
    end if;

  elsif tg_table_name = 'mission_events' then
    if (new.actor_user_id is null) <> (new.actor_role is null) then
      raise exception 'actor_user_id and actor_role must both be null or both be set.' using errcode = 'check_violation';
    end if;
    if new.actor_user_id is not null then
      select p.role into strict profile_role from public.profiles p where p.user_id = new.actor_user_id;
      if profile_role is distinct from new.actor_role then
        raise exception 'actor_role must match the actor profile role.' using errcode = 'check_violation';
      end if;
      select * into strict mission_row from public.missions where id = new.mission_id;
      if new.actor_user_id <> mission_row.client_id
         and new.actor_user_id is distinct from mission_row.provider_id
         and profile_role <> 'admin' then
        raise exception 'Mission event actor must be a participant or administrator.' using errcode = 'foreign_key_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.get_profile_phone(target_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if target_user_id <> (select auth.uid())
     and not private.is_admin()
     and not exists (
       select 1 from public.missions m
       where ((select auth.uid()) = m.client_id or (select auth.uid()) = m.provider_id)
         and (target_user_id = m.client_id or target_user_id = m.provider_id)
     ) then
    raise exception 'Phone access requires mission participation.' using errcode = 'insufficient_privilege';
  end if;

  select p.phone into result from public.profiles p where p.user_id = target_user_id;
  return result;
end;
$$;

revoke all on function private.current_app_role() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.is_mission_participant(uuid) from public;
revoke all on function private.is_client_for_mission(uuid) from public;
revoke all on function private.is_provider_for_mission(uuid) from public;
revoke all on function private.can_view_profile(uuid) from public;
revoke all on function private.can_create_review(uuid, uuid) from public;
revoke all on function private.is_service_role() from public;
revoke all on function private.profile_has_role(uuid, public.app_role) from public;
revoke all on function private.lock_quote(uuid) from public;
revoke all on function private.protect_profile_role() from public;
revoke all on function private.validate_business_relationships() from public;
revoke all on function public.get_profile_phone(uuid) from public;

grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_mission_participant(uuid) to authenticated;
grant execute on function private.is_client_for_mission(uuid) to authenticated;
grant execute on function private.is_provider_for_mission(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_create_review(uuid, uuid) to authenticated;
grant execute on function public.get_profile_phone(uuid) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.protect_accepted_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_quote(old.id);

  if tg_op = 'DELETE' then
    if old.status = 'accepted' then
      raise exception 'An accepted quote is immutable; create a new quote version instead.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'accepted' then
    raise exception 'An accepted quote is immutable; create a new quote version instead.'
      using errcode = 'check_violation';
  end if;

  if new.status = 'accepted' and row(
    old.mission_id,
    old.version,
    old.parent_quote_id,
    old.type,
    old.diagnosis,
    old.total_amount,
    old.currency,
    old.warranty_days,
    old.created_by,
    old.created_at
  ) is distinct from row(
    new.mission_id,
    new.version,
    new.parent_quote_id,
    new.type,
    new.diagnosis,
    new.total_amount,
    new.currency,
    new.warranty_days,
    new.created_by,
    new.created_at
  ) then
    raise exception 'Quote content cannot change while accepting it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function private.protect_accepted_quote_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_quote_accepted boolean := false;
  new_quote_accepted boolean := false;
begin
  if tg_op = 'INSERT' then
    perform private.lock_quote(new.quote_id);
  elsif tg_op = 'DELETE' then
    perform private.lock_quote(old.quote_id);
  elsif old.quote_id = new.quote_id then
    perform private.lock_quote(new.quote_id);
  elsif old.quote_id::text < new.quote_id::text then
    perform private.lock_quote(old.quote_id);
    perform private.lock_quote(new.quote_id);
  else
    perform private.lock_quote(new.quote_id);
    perform private.lock_quote(old.quote_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select q.status = 'accepted'
      into old_quote_accepted
      from public.quotes q
      where q.id = old.quote_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select q.status = 'accepted'
      into new_quote_accepted
      from public.quotes q
      where q.id = new.quote_id;
  end if;

  if coalesce(old_quote_accepted, false) or coalesce(new_quote_accepted, false) then
    raise exception 'Items of an accepted quote are immutable; create a new quote version instead.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function private.validate_quote_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_quote_id uuid;
  target_quote_ids uuid[];
  expected_total bigint;
  items_total bigint;
begin
  if tg_table_name = 'quotes' then
    target_quote_ids := array[case when tg_op = 'DELETE' then old.id else new.id end];
  elsif tg_op = 'INSERT' then
    target_quote_ids := array[new.quote_id];
  elsif tg_op = 'DELETE' then
    target_quote_ids := array[old.quote_id];
  else
    target_quote_ids := array[old.quote_id, new.quote_id];
  end if;

  foreach target_quote_id in array target_quote_ids loop
    if target_quote_id is not null
       and exists (select 1 from public.quotes q where q.id = target_quote_id) then
      perform private.lock_quote(target_quote_id);
      select q.total_amount into expected_total from public.quotes q where q.id = target_quote_id;
      select coalesce(sum(qi.amount), 0) into items_total
        from public.quote_items qi where qi.quote_id = target_quote_id;

      if expected_total is distinct from items_total then
        raise exception 'Quote total (%) must equal the sum of quote items (%).', expected_total, items_total
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function private.prevent_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.protect_accepted_quote() from public;
revoke all on function private.protect_accepted_quote_items() from public;
revoke all on function private.prevent_append_only_mutation() from public;
revoke all on function private.validate_quote_total() from public;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger customer_addresses_set_updated_at before update on public.customer_addresses
  for each row execute function private.set_updated_at();
create trigger provider_profiles_set_updated_at before update on public.provider_profiles
  for each row execute function private.set_updated_at();
create trigger provider_services_set_updated_at before update on public.provider_services
  for each row execute function private.set_updated_at();
create trigger provider_status_set_updated_at before update on public.provider_status
  for each row execute function private.set_updated_at();
create trigger missions_set_updated_at before update on public.missions
  for each row execute function private.set_updated_at();
create trigger mission_offers_set_updated_at before update on public.mission_offers
  for each row execute function private.set_updated_at();
create trigger device_tokens_set_updated_at before update on public.device_tokens
  for each row execute function private.set_updated_at();

create trigger profiles_protect_role before update on public.profiles
  for each row execute function private.protect_profile_role();

create trigger customer_addresses_validate_relationships before insert or update on public.customer_addresses
  for each row execute function private.validate_business_relationships();
create trigger provider_profiles_validate_relationships before insert or update on public.provider_profiles
  for each row execute function private.validate_business_relationships();
create trigger missions_validate_relationships before insert or update on public.missions
  for each row execute function private.validate_business_relationships();
create trigger mission_offers_validate_relationships before insert or update on public.mission_offers
  for each row execute function private.validate_business_relationships();
create trigger provider_status_validate_relationships before insert or update on public.provider_status
  for each row execute function private.validate_business_relationships();
create trigger provider_locations_validate_relationships before insert or update on public.provider_locations
  for each row execute function private.validate_business_relationships();
create trigger reviews_validate_relationships before insert or update on public.reviews
  for each row execute function private.validate_business_relationships();
create trigger quotes_validate_relationships before insert or update on public.quotes
  for each row execute function private.validate_business_relationships();
create trigger mission_events_validate_relationships before insert or update on public.mission_events
  for each row execute function private.validate_business_relationships();

create trigger quotes_protect_accepted
  before update or delete on public.quotes
  for each row execute function private.protect_accepted_quote();
create trigger quote_items_protect_accepted
  before insert or update or delete on public.quote_items
  for each row execute function private.protect_accepted_quote_items();
create trigger mission_events_append_only
  before update or delete on public.mission_events
  for each row execute function private.prevent_append_only_mutation();
create trigger reviews_append_only
  before update or delete on public.reviews
  for each row execute function private.prevent_append_only_mutation();

create constraint trigger quotes_total_matches_items
  after insert or update on public.quotes
  deferrable initially deferred
  for each row execute function private.validate_quote_total();
create constraint trigger quote_items_total_matches_quote
  after insert or update or delete on public.quote_items
  deferrable initially deferred
  for each row execute function private.validate_quote_total();

alter table public.profiles enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.provider_services enable row level security;
alter table public.provider_status enable row level security;
alter table public.missions enable row level security;
alter table public.mission_offers enable row level security;
alter table public.mission_events enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.provider_locations enable row level security;
alter table public.reviews enable row level security;
alter table public.device_tokens enable row level security;
alter table public.notification_outbox enable row level security;

revoke all on table
  public.profiles,
  public.customer_addresses,
  public.provider_profiles,
  public.provider_services,
  public.provider_status,
  public.missions,
  public.mission_offers,
  public.mission_events,
  public.quotes,
  public.quote_items,
  public.provider_locations,
  public.reviews,
  public.device_tokens,
  public.notification_outbox
from anon;

grant select, insert, update, delete on table
  public.customer_addresses,
  public.provider_profiles,
  public.provider_services,
  public.provider_status,
  public.missions,
  public.mission_offers,
  public.mission_events,
  public.quotes,
  public.quote_items,
  public.provider_locations,
  public.reviews,
  public.device_tokens,
  public.notification_outbox
to authenticated;

grant insert, update, delete on table public.profiles to authenticated;
grant select (
  user_id,
  role,
  display_name,
  avatar_url,
  status,
  created_at,
  updated_at
) on public.profiles to authenticated;

revoke all on sequence
  public.mission_events_id_seq,
  public.provider_locations_id_seq,
  public.notification_outbox_id_seq
from anon;
grant usage, select on sequence
  public.mission_events_id_seq,
  public.provider_locations_id_seq,
  public.notification_outbox_id_seq
to authenticated;

-- Profiles: authenticated users see themselves, verified providers and mission counterparts.
create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (private.can_view_profile(user_id));
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Customer address ownership. Providers consume the denormalized mission address instead.
create policy customer_addresses_owner_all on public.customer_addresses
  for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()) and private.current_app_role() = 'customer');
create policy customer_addresses_admin_all on public.customer_addresses
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Provider catalog is readable only for verified active providers, plus self/admin.
create policy provider_profiles_select_visible on public.provider_profiles
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or private.is_admin()
    or (active and kyc_status = 'verified')
  );
create policy provider_profiles_admin_all on public.provider_profiles
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy provider_services_select_visible on public.provider_services
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or private.is_admin()
    or (
      enabled and exists (
        select 1 from public.provider_profiles pp
        where pp.provider_id = provider_services.provider_id
          and pp.active and pp.kyc_status = 'verified'
      )
    )
  );
create policy provider_services_admin_all on public.provider_services
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Provider status writes remain server/RPC-owned to protect availability and assignment.
create policy provider_status_select_related on public.provider_status
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or private.is_admin()
    or (current_mission_id is not null and private.is_mission_participant(current_mission_id))
  );
create policy provider_status_admin_all on public.provider_status
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Mission mutations are deliberately server/RPC-owned.
create policy missions_participant_select on public.missions
  for select to authenticated
  using (private.is_mission_participant(id));
create policy missions_admin_all on public.missions
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy mission_offers_related_select on public.mission_offers
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or private.is_mission_participant(mission_id)
  );
create policy mission_offers_admin_all on public.mission_offers
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy mission_events_participant_select on public.mission_events
  for select to authenticated
  using (private.is_mission_participant(mission_id));
create policy mission_events_admin_insert on public.mission_events
  for insert to authenticated
  with check (private.is_admin());
create policy mission_events_admin_select on public.mission_events
  for select to authenticated
  using (private.is_admin());

create policy quotes_participant_select on public.quotes
  for select to authenticated
  using (private.is_mission_participant(mission_id));
create policy quotes_admin_all on public.quotes
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy quote_items_participant_select on public.quote_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = quote_items.quote_id
        and private.is_mission_participant(q.mission_id)
    )
  );
create policy quote_items_admin_all on public.quote_items
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Providers may append GPS snapshots only for their assigned mission.
create policy provider_locations_participant_select on public.provider_locations
  for select to authenticated
  using (private.is_mission_participant(mission_id));
create policy provider_locations_assigned_insert on public.provider_locations
  for insert to authenticated
  with check (
    provider_id = (select auth.uid())
    and private.current_app_role() = 'provider'
    and private.is_provider_for_mission(mission_id)
  );
create policy provider_locations_admin_all on public.provider_locations
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Reviews are submitted once and remain immutable.
create policy reviews_participant_select on public.reviews
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or provider_id = (select auth.uid())
    or private.is_admin()
  );
create policy reviews_client_insert on public.reviews
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and private.current_app_role() = 'customer'
    and private.can_create_review(mission_id, provider_id)
  );
create policy reviews_admin_insert on public.reviews
  for insert to authenticated
  with check (private.is_admin());

create policy device_tokens_owner_all on public.device_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_tokens_admin_all on public.device_tokens
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Outbox enqueue/delivery is server-owned; users can inspect their own notifications only.
create policy notification_outbox_owner_select on public.notification_outbox
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_outbox_admin_all on public.notification_outbox
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

comment on schema private is 'Security-definer helpers; never expose directly through the Data API.';
comment on function private.protect_accepted_quote() is 'Prevents any mutation after acceptance and prevents content changes during acceptance.';
comment on function private.protect_accepted_quote_items() is 'Prevents line-item mutation once the parent quote is accepted.';
