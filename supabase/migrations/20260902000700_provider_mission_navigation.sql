-- Provider navigation RPC. Audited locally; deploy separately after review.
create or replace function public.get_current_provider_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); result jsonb;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid, 'provider')
     or not exists (select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'provider', jsonb_build_object('id',pp.provider_id,'name',p.display_name,'specialty',pp.specialty,'kycStatus',pp.kyc_status),
    'status', jsonb_build_object('online',ps.online,'available',ps.available,'lastLocationAt',ps.last_location_at),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id',mo.id,'missionId',mo.mission_id,'status',mo.status,
      'serviceCategory',m.service_category,'request',m.problem_description,'approximateAddress','Khu vực Nha Trang',
      'distanceKm',mo.straight_line_distance_km,'etaMinutes',greatest(2,ceil(coalesce(mo.straight_line_distance_km,0)/0.32)::integer),'expiresAt',mo.expires_at)
      order by mo.match_rank,mo.provider_id) from public.mission_offers mo join public.missions m on m.id=mo.mission_id
      where mo.provider_id=uid and mo.status='pending' and mo.expires_at>statement_timestamp()),'[]'::jsonb),
    'assignment',(select jsonb_build_object('id',m.id,'serviceCategory',m.service_category,'request',m.problem_description,
      'address',m.address_text,'status',m.status,'acceptedAt',m.accepted_at,
      'clientLocation',jsonb_build_object('latitude',m.client_latitude,'longitude',m.client_longitude),
      'providerLocation',case when ps.last_latitude is null then null else jsonb_build_object('latitude',ps.last_latitude,'longitude',ps.last_longitude) end)
      from public.missions m where m.provider_id=uid and m.status not in ('completed','cancelled','expired') order by m.accepted_at desc nulls last limit 1)
  ) into result from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  join public.provider_status ps on ps.provider_id=pp.provider_id where pp.provider_id=uid;
  return result;
end $$;

create or replace function public.update_current_provider_mission_progress(target_mission_id uuid,new_status public.mission_status,
  new_latitude double precision,new_longitude double precision)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; distance_km double precision;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists (select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_latitude not between -90 and 90 or new_longitude not between -180 and 180 then raise exception 'Valid provider coordinates required.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if not ((mission_row.status='accepted' and new_status='travelling') or (mission_row.status='travelling' and new_status='arrived')) then raise exception 'Invalid mission transition.' using errcode='22023'; end if;
  if not exists (select 1 from public.provider_status ps where ps.provider_id=uid and ps.current_mission_id=mission_row.id) then raise exception 'Provider mission relationship is invalid.' using errcode='55000'; end if;
  if new_status='arrived' then
    distance_km:=6371*2*asin(sqrt(power(sin(radians(mission_row.client_latitude-new_latitude)/2),2)+cos(radians(new_latitude))*cos(radians(mission_row.client_latitude))*power(sin(radians(mission_row.client_longitude-new_longitude)/2),2)));
    if distance_km>0.15 then raise exception 'Provider has not reached the mission.' using errcode='22023'; end if;
  end if;
  update public.provider_status set last_latitude=new_latitude,last_longitude=new_longitude,last_location_at=statement_timestamp(),available=false where provider_id=uid and current_mission_id=mission_row.id;
  update public.missions set status=new_status,travelling_at=case when new_status='travelling' then statement_timestamp() else travelling_at end,
    arrived_at=case when new_status='arrived' then statement_timestamp() else arrived_at end,version=version+1
    where id=mission_row.id and provider_id=uid returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role) values(mission_row.id,case when new_status='travelling' then 'mission.provider.travelling' else 'mission.provider.arrived' end,uid,'provider');
  return mission_row;
end $$;

revoke all on function public.get_current_provider_dashboard() from public,anon;
revoke all on function public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision) from public,anon;
grant execute on function public.get_current_provider_dashboard() to authenticated;
grant execute on function public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision) to authenticated;
