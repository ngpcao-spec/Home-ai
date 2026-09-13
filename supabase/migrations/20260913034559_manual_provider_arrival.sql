create or replace function public.update_current_provider_mission_progress(target_mission_id uuid,new_status public.mission_status,
  new_latitude double precision,new_longitude double precision)
returns public.missions language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; distance_km double precision;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists (select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if (new_latitude is null) <> (new_longitude is null) or (new_status='travelling' and new_latitude is null) or new_latitude not between -90 and 90 or new_longitude not between -180 and 180 then raise exception 'Valid provider coordinates required.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  if not ((mission_row.status='accepted' and new_status='travelling') or (mission_row.status='travelling' and new_status='arrived')) then raise exception 'Invalid mission transition.' using errcode='22023'; end if;
  if not exists (select 1 from public.provider_status ps where ps.provider_id=uid and ps.current_mission_id=mission_row.id) then raise exception 'Provider mission relationship is invalid.' using errcode='55000'; end if;
  if new_status='arrived' then
    distance_km:=6371*2*asin(sqrt(power(sin(radians(mission_row.client_latitude-new_latitude)/2),2)+cos(radians(new_latitude))*cos(radians(mission_row.client_latitude))*power(sin(radians(mission_row.client_longitude-new_longitude)/2),2)));
    
  end if;
  update public.provider_status set last_latitude=coalesce(new_latitude,last_latitude),last_longitude=coalesce(new_longitude,last_longitude),last_location_at=case when new_latitude is not null then statement_timestamp() else last_location_at end,available=false where provider_id=uid and current_mission_id=mission_row.id;
  update public.missions set status=new_status,travelling_at=case when new_status='travelling' then statement_timestamp() else travelling_at end,
    arrived_at=case when new_status='arrived' then statement_timestamp() else arrived_at end,version=version+1
    where id=mission_row.id and provider_id=uid returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload) values(mission_row.id,case when new_status='travelling' then 'mission.provider.travelling' else 'mission.provider.arrived' end,uid,'provider',case when new_status='arrived' then jsonb_build_object('observed_distance_km',distance_km,'arrival_mode',case when distance_km is null or distance_km>0.15 then 'manual' else 'gps' end) else '{}'::jsonb end);
  return mission_row;
end $$;


revoke all on function public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision) from public,anon;

grant execute on function public.update_current_provider_mission_progress(uuid,public.mission_status,double precision,double precision) to authenticated;
