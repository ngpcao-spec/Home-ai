begin;

do $$
declare
  location_body text;
  availability_body text;
begin
  select pg_get_functiondef('public.update_current_provider_location(double precision,double precision)'::regprocedure)
    into location_body;
  select pg_get_functiondef('public.set_current_provider_availability(boolean,boolean,double precision,double precision)'::regprocedure)
    into availability_body;

  if location_body !~ 'last_latitude = new_latitude'
     or location_body !~ 'last_longitude = new_longitude'
     or location_body !~ 'last_location_at = statement_timestamp\(\)'
     or location_body ~ 'available\s*='
     or location_body ~ 'online\s*='
     or location_body ~ 'current_mission_id\s*=' then
    raise exception 'GPS RPC must update only provider coordinates and timestamp.';
  end if;

  if lower(availability_body) not like '%available = new_online and current_mission_id is null%' then
    raise exception 'Availability must be derived atomically from online and current mission.';
  end if;
end $$;

rollback;
