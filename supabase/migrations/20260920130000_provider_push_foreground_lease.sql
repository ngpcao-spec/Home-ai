-- Keep Provider Push foreground presence alive between 15-second client heartbeats.
-- This changes only the lease duration; ownership and subscription checks remain unchanged.
create or replace function public.touch_current_provider_push_installation(
  target_installation_id uuid,target_foreground boolean
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.provider_profiles where provider_id=auth.uid() and active
  ) then
    raise exception 'Provider authentication required' using errcode='42501';
  end if;
  update public.provider_push_subscriptions
    set last_seen_at=now(),
        foreground_until=case when target_foreground then now()+interval '45 seconds' else null end,
        updated_at=now()
    where provider_id=auth.uid() and installation_id=target_installation_id and enabled;
  return found;
end $$;
revoke all on function public.touch_current_provider_push_installation(uuid,boolean) from public,anon;
grant execute on function public.touch_current_provider_push_installation(uuid,boolean) to authenticated;
