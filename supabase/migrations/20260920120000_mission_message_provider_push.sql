-- Reuse the Provider offer Push outbox for one notification per Client message.
-- The message remains private and is never copied into the outbox or payload.
alter table public.provider_push_outbox alter column offer_id drop not null;
alter table public.provider_push_outbox
  add column message_id uuid references public.mission_messages(id) on delete cascade;
alter table public.provider_push_outbox
  add constraint provider_push_outbox_message_id_key unique(message_id);
alter table public.provider_push_outbox
  add constraint provider_push_outbox_one_source check ((offer_id is null) <> (message_id is null));

-- Existing offer webhook fires for either outbox source; no second webhook.
create function private.enqueue_provider_message_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_provider uuid;
begin
  select m.provider_id into target_provider
  from public.missions m
  where m.id = new.mission_id
    and m.client_id = new.sender_user_id
    and m.provider_id is not null
    and m.status in ('accepted','travelling','arrived','quote_pending','in_progress',
      'supplement_pending','completed_pending_payment');
  if target_provider is not null then
    insert into public.provider_push_outbox(message_id,provider_id)
    values(new.id,target_provider) on conflict(message_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.enqueue_provider_message_push() from public,anon,authenticated;
create trigger mission_message_enqueue_provider_push after insert on public.mission_messages
for each row execute function private.enqueue_provider_message_push();

-- Edge service role gets only the columns needed to validate the message route.
grant select (id,mission_id,sender_user_id) on public.mission_messages to service_role;
grant select (client_id) on public.missions to service_role;

-- A notification reference resolves only for its assigned Provider and a live chat.
create function public.resolve_current_provider_push_message(target_reference uuid)
returns uuid language plpgsql security definer set search_path = '' stable as $$
declare result uuid; uid uuid := (select auth.uid());
begin
  if uid is null or not exists (
    select 1 from public.provider_profiles where provider_id=uid and active
  ) then raise exception 'Provider authentication required' using errcode='42501'; end if;
  select m.id into result
  from public.mission_messages msg
  join public.missions m on m.id=msg.mission_id
  where msg.id=target_reference and msg.sender_user_id=m.client_id
    and m.provider_id=uid
    and m.status in ('accepted','travelling','arrived','quote_pending','in_progress',
      'supplement_pending','completed_pending_payment');
  return result;
end $$;
revoke all on function public.resolve_current_provider_push_message(uuid) from public,anon;
grant execute on function public.resolve_current_provider_push_message(uuid) to authenticated;
