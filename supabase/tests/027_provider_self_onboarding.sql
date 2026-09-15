begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('59800000-0000-0000-0000-000000000001','new-provider@test.invalid','{"full_name":"New Provider"}'),
 ('59800000-0000-0000-0000-000000000002','customer@test.invalid','{}'),
 ('59800000-0000-0000-0000-000000000003','other@test.invalid','{}'),
 ('59800000-0000-0000-0000-000000000004','incomplete-provider@test.invalid','{}');
insert into public.profiles(user_id,role,display_name) values
 ('59800000-0000-0000-0000-000000000002','customer','Customer');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000001',true);
do $$ declare s jsonb; begin
  s:=public.get_current_provider_onboarding_state();
  if (s->>'providerExists')::boolean then raise exception 'Unexpected provider'; end if;
  s:=public.provision_current_provider();
  if not (s->>'providerExists')::boolean then raise exception 'Provider not provisioned'; end if;
  if (select role from public.profiles where user_id=auth.uid())<>'provider' then raise exception 'Wrong role'; end if;
  if (select active from public.provider_profiles where provider_id=auth.uid()) is not true then raise exception 'Account not active'; end if;
  if exists(select 1 from public.provider_status where provider_id=auth.uid() and (online or available)) then raise exception 'Provisioned provider is eligible too early'; end if;
  if (s->>'readyForMissions')::boolean then raise exception 'Incomplete provider marked ready'; end if;
  begin perform public.mark_current_provider_onboarding_step('availability'); raise exception 'Missing preferences accepted'; exception when invalid_parameter_value then null; end;
end $$;

-- Finish the V1 self-service steps while KYC deliberately remains unverified.
reset role;
update public.provider_profiles set professional_profile_updated_at=statement_timestamp()
where provider_id='59800000-0000-0000-0000-000000000001';
insert into public.provider_services(provider_id,service_category,pricing_model,hourly_rate,minimum_charge,activity_name,activity_description)
values('59800000-0000-0000-0000-000000000001','electricity','hourly',300000,0,'Thợ điện','Sửa chữa điện dân dụng');
insert into public.provider_availability_preferences(provider_id,availability_mode,available_24h,weekly_schedule)
values('59800000-0000-0000-0000-000000000001','manual',false,'[]');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000001',true);
select public.mark_current_provider_onboarding_step('service_area');
select public.mark_current_provider_onboarding_step('availability');
do $$ declare s jsonb:=public.get_current_provider_onboarding_state(); begin
  if not (s->>'readyForMissions')::boolean or not (s->>'onboardingComplete')::boolean then
    raise exception 'Completed onboarding is not ready'; end if;
  if (s->>'kycStatus')='verified' then raise exception 'V1 silently verified KYC'; end if;
end $$;
select public.update_current_provider_location(12.245,109.190);
select public.set_current_provider_availability(true,true,12.245,109.190);

-- A customer can match the completed Provider and dispatch a real pending offer,
-- even though KYC is still pending.
select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000002',true);
do $$ declare candidate_count integer; mission_row public.missions; offer_row public.mission_offers; begin
  select count(*) into candidate_count from public.get_matching_provider_candidates(
    'electricity',12.245,109.190,20,interval '5 minutes'
  ) c where c.provider_id='59800000-0000-0000-0000-000000000001';
  if candidate_count<>1 then raise exception 'Pending-KYC completed Provider was excluded from matching'; end if;
  mission_row:=public.create_current_customer_mission(
    'electricity','Synthetic V1 onboarding request',null,null,'Nha Trang',12.245,109.190,null
  );
  select * into offer_row from public.create_current_customer_mission_offers(mission_row.id,1) limit 1;
  if offer_row.provider_id is distinct from '59800000-0000-0000-0000-000000000001'::uuid
     or offer_row.status<>'pending' then raise exception 'Pending-KYC Provider did not receive the offer'; end if;
end $$;

select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000001',true);
do $$ declare dashboard jsonb:=public.get_current_provider_dashboard(); begin
  if jsonb_array_length(coalesce(dashboard->'offers','[]'::jsonb))<>1 then
    raise exception 'Pending-KYC Provider dashboard did not receive the offer'; end if;
  if dashboard#>>'{provider,kycStatus}'='verified' then
    raise exception 'Dashboard falsely reported verified KYC'; end if;
end $$;

-- A provisioned but incomplete Provider cannot turn Online.
select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000004',true);
select public.provision_current_provider();
do $$ begin
  begin perform public.set_current_provider_availability(true,true,null,null);
    raise exception 'Incomplete Provider went Online';
  exception when sqlstate '55000' then null; end;
end $$;

-- A customer cannot be converted by entering /provider/.
select set_config('request.jwt.claim.sub','59800000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform public.provision_current_provider(); raise exception 'Customer converted to provider'; exception when insufficient_privilege then null; end;
  if (select role from public.profiles where user_id=auth.uid())<>'customer' then raise exception 'Customer role changed'; end if;
  begin
    insert into public.provider_profiles(provider_id,specialty)
    values('59800000-0000-0000-0000-000000000003','Forbidden other UUID');
    raise exception 'Frontend created a Provider for another UUID';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;

-- The RPC exposes no target UUID and cannot grant admin.
reset role;
do $$ begin
  if has_function_privilege('anon','public.provision_current_provider()','execute') then raise exception 'Anon provisioning allowed'; end if;
  if (select pronargs from pg_proc where oid='public.provision_current_provider()'::regprocedure)<>0 then raise exception 'Provisioning accepts a target identity'; end if;
  if exists(select 1 from public.profiles where role='admin' and user_id::text like '59800000-%') then raise exception 'Admin role granted'; end if;
  if has_table_privilege('authenticated','public.provider_onboarding_progress','insert,update,delete') then
    raise exception 'Frontend can mutate onboarding progress directly'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('provider_profiles','provider_services')
    and coalesce(qual,'') ilike '%kyc_status%') then raise exception 'A catalogue RLS still blocks non-KYC V1 Providers'; end if;
  if exists(select 1 from public.provider_profiles where provider_id='59800000-0000-0000-0000-000000000001' and kyc_status='verified') then
    raise exception 'KYC was changed by V1 onboarding'; end if;
  if pg_get_functiondef('public.get_matching_provider_candidates(text,double precision,double precision,integer,interval)'::regprocedure)
       like '%kyc_status%verified%' then raise exception 'Matching still depends on KYC'; end if;
  if pg_get_functiondef('private.dispatch_next_mission_offer(uuid,interval,interval)'::regprocedure)
       like '%kyc_status%verified%' then raise exception 'Dispatch still depends on KYC'; end if;
end $$;
rollback;
