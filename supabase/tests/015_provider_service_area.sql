-- Run after 20260911002715_provider_service_area.sql.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('51000000-0000-0000-0000-000000000000'::uuid,'area-customer@test.invalid'),
  ('51000000-0000-0000-0000-000000000001'::uuid,'area-provider@test.invalid'),
  ('51000000-0000-0000-0000-000000000002'::uuid,'area-other@test.invalid')
) users(id,email);
insert into public.profiles(user_id,role,display_name) values
  ('51000000-0000-0000-0000-000000000000','customer','Area Customer'),
  ('51000000-0000-0000-0000-000000000001','provider','Area Provider'),
  ('51000000-0000-0000-0000-000000000002','provider','Other Provider');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('51000000-0000-0000-0000-000000000001','Electricity','verified',true);
insert into public.provider_profiles(provider_id,specialty,kyc_status,active,service_radius_km) values
  ('51000000-0000-0000-0000-000000000002','Electricity','verified',true,30);
insert into public.provider_status(provider_id,online,available,last_latitude,last_longitude,last_location_at) values
  ('51000000-0000-0000-0000-000000000001',true,true,12,109,now()),
  ('51000000-0000-0000-0000-000000000002',false,false,12,109,now());
insert into public.provider_services(provider_id,service_category,enabled) values
  ('51000000-0000-0000-0000-000000000001','electricity',true),
  ('51000000-0000-0000-0000-000000000002','electricity',true);

do $$ begin
  if (select service_radius_km<>20 from public.provider_profiles where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'New provider default radius is not 20 km';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare candidate integer; saved jsonb; affected integer;
begin
  foreach candidate in array array[5,10,20,30,50] loop
    saved:=public.set_current_provider_service_area(candidate);
    if saved<>jsonb_build_object('service_radius_km',candidate)
       or public.get_current_provider_service_area()<>saved then
      raise exception 'Allowed radius % was not saved',candidate;
    end if;
  end loop;
  begin
    perform public.set_current_provider_service_area(15);
    raise exception 'Unsupported radius was accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select service_radius_km<>30 from public.provider_profiles where provider_id='51000000-0000-0000-0000-000000000002') then
    raise exception 'Another provider radius changed';
  end if;
  update public.provider_profiles set service_radius_km=50
  where provider_id='51000000-0000-0000-0000-000000000002';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Direct cross-provider update bypassed RLS'; end if;
  perform public.set_current_provider_service_area(5);
end $$;

set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.03,109,20,interval '5 minutes') where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'Provider inside radius was excluded';
  end if;
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.06,109,20,interval '5 minutes') where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'Provider outside radius remained eligible';
  end if;
end $$;

reset role;
update public.provider_status set last_latitude=12.10,last_longitude=109,last_location_at=now()
where provider_id='51000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.get_matching_provider_candidates('electricity',12.06,109,20,interval '5 minutes') where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'Moving provider GPS did not move the service area';
  end if;
end $$;

reset role;
update public.provider_status set last_latitude=null,last_longitude=null,last_location_at=null
where provider_id='51000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.10,109,20,interval '5 minutes') where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'Provider without GPS remained eligible';
  end if;
end $$;

reset role;
update public.provider_status set last_latitude=12.10,last_longitude=109,last_location_at=now()-interval '10 minutes'
where provider_id='51000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000000","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.get_matching_provider_candidates('electricity',12.10,109,20,interval '5 minutes') where provider_id='51000000-0000-0000-0000-000000000001') then
    raise exception 'Provider with stale GPS remained eligible';
  end if;
end $$;

rollback;
