begin;

do $$
declare body text := pg_get_functiondef('public.decline_current_provider_offer(uuid)'::regprocedure);
declare timeout_body text := pg_get_functiondef('public.expire_current_mission_offer_and_rematch(uuid)'::regprocedure);
declare dispatch_body text := pg_get_functiondef('private.dispatch_next_mission_offer(uuid,interval,interval)'::regprocedure);
begin
  if body not like '%auth.uid()%' or body not like '%for update%' or body not like '%status=''declined''%'
     or body not like '%dispatch_next_mission_offer%' then raise exception 'Decline is not atomic server dispatch'; end if;
  if timeout_body not like '%expires_at>statement_timestamp()%' or timeout_body not like '%status=''expired''%'
     or timeout_body not like '%dispatch_next_mission_offer%' then raise exception 'Timeout is not server validated'; end if;
  if dispatch_body not like '%not exists%' or dispatch_body not like '%previous.mission_id=mission_row.id%'
     or dispatch_body not like '%previous.provider_id=pp.provider_id%' then raise exception 'Previously offered provider can be proposed again'; end if;
  if dispatch_body not like '%limit 1%' then raise exception 'Dispatch must offer only the deterministic best provider'; end if;
  if has_function_privilege('anon','public.expire_current_mission_offer_and_rematch(uuid)','execute')
     or has_function_privilege('public','public.expire_current_mission_offer_and_rematch(uuid)','execute') then
    raise exception 'Anonymous timeout execution remains available';
  end if;
end $$;

-- The existing unique accepted-offer index and mission-first locks remain the final
-- concurrency barrier when accept/refuse/timeout race.
do $$
begin
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='mission_offers'
    and indexname='mission_offers_one_accepted_idx') then raise exception 'Single winner index missing'; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='mission_offers') then raise exception 'Offers are not published'; end if;
end $$;

rollback;
