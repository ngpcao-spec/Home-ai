-- Provider App RPCs. All provider-owned mutations remain server-side and auth.uid()-bound.

create or replace function public.get_current_provider_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'provider', jsonb_build_object('id', pp.provider_id, 'name', p.display_name,
      'specialty', pp.specialty, 'kycStatus', pp.kyc_status),
    'status', jsonb_build_object('online', ps.online, 'available', ps.available,
      'lastLocationAt', ps.last_location_at),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', mo.id, 'missionId', mo.mission_id, 'status', mo.status,
      'serviceCategory', m.service_category, 'request', m.problem_description,
      'approximateAddress', coalesce(nullif(regexp_replace(m.address_text, '^[^,]+,\s*', ''), ''), 'Khu vực khách hàng'),
      'distanceKm', mo.straight_line_distance_km,
      'etaMinutes', greatest(2, ceil(coalesce(mo.straight_line_distance_km, 0) / 0.32)::integer),
      'expiresAt', mo.expires_at
    ) order by mo.match_rank, mo.provider_id)
      from public.mission_offers mo join public.missions m on m.id=mo.mission_id
      where mo.provider_id=uid and mo.status='pending' and mo.expires_at > statement_timestamp()), '[]'::jsonb),
    'assignment', (select jsonb_build_object('id', m.id, 'serviceCategory', m.service_category,
      'request', m.problem_description, 'address', m.address_text, 'status', m.status,
      'acceptedAt', m.accepted_at) from public.missions m
      where m.provider_id=uid and m.status not in ('completed','cancelled','expired')
      order by m.accepted_at desc nulls last limit 1)
  ) into result
  from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  join public.provider_status ps on ps.provider_id=pp.provider_id where pp.provider_id=uid;
  return result;
end $$;

create or replace function public.set_current_provider_availability(
  new_online boolean, new_available boolean,
  new_latitude double precision default null, new_longitude double precision default null
) returns public.provider_status language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result public.provider_status;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_available and not new_online then raise exception 'Availability requires online status.' using errcode='22023'; end if;
  if (new_latitude is null) <> (new_longitude is null)
     or new_latitude is not null and (new_latitude not between -90 and 90 or new_longitude not between -180 and 180) then
    raise exception 'Invalid provider coordinates.' using errcode='22023';
  end if;
  update public.provider_status set online=new_online, available=new_available,
    last_latitude=coalesce(new_latitude,last_latitude), last_longitude=coalesce(new_longitude,last_longitude),
    last_location_at=case when new_latitude is not null then statement_timestamp() else last_location_at end
  where provider_id=uid and (current_mission_id is null or not new_available)
  returning * into result;
  if result.provider_id is null then raise exception 'Provider status cannot become available during a mission.' using errcode='55000'; end if;
  return result;
end $$;

create or replace function public.decline_current_provider_offer(target_offer_id uuid)
returns public.mission_offers language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result public.mission_offers;
begin
  if uid is null or (select auth.role()) <> 'authenticated'
     or not private.profile_has_role(uid, 'provider') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  update public.mission_offers set status='declined', responded_at=statement_timestamp()
  where id=target_offer_id and provider_id=uid and status='pending' and expires_at > statement_timestamp()
  returning * into result;
  if result.id is null then raise exception 'Provider offer is unavailable.' using errcode='40001'; end if;
  return result;
end $$;

revoke all on function public.get_current_provider_dashboard() from public, anon;
revoke all on function public.set_current_provider_availability(boolean,boolean,double precision,double precision) from public, anon;
revoke all on function public.decline_current_provider_offer(uuid) from public, anon;
grant execute on function public.get_current_provider_dashboard() to authenticated;
grant execute on function public.set_current_provider_availability(boolean,boolean,double precision,double precision) to authenticated;
grant execute on function public.decline_current_provider_offer(uuid) to authenticated;
