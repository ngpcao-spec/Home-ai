-- Cache request-scoped helpers as initPlans and avoid duplicate permissive
-- SELECT policies on the tables evaluated most often by Postgres Changes.

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_app_role()) = 'admin', false)
$$;

create or replace function private.is_mission_participant(target_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or exists (
    select 1
    from public.missions m
    where m.id = target_mission_id
      and ((select auth.uid()) = m.client_id or (select auth.uid()) = m.provider_id)
  )
$$;

drop policy if exists mission_messages_participants on public.mission_messages;
create policy mission_messages_participants on public.mission_messages
  for select to authenticated
  using (exists (
    select 1
    from public.missions m
    where m.id = mission_messages.mission_id
      and m.provider_id is not null
      and (select auth.uid()) in (m.client_id, m.provider_id)
      and m.status in (
        'accepted','travelling','arrived','quote_pending','in_progress',
        'supplement_pending','completed_pending_payment'
      )
  ));

-- mission_offers: the participant policy already includes admins.
drop policy if exists mission_offers_admin_all on public.mission_offers;
drop policy if exists mission_offers_related_select on public.mission_offers;
create policy mission_offers_related_select on public.mission_offers
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or private.is_mission_participant(mission_id)
  );
create policy mission_offers_admin_insert on public.mission_offers
  for insert to authenticated with check ((select private.is_admin()));
create policy mission_offers_admin_update on public.mission_offers
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy mission_offers_admin_delete on public.mission_offers
  for delete to authenticated using ((select private.is_admin()));

-- mission_events: is_mission_participant already grants admin reads.
drop policy if exists mission_events_admin_select on public.mission_events;
drop policy if exists mission_events_admin_insert on public.mission_events;
create policy mission_events_admin_insert on public.mission_events
  for insert to authenticated with check ((select private.is_admin()));

-- Split admin ALL policies so SELECT evaluates one authorization expression.
drop policy if exists quotes_admin_all on public.quotes;
create policy quotes_admin_insert on public.quotes
  for insert to authenticated with check ((select private.is_admin()));
create policy quotes_admin_update on public.quotes
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy quotes_admin_delete on public.quotes
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists quote_items_admin_all on public.quote_items;
create policy quote_items_admin_insert on public.quote_items
  for insert to authenticated with check ((select private.is_admin()));
create policy quote_items_admin_update on public.quote_items
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy quote_items_admin_delete on public.quote_items
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists provider_locations_admin_all on public.provider_locations;
create policy provider_locations_admin_insert on public.provider_locations
  for insert to authenticated with check ((select private.is_admin()));
create policy provider_locations_admin_update on public.provider_locations
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy provider_locations_admin_delete on public.provider_locations
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists provider_status_admin_all on public.provider_status;
drop policy if exists provider_status_select_related on public.provider_status;
create policy provider_status_select_related on public.provider_status
  for select to authenticated
  using (
    provider_id = (select auth.uid())
    or (select private.is_admin())
    or (current_mission_id is not null and private.is_mission_participant(current_mission_id))
  );
create policy provider_status_admin_insert on public.provider_status
  for insert to authenticated with check ((select private.is_admin()));
create policy provider_status_admin_update on public.provider_status
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy provider_status_admin_delete on public.provider_status
  for delete to authenticated using ((select private.is_admin()));

-- Remaining request-scoped admin checks are cheap initPlans without changing
-- the ownership/visibility expressions or grants.
alter policy provider_profiles_select_visible on public.provider_profiles
  using (provider_id = (select auth.uid()) or (select private.is_admin()) or (active and kyc_status = 'verified'));
alter policy reviews_participant_select on public.reviews
  using (client_id = (select auth.uid()) or provider_id = (select auth.uid()) or (select private.is_admin()));
alter policy mission_invoices_participant_select on public.mission_invoices
  using (client_id = (select auth.uid()) or provider_id = (select auth.uid()) or (select private.is_admin()));
