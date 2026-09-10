-- Build the HOME AI reference rate from immutable rates captured on completed
-- hourly missions. Current provider pricing must never rewrite market history.

create or replace function public.get_current_provider_hourly_rate_reference(target_service_category text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  normalized_category text := lower(trim(target_service_category));
  origin_latitude double precision;
  origin_longitude double precision;
  median_rate bigint;
  comparable_count integer;
  selected_radius_km double precision;
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
    return jsonb_build_object('median_hourly_rate',null,'provider_count',0,'radius_km',null);
  end if;

  with comparable_missions as (
    select
      m.id as mission_id,
      m.provider_id,
      coalesce(m.completed_at,mi.submitted_at,m.requested_at) as completed_at,
      mi.hourly_rate,
      2 * 6371 * asin(sqrt(least(1::double precision,
        power(sin(radians((m.client_latitude-origin_latitude)/2)),2)
        + cos(radians(origin_latitude))*cos(radians(m.client_latitude))
        * power(sin(radians((m.client_longitude-origin_longitude)/2)),2)
      ))) as distance_km
    from public.missions m
    join public.mission_invoices mi on mi.mission_id=m.id
      and mi.provider_id=m.provider_id
      and mi.pricing_model='hourly'
    where m.status='completed'
      and m.service_category=normalized_category
      and m.provider_id is not null
      and m.provider_id<>uid
      and m.client_latitude is not null
      and m.client_longitude is not null
  ), radii(radius_km,priority) as (
    values (5::double precision,1),(10::double precision,2),(20::double precision,3)
  )
  select r.radius_km into selected_radius_km
  from radii r
  where exists(select 1 from comparable_missions cm where cm.distance_km<=r.radius_km)
  order by r.priority limit 1;

  if selected_radius_km is null then
    return jsonb_build_object('median_hourly_rate',null,'provider_count',0,'radius_km',null);
  end if;

  with comparable_missions as (
    select
      m.id as mission_id,
      m.provider_id,
      coalesce(m.completed_at,mi.submitted_at,m.requested_at) as completed_at,
      mi.hourly_rate,
      2 * 6371 * asin(sqrt(least(1::double precision,
        power(sin(radians((m.client_latitude-origin_latitude)/2)),2)
        + cos(radians(origin_latitude))*cos(radians(m.client_latitude))
        * power(sin(radians((m.client_longitude-origin_longitude)/2)),2)
      ))) as distance_km
    from public.missions m
    join public.mission_invoices mi on mi.mission_id=m.id
      and mi.provider_id=m.provider_id
      and mi.pricing_model='hourly'
    where m.status='completed'
      and m.service_category=normalized_category
      and m.provider_id is not null
      and m.provider_id<>uid
      and m.client_latitude is not null
      and m.client_longitude is not null
  ), latest_mission_per_provider as (
    select distinct on (cm.provider_id)
      cm.provider_id,cm.hourly_rate,cm.completed_at,cm.mission_id
    from comparable_missions cm
    where cm.distance_km<=selected_radius_km
    order by cm.provider_id,cm.completed_at desc,cm.mission_id desc
  ), recent_unique_providers as (
    select lm.provider_id,lm.hourly_rate
    from latest_mission_per_provider lm
    order by lm.completed_at desc,lm.mission_id desc
    limit 50
  )
  select round(percentile_cont(0.5) within group(order by hourly_rate)::numeric)::bigint,
         count(*)::integer
    into median_rate,comparable_count
  from recent_unique_providers;

  return jsonb_build_object(
    'median_hourly_rate',median_rate,
    'provider_count',coalesce(comparable_count,0),
    'radius_km',selected_radius_km
  );
end $$;

revoke all on function public.get_current_provider_hourly_rate_reference(text) from public,anon;
grant execute on function public.get_current_provider_hourly_rate_reference(text) to authenticated;
