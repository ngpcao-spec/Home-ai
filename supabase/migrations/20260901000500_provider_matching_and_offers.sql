-- Server-owned deterministic provider matching and atomic mission offer acceptance.

alter table public.mission_offers
  add column straight_line_distance_km numeric(8, 3),
  add column match_rank integer;

alter table public.mission_offers
  add constraint mission_offers_distance_nonnegative
    check (straight_line_distance_km is null or straight_line_distance_km >= 0),
  add constraint mission_offers_match_rank_positive
    check (match_rank is null or match_rank > 0);

create index mission_offers_mission_rank_idx
  on public.mission_offers (mission_id, match_rank, provider_id);

create or replace function private.straight_line_distance_km(
  origin_latitude double precision,
  origin_longitude double precision,
  destination_latitude double precision,
  destination_longitude double precision
)
returns double precision
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select 6371.0 * 2.0 * asin(sqrt(least(1.0,
    power(sin(radians(destination_latitude - origin_latitude) / 2.0), 2)
    + cos(radians(origin_latitude)) * cos(radians(destination_latitude))
    * power(sin(radians(destination_longitude - origin_longitude) / 2.0), 2)
  )))
$$;

revoke all on function private.straight_line_distance_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;

create or replace function public.get_matching_provider_candidates(
  requested_service_category text,
  customer_latitude double precision,
  customer_longitude double precision,
  candidate_limit integer default 20,
  maximum_location_age interval default interval '5 minutes'
)
returns table (
  provider_id uuid,
  display_name text,
  avatar_url text,
  specialty text,
  service_category text,
  base_price bigint,
  currency character(3),
  service_radius_km numeric,
  rating_average numeric,
  review_count integer,
  completed_jobs integer,
  reliability_score numeric,
  description text,
  languages text[],
  latitude double precision,
  longitude double precision,
  last_location_at timestamptz,
  straight_line_distance_km double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(requested_service_category), '') is null
     or customer_latitude not between -90 and 90
     or customer_longitude not between -180 and 180
     or candidate_limit not between 1 and 50
     or maximum_location_age < interval '1 minute'
     or maximum_location_age > interval '15 minutes' then
    raise exception 'Invalid matching parameters.' using errcode = '22023';
  end if;

  return query
  with eligible as (
    select pp.provider_id, p.display_name, p.avatar_url, pp.specialty,
      ps.service_category, ps.base_price, ps.currency, pp.service_radius_km,
      pp.rating_average, pp.review_count, pp.completed_jobs, pp.reliability_score,
      pp.description, pp.languages, pst.last_latitude, pst.last_longitude,
      pst.last_location_at,
      private.straight_line_distance_km(
        customer_latitude, customer_longitude, pst.last_latitude, pst.last_longitude
      ) as distance_km
    from public.provider_profiles pp
    join public.profiles p on p.user_id = pp.provider_id
    join public.provider_services ps on ps.provider_id = pp.provider_id
    join public.provider_status pst on pst.provider_id = pp.provider_id
    where ps.service_category = trim(requested_service_category)
      and ps.enabled
      and pp.kyc_status = 'verified'
      and pp.active
      and p.status = 'active'
      and pst.online
      and pst.available
      and pst.current_mission_id is null
      and pst.last_latitude is not null
      and pst.last_longitude is not null
      and pst.last_location_at >= statement_timestamp() - maximum_location_age
  )
  select e.provider_id, e.display_name, e.avatar_url, e.specialty,
    e.service_category, e.base_price, e.currency, e.service_radius_km,
    e.rating_average, e.review_count, e.completed_jobs, e.reliability_score,
    e.description, e.languages, e.last_latitude, e.last_longitude,
    e.last_location_at, e.distance_km
  from eligible e
  where e.distance_km <= e.service_radius_km
  order by e.distance_km, e.reliability_score desc, e.rating_average desc,
    e.completed_jobs desc, e.provider_id
  limit candidate_limit;
end;
$$;

create or replace function public.create_current_customer_mission_offers(
  target_mission_id uuid,
  offer_limit integer default 10,
  offer_lifetime interval default interval '2 minutes',
  maximum_location_age interval default interval '5 minutes'
)
returns setof public.mission_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  mission_row public.missions;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'customer') then
    raise exception 'Active customer authentication required.' using errcode = '42501';
  end if;
  if offer_limit not between 1 and 25
     or offer_lifetime < interval '30 seconds' or offer_lifetime > interval '10 minutes'
     or maximum_location_age < interval '1 minute' or maximum_location_age > interval '15 minutes' then
    raise exception 'Invalid offer parameters.' using errcode = '22023';
  end if;

  select * into mission_row from public.missions
  where id = target_mission_id for update;
  if mission_row.id is null or mission_row.client_id <> current_user_id then
    raise exception 'Customer mission not found.' using errcode = '42501';
  end if;
  if mission_row.provider_id is not null or mission_row.status not in ('requested', 'searching', 'offered') then
    raise exception 'Mission is not available for matching.' using errcode = '55000';
  end if;

  return query
  with candidates as materialized (
    select c.*, row_number() over (
      order by c.straight_line_distance_km, c.reliability_score desc,
        c.rating_average desc, c.completed_jobs desc, c.provider_id
    )::integer as deterministic_rank
    from public.get_matching_provider_candidates(
      mission_row.service_category, mission_row.client_latitude,
      mission_row.client_longitude, offer_limit, maximum_location_age
    ) c
  ), inserted as (
    insert into public.mission_offers (
      mission_id, provider_id, status, offered_at, expires_at,
      straight_line_distance_km, match_rank
    )
    select mission_row.id, c.provider_id, 'pending', statement_timestamp(),
      statement_timestamp() + offer_lifetime, c.straight_line_distance_km,
      c.deterministic_rank
    from candidates c
    on conflict (mission_id, provider_id) do nothing
    returning *
  )
  select * from inserted order by match_rank, provider_id;

  if exists (select 1 from public.mission_offers mo where mo.mission_id = mission_row.id and mo.status = 'pending') then
    update public.missions set status = 'offered', version = version + 1
    where id = mission_row.id and status <> 'offered';
  end if;
end;
$$;

create or replace function public.accept_current_provider_offer(target_offer_id uuid)
returns public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  offer_row public.mission_offers;
  mission_row public.missions;
begin
  if current_user_id is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(current_user_id, 'provider') then
    raise exception 'Active provider authentication required.' using errcode = '42501';
  end if;

  select * into offer_row from public.mission_offers
  where id = target_offer_id;
  if offer_row.id is null or offer_row.provider_id <> current_user_id then
    raise exception 'Provider offer not found.' using errcode = '42501';
  end if;

  -- Every contender locks the mission first. Locking distinct offers first would
  -- deadlock when the winner declines a row already locked by another contender.
  select * into mission_row from public.missions
  where id = offer_row.mission_id for update;
  select * into offer_row from public.mission_offers
  where id = target_offer_id for update;
  if offer_row.status <> 'pending' or offer_row.expires_at <= statement_timestamp()
     or mission_row.provider_id is not null or mission_row.status not in ('searching', 'offered') then
    raise exception 'Offer is no longer available.' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.provider_status ps
    where ps.provider_id = current_user_id and ps.online and ps.available
      and ps.current_mission_id is null
      and ps.last_location_at >= statement_timestamp() - interval '5 minutes'
  ) then
    raise exception 'Provider is no longer eligible.' using errcode = '55000';
  end if;

  -- Expire competitors before assignment so the existing relationship trigger remains valid.
  -- "declined" is reserved for an explicit provider refusal.
  update public.mission_offers
  set status = 'expired', responded_at = statement_timestamp()
  where mission_id = mission_row.id and id <> offer_row.id and status = 'pending';
  update public.mission_offers
  set status = 'accepted', responded_at = statement_timestamp()
  where id = offer_row.id;
  update public.missions
  set provider_id = current_user_id, status = 'accepted', accepted_at = statement_timestamp(),
      version = version + 1
  where id = mission_row.id
  returning * into mission_row;
  update public.provider_status
  set available = false, current_mission_id = mission_row.id
  where provider_id = current_user_id;
  insert into public.mission_events (mission_id, event_type, actor_user_id, actor_role)
  values (mission_row.id, 'mission.offer.accepted', current_user_id, 'provider');
  return mission_row;
end;
$$;

revoke all on function public.get_matching_provider_candidates(text, double precision, double precision, integer, interval) from public, anon;
revoke all on function public.create_current_customer_mission_offers(uuid, integer, interval, interval) from public, anon;
revoke all on function public.accept_current_provider_offer(uuid) from public, anon;
grant execute on function public.get_matching_provider_candidates(text, double precision, double precision, integer, interval) to authenticated;
grant execute on function public.create_current_customer_mission_offers(uuid, integer, interval, interval) to authenticated;
grant execute on function public.accept_current_provider_offer(uuid) to authenticated;

comment on function public.get_matching_provider_candidates(text, double precision, double precision, integer, interval)
  is 'Authenticated customer geographic preselection before RouteMatrix; deterministic and read-only.';
comment on function public.create_current_customer_mission_offers(uuid, integer, interval, interval)
  is 'Persists deterministic offers for the current customer mission after eligibility checks.';
comment on function public.accept_current_provider_offer(uuid)
  is 'Atomically assigns one provider, rejects competing offers and marks the provider unavailable.';
