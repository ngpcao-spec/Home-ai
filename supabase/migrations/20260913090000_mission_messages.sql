-- Temporary, mission-only text chat. No retained content after terminal status.
create table public.mission_messages (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500 and body = btrim(body)),
  created_at timestamptz not null default now()
);
create index mission_messages_thread on public.mission_messages(mission_id, created_at, id);
alter table public.mission_messages enable row level security;
revoke all on public.mission_messages from public, anon, authenticated;
grant select on public.mission_messages to authenticated;
create policy mission_messages_participants on public.mission_messages
for select to authenticated using (exists (
  select 1 from public.missions m where m.id = mission_id
  and m.provider_id is not null and auth.uid() in (m.client_id,m.provider_id)
  and m.status in ('accepted','travelling','arrived','quote_pending','in_progress',
    'supplement_pending','completed_pending_payment')
));

create function public.send_mission_message(target_mission_id uuid, new_body text)
returns public.mission_messages language plpgsql security definer set search_path = '' as $$
declare m public.missions; result public.mission_messages; content text := btrim(new_body);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.missions where id=target_mission_id for share;
  if m.id is null or m.provider_id is null or auth.uid() not in (m.client_id,m.provider_id) then
    raise exception 'Mission access denied' using errcode='42501'; end if;
  if m.status not in ('accepted','travelling','arrived','quote_pending','in_progress',
    'supplement_pending','completed_pending_payment') then
    raise exception 'Mission chat unavailable' using errcode='55000'; end if;
  if content is null or char_length(content) not between 1 and 500 then
    raise exception 'Invalid message length' using errcode='22023'; end if;
  insert into public.mission_messages(mission_id,sender_user_id,body)
    values(m.id,auth.uid(),content) returning * into result;
  return result;
end $$;
revoke all on function public.send_mission_message(uuid,text) from public, anon;
grant execute on function public.send_mission_message(uuid,text) to authenticated;

create function public.get_mission_messages(target_mission_id uuid)
returns setof public.mission_messages language plpgsql security definer set search_path = '' as $$
declare m public.missions;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.missions where id=target_mission_id for share;
  if m.id is null or m.provider_id is null or auth.uid() not in (m.client_id,m.provider_id) then
    raise exception 'Mission access denied' using errcode='42501'; end if;
  if m.status not in ('accepted','travelling','arrived','quote_pending','in_progress',
    'supplement_pending','completed_pending_payment') then
    raise exception 'Mission chat unavailable' using errcode='55000'; end if;
  return query select * from public.mission_messages where mission_id=m.id order by created_at,id;
end $$;
revoke all on function public.get_mission_messages(uuid) from public, anon;
grant execute on function public.get_mission_messages(uuid) to authenticated;

create function private.delete_terminal_mission_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('completed','cancelled','expired') then
    delete from public.mission_messages where mission_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.delete_terminal_mission_messages() from public,anon,authenticated;
create trigger missions_delete_terminal_messages after update of status on public.missions
for each row execute function private.delete_terminal_mission_messages();
alter publication supabase_realtime add table public.mission_messages;
