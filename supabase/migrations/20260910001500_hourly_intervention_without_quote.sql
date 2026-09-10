-- Branch intervention lifecycle by the provider service pricing model.
-- Hourly missions start after arrival and are priced only by the immutable final invoice.

create or replace function public.start_current_provider_intervention(target_mission_id uuid,expected_version integer)
returns public.missions language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions;
  service_row public.provider_services;
  accepted_quote public.quotes;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;

  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then
    raise exception 'Assigned mission not found.' using errcode='42501';
  end if;
  select * into service_row from public.provider_services
    where provider_id=uid and service_category=mission_row.service_category and enabled for update;
  if service_row.id is null then
    raise exception 'Provider service not found.' using errcode='55000';
  end if;

  if service_row.pricing_model='hourly' then
    if service_row.hourly_rate is null or service_row.minimum_charge is null
       or mission_row.version is distinct from expected_version or mission_row.status<>'arrived'
       or mission_row.started_at is not null
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending'))
       or exists(select 1 from public.mission_invoices mi where mi.mission_id=mission_row.id) then
      raise exception 'Hourly mission is not ready to start.' using errcode='40001';
    end if;
  else
    select * into accepted_quote from public.quotes q
      where q.mission_id=target_mission_id and q.status='accepted'
      order by q.version desc limit 1;
    if mission_row.version is distinct from expected_version or mission_row.status<>'quote_pending'
       or accepted_quote.id is null or accepted_quote.type<>'initial'
       or mission_row.final_authorized_amount is distinct from accepted_quote.total_amount
       or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
      raise exception 'Mission is not ready to start.' using errcode='40001';
    end if;
  end if;

  update public.missions set status='in_progress',started_at=statement_timestamp(),version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version returning * into mission_row;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.intervention.started',uid,'provider',
      case when service_row.pricing_model='hourly'
        then jsonb_build_object('pricingModel','hourly')
        else jsonb_build_object('quoteId',accepted_quote.id,'quoteVersion',accepted_quote.version)
      end);
  return mission_row;
end $$;

create or replace function public.submit_current_provider_hourly_invoice(
  target_mission_id uuid,
  expected_version integer,
  new_worked_hours integer,
  new_worked_minutes integer,
  new_material_amount bigint default 0
)
returns public.mission_invoices language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  mission_row public.missions; service_row public.provider_services;
  existing_invoice public.mission_invoices; result public.mission_invoices;
  total_worked_minutes integer; calculated_labor bigint;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_worked_hours is null or new_worked_minutes is null or new_material_amount is null
     or new_worked_hours not between 0 and 168 or new_worked_minutes not between 0 and 59
     or new_material_amount not between 0 and 1000000000000 then
    raise exception 'Invalid invoice values.' using errcode='22023';
  end if;
  total_worked_minutes:=new_worked_hours*60+new_worked_minutes;
  if total_worked_minutes not between 1 and 10080 then
    raise exception 'Worked duration must be between 1 minute and 168 hours.' using errcode='22023';
  end if;

  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.provider_id is distinct from uid then
    raise exception 'Assigned mission not found.' using errcode='42501';
  end if;
  select * into existing_invoice from public.mission_invoices where mission_id=mission_row.id;
  if existing_invoice.id is not null then
    if existing_invoice.provider_id=uid and existing_invoice.worked_minutes=total_worked_minutes
       and existing_invoice.material_amount=new_material_amount then return existing_invoice; end if;
    raise exception 'Mission invoice was already submitted.' using errcode='40001';
  end if;
  select * into service_row from public.provider_services
    where provider_id=uid and service_category=mission_row.service_category and enabled for update;
  if service_row.id is null or service_row.pricing_model<>'hourly'
     or service_row.hourly_rate is null or service_row.minimum_charge is null
     or service_row.hourly_rate not between 1 and 1000000000
     or service_row.minimum_charge not between 0 and 1000000000000 then
    raise exception 'Hourly pricing is not configured for this service.' using errcode='55000';
  end if;
  if mission_row.version is distinct from expected_version or mission_row.status<>'in_progress'
     or mission_row.started_at is null or mission_row.currency is distinct from service_row.currency
     or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending')) then
    raise exception 'Mission is not ready for invoicing.' using errcode='40001';
  end if;

  calculated_labor:=greatest(service_row.minimum_charge,
    ((service_row.hourly_rate*total_worked_minutes+30)/60));
  insert into public.mission_invoices(
    mission_id,provider_id,client_id,provider_service_id,pricing_model,worked_minutes,
    hourly_rate,minimum_charge,labor_amount,material_amount,total_amount,currency
  ) values(
    mission_row.id,uid,mission_row.client_id,service_row.id,'hourly',total_worked_minutes,
    service_row.hourly_rate,service_row.minimum_charge,calculated_labor,new_material_amount,
    calculated_labor+new_material_amount,service_row.currency
  ) returning * into result;
  update public.missions
    set final_authorized_amount=result.total_amount,status='completed_pending_payment',version=version+1
    where id=mission_row.id and provider_id=uid and version=expected_version;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.invoice.submitted',uid,'provider',jsonb_build_object(
      'invoiceId',result.id,'pricingModel',result.pricing_model,'workedMinutes',result.worked_minutes,
      'hourlyRate',result.hourly_rate,'minimumCharge',result.minimum_charge,
      'laborAmount',result.labor_amount,'materialAmount',result.material_amount,'totalAmount',result.total_amount
    ));
  return result;
end $$;

revoke all on function public.start_current_provider_intervention(uuid,integer) from public,anon;
revoke all on function public.submit_current_provider_hourly_invoice(uuid,integer,integer,integer,bigint) from public,anon;
grant execute on function public.start_current_provider_intervention(uuid,integer) to authenticated;
grant execute on function public.submit_current_provider_hourly_invoice(uuid,integer,integer,integer,bigint) to authenticated;
