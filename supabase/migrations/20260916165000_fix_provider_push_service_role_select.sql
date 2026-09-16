-- The Push Edge Function authenticates with SUPABASE_SERVICE_ROLE_KEY.
-- RLS bypass does not imply SQL table privileges, so grant only the columns
-- required to validate an offer before sending a notification.
grant select (id, push_reference, status, expires_at, mission_id, provider_id)
  on public.mission_offers
  to service_role;

grant select (id, status, service_category, provider_id)
  on public.missions
  to service_role;

grant select (provider_id, online, available, current_mission_id)
  on public.provider_status
  to service_role;

