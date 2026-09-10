-- Secure Provider activity onboarding and anonymous peer-rate aggregation.

alter table public.provider_services
  add column activity_name text,
  add column activity_description text,
  add constraint provider_services_activity_name_check check (
    activity_name is null or char_length(trim(activity_name)) between 2 and 120
  ),
  add constraint provider_services_activity_description_check check (
    activity_description is null or char_length(trim(activity_description)) between 2 and 500
  );

create or replace function public.get_current_provider_hourly_rate_reference(target_service_category text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  normalized_category text := lower(trim(target_service_category));
  origin_latitude double precision;
  origin_longitude double precision;
  median_rate bigint;
  comparable_count integer;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id=uid and pp.active and pp.kyc_status='verified'
     ) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if normalized_category is null or normalized_category !~ '^[a-z][a-z0-9-]{1,79}$' then
    raise exception 'Invalid service category.' using errcode='22023';
  end if;

  select ps.last_latitude,ps.last_longitude
    into origin_latitude,origin_longitude
  from public.provider_status ps where ps.provider_id=uid;
  if origin_latitude is null or origin_longitude is null then
    return jsonb_build_object('median_hourly_rate',null,'provider_count',0);
  end if;

  with completed_peers as (
    select
      m.provider_id,
      max(coalesce(m.completed_at,m.requested_at)) as latest_completed_at,
      min(2 * 6371 * asin(sqrt(least(1::double precision,
        power(sin(radians((m.client_latitude-origin_latitude)/2)),2)
        + cos(radians(origin_latitude))*cos(radians(m.client_latitude))
        * power(sin(radians((m.client_longitude-origin_longitude)/2)),2)
      )))) as distance_km
    from public.missions m
    where m.status='completed'
      and m.service_category=normalized_category
      and m.provider_id is not null
      and m.provider_id<>uid
    group by m.provider_id
  ), peer_rates as (
    select cp.provider_id,cp.latest_completed_at,cp.distance_km,svc.hourly_rate
    from completed_peers cp
    join public.provider_profiles pp on pp.provider_id=cp.provider_id
      and pp.active and pp.kyc_status='verified'
    join public.provider_services svc on svc.provider_id=cp.provider_id
      and svc.service_category=normalized_category and svc.enabled
      and svc.pricing_model='hourly' and svc.hourly_rate is not null
  ), radii(radius_km,priority) as (
    values (5::double precision,1),(10::double precision,2),(20::double precision,3)
  ), selected_radius as (
    select r.radius_km
    from radii r
    where exists(select 1 from peer_rates pr where pr.distance_km<=r.radius_km)
    order by r.priority limit 1
  ), recent_unique_providers as (
    select pr.provider_id,pr.hourly_rate
    from peer_rates pr cross join selected_radius sr
    where pr.distance_km<=sr.radius_km
    order by pr.latest_completed_at desc,pr.provider_id
    limit 50
  )
  select round(percentile_cont(0.5) within group(order by hourly_rate)::numeric)::bigint,
         count(*)::integer
    into median_rate,comparable_count
  from recent_unique_providers;

  return jsonb_build_object(
    'median_hourly_rate',median_rate,
    'provider_count',coalesce(comparable_count,0)
  );
end $$;

create or replace function public.create_current_provider_activity(
  target_service_category text,
  new_activity_name text,
  new_activity_description text,
  new_pricing_model text,
  new_hourly_rate bigint,
  new_minimum_charge bigint
)
returns public.provider_services language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  normalized_category text := lower(trim(target_service_category));
  result public.provider_services;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid,'provider')
     or not exists (
       select 1 from public.provider_profiles pp
       where pp.provider_id=uid and pp.active and pp.kyc_status='verified'
     ) then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if normalized_category is null or normalized_category !~ '^[a-z][a-z0-9-]{1,79}$'
     or new_activity_name is null or char_length(trim(new_activity_name)) not between 2 and 120
     or new_activity_description is null or char_length(trim(new_activity_description)) not between 2 and 500 then
    raise exception 'Invalid activity details.' using errcode='22023';
  end if;
  if new_pricing_model <> 'hourly' then
    raise exception 'Pricing model is not supported in this version.' using errcode='0A000';
  end if;
  if new_hourly_rate is null or new_minimum_charge is null
     or new_hourly_rate not between 1 and 1000000000
     or new_minimum_charge not between 0 and 1000000000000 then
    raise exception 'Invalid hourly pricing.' using errcode='22023';
  end if;

  insert into public.provider_services(
    provider_id,service_category,base_price,currency,enabled,pricing_model,
    hourly_rate,minimum_charge,activity_name,activity_description
  ) values(
    uid,normalized_category,null,'VND',true,'hourly',new_hourly_rate,
    new_minimum_charge,trim(new_activity_name),trim(new_activity_description)
  ) returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Provider activity already exists.' using errcode='23505';
end $$;

revoke all on function public.get_current_provider_hourly_rate_reference(text) from public,anon;
revoke all on function public.create_current_provider_activity(text,text,text,text,bigint,bigint) from public,anon;
grant execute on function public.get_current_provider_hourly_rate_reference(text) to authenticated;
grant execute on function public.create_current_provider_activity(text,text,text,text,bigint,bigint) to authenticated;
