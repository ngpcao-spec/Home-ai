-- Answer URL is signed server-to-server. Its service-role lookup needs only
-- these routing/state columns; frontend grants and RLS remain unchanged.
grant select (id, mission_id, room_name, status, expires_at, caller_user_id, callee_user_id)
  on public.mission_calls to service_role;
grant select (id, status) on public.missions to service_role;
