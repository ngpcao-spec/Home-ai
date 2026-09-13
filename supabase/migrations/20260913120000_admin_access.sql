-- Admin access only. No email allowlist, automatic provisioning or new business permissions.
-- Future Admin mutations must call this authority and write a server-owned audit event.
create or replace function public.require_current_admin()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or (select auth.role()) is distinct from 'authenticated' or not private.is_admin() then
    raise exception 'Admin access denied.' using errcode='42501';
  end if;
  return jsonb_build_object('authorized',true,'userId',uid);
end $$;

revoke all on function public.require_current_admin() from public,anon,authenticated;
grant execute on function public.require_current_admin() to authenticated;
comment on function public.require_current_admin() is
  'Backend authority: active profiles.role=admin for auth.uid(). No email or user_metadata authorization. Future Admin actions must be audited without sensitive payloads.';
