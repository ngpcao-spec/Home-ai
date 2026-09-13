begin;
do $$
declare actor uuid; history jsonb; item jsonb; actors integer:=0;
begin
  if not exists(select 1 from pg_class where oid='public.mission_invoices'::regclass and relrowsecurity) then raise exception 'Invoice RLS disabled'; end if;
  if has_table_privilege('anon','public.mission_invoices','SELECT') then raise exception 'Anonymous invoice access'; end if;
  for actor in select p.user_id from public.profiles p where p.role='provider' and p.status='active' loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    history:=public.get_current_user_mission_history();
    for item in select value from jsonb_array_elements(history) loop
      if (item->>'providerId')::uuid is distinct from actor then raise exception 'Foreign provider history'; end if;
    end loop;
    if exists(select 1 from public.mission_invoices where provider_id<>actor and client_id<>actor) then raise exception 'Foreign invoice visible'; end if;
    execute 'reset role';
    actors:=actors+1;
  end loop;
  if actors=0 then raise exception 'No provider tested'; end if;
  raise notice 'Provider earnings isolation PASS';
end $$;
rollback;
