-- Run after all migrations against an isolated Supabase database.
begin;
do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_current_provider_dashboard','set_current_provider_availability','decline_current_provider_offer')
      and p.prosecdef and 'search_path='=any(p.proconfig)
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) <> 3
  then raise exception 'Provider App RPC permissions invalid'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity) <> 14
  then raise exception 'RLS is not enabled on all 14 tables'; end if;
end $$;
rollback;
