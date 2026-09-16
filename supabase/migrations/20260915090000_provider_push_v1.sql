-- Provider Web Push V1. Push delivery remains subordinate to mission_offers.
create extension if not exists pg_net;

do $$
begin
  if not exists(select 1 from vault.secrets where name='provider_push_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'provider_push_webhook_secret','HOME AI Provider Push webhook authentication');
  end if;
end $$;

alter table public.mission_offers add column if not exists push_reference uuid not null default gen_random_uuid();
create unique index if not exists mission_offers_push_reference_key on public.mission_offers(push_reference);

create table if not exists public.provider_push_subscriptions(
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null, endpoint text not null unique, p256dh text not null, auth_key text not null,
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), foreground_until timestamptz, revoked_at timestamptz,
  unique(provider_id,installation_id), check(length(endpoint) between 12 and 2048 and endpoint like 'https://%'),
  check(length(p256dh) between 20 and 200), check(length(auth_key) between 8 and 100)
);
alter table public.provider_push_subscriptions enable row level security;
revoke all on public.provider_push_subscriptions from public,anon,authenticated;

create table if not exists public.provider_push_outbox(
  id uuid primary key default gen_random_uuid(), offer_id uuid not null unique references public.mission_offers(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade, status text not null default 'pending'
    check(status in ('pending','processing','sent','skipped','failed')),
  attempts integer not null default 0, created_at timestamptz not null default now(), processed_at timestamptz,
  last_error_code text
);
alter table public.provider_push_outbox enable row level security;
revoke all on public.provider_push_outbox from public,anon,authenticated;
grant all on public.provider_push_subscriptions,public.provider_push_outbox to service_role;

create or replace function public.claim_provider_push_outbox(target_outbox_id uuid,provided_secret text)
returns boolean language plpgsql security definer set search_path='' as $$
declare expected_secret text;
begin
  select decrypted_secret into expected_secret from vault.decrypted_secrets where name='provider_push_webhook_secret';
  if expected_secret is null or provided_secret is null or provided_secret<>expected_secret then return false;end if;
  update public.provider_push_outbox set status='processing',attempts=attempts+1
  where id=target_outbox_id and status='pending';
  return found;
end $$;
revoke all on function public.claim_provider_push_outbox(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_provider_push_outbox(uuid,text) to service_role;

create or replace function private.dispatch_provider_push_webhook() returns trigger language plpgsql security definer set search_path='' as $$
declare webhook_secret text;
begin
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name='provider_push_webhook_secret';
  if webhook_secret is null then raise exception 'Provider Push webhook secret is unavailable';end if;
  perform net.http_post(
    url:='https://eaoefvnpqymngiwiwuff.supabase.co/functions/v1/send-provider-push',
    body:=jsonb_build_object('outbox_id',new.id),
    headers:=jsonb_build_object('Content-Type','application/json','x-home-ai-push-secret',webhook_secret),
    timeout_milliseconds:=5000
  );
  return new;
end $$;
revoke all on function private.dispatch_provider_push_webhook() from public,anon,authenticated;
drop trigger if exists provider_push_outbox_webhook on public.provider_push_outbox;
create trigger provider_push_outbox_webhook after insert on public.provider_push_outbox
for each row execute function private.dispatch_provider_push_webhook();

create or replace function private.enqueue_provider_offer_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='pending' and new.expires_at>statement_timestamp() then
    insert into public.provider_push_outbox(offer_id,provider_id) values(new.id,new.provider_id) on conflict(offer_id) do nothing;
  end if; return new;
end $$;
drop trigger if exists mission_offer_enqueue_push on public.mission_offers;
create trigger mission_offer_enqueue_push after insert on public.mission_offers for each row execute function private.enqueue_provider_offer_push();

create or replace function public.register_current_provider_push_subscription(
  target_installation_id uuid,target_endpoint text,target_p256dh text,target_auth text
) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); saved uuid;
begin
  if uid is null or not exists(select 1 from public.provider_profiles where provider_id=uid and active) then raise exception 'Provider authentication required' using errcode='42501'; end if;
  if target_endpoint not like 'https://%' or length(target_endpoint) not between 12 and 2048 or length(target_p256dh) not between 20 and 200 or length(target_auth) not between 8 and 100 then raise exception 'Invalid push subscription' using errcode='22023'; end if;
  if exists(select 1 from public.provider_push_subscriptions where endpoint=target_endpoint and provider_id<>uid) then raise exception 'Push subscription belongs to another provider' using errcode='42501'; end if;
  insert into public.provider_push_subscriptions(provider_id,installation_id,endpoint,p256dh,auth_key)
  values(uid,target_installation_id,target_endpoint,target_p256dh,target_auth)
  on conflict(provider_id,installation_id) do update set endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_key=excluded.auth_key,enabled=true,revoked_at=null,updated_at=now(),last_seen_at=now()
  returning id into saved; return saved is not null;
end $$;

create or replace function public.get_current_provider_push_state() returns jsonb language plpgsql security definer set search_path='' stable as $$
begin if auth.uid() is null or not exists(select 1 from public.provider_profiles where provider_id=auth.uid() and active) then raise exception 'Provider authentication required' using errcode='42501';end if;
 return jsonb_build_object('enabledCount',(select count(*) from public.provider_push_subscriptions where provider_id=auth.uid() and enabled),'supported',true);end $$;

create or replace function public.touch_current_provider_push_installation(target_installation_id uuid,target_foreground boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or not exists(select 1 from public.provider_profiles where provider_id=auth.uid() and active) then raise exception 'Provider authentication required' using errcode='42501';end if;
 update public.provider_push_subscriptions set last_seen_at=now(),foreground_until=case when target_foreground then now()+interval '30 seconds' else null end,updated_at=now()
 where provider_id=auth.uid() and installation_id=target_installation_id and enabled; return found; end $$;

create or replace function public.revoke_current_provider_push_installation(target_installation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or not exists(select 1 from public.provider_profiles where provider_id=auth.uid() and active) then raise exception 'Provider authentication required' using errcode='42501';end if;
 update public.provider_push_subscriptions set enabled=false,revoked_at=now(),foreground_until=null,updated_at=now()
 where provider_id=auth.uid() and installation_id=target_installation_id; return found; end $$;

create or replace function public.resolve_current_provider_push_offer(target_reference uuid) returns uuid language plpgsql security definer set search_path='' stable as $$
declare result uuid; begin
 if auth.uid() is null or not exists(select 1 from public.provider_profiles where provider_id=auth.uid() and active) then raise exception 'Provider authentication required' using errcode='42501'; end if;
 select id into result from public.mission_offers where push_reference=target_reference and provider_id=auth.uid() and status='pending' and expires_at>statement_timestamp();
 return result;
end $$;

revoke all on function public.register_current_provider_push_subscription(uuid,text,text,text),public.get_current_provider_push_state(),public.touch_current_provider_push_installation(uuid,boolean),public.revoke_current_provider_push_installation(uuid),public.resolve_current_provider_push_offer(uuid) from public,anon;
grant execute on function public.register_current_provider_push_subscription(uuid,text,text,text),public.get_current_provider_push_state(),public.touch_current_provider_push_installation(uuid,boolean),public.revoke_current_provider_push_installation(uuid),public.resolve_current_provider_push_offer(uuid) to authenticated;
