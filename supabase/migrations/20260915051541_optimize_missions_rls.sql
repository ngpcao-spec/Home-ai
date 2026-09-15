-- Avoid recursively querying public.missions while authorizing a missions row.
-- Preserve participant reads and the existing admin mutation capability.

drop policy if exists missions_participant_select on public.missions;
drop policy if exists missions_admin_all on public.missions;

create policy missions_select_participant_or_admin on public.missions
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or provider_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy missions_admin_insert on public.missions
  for insert to authenticated
  with check ((select private.is_admin()));

create policy missions_admin_update on public.missions
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy missions_admin_delete on public.missions
  for delete to authenticated
  using ((select private.is_admin()));

comment on policy missions_select_participant_or_admin on public.missions is
  'Direct row-column authorization; deliberately does not call is_mission_participant(id).';
