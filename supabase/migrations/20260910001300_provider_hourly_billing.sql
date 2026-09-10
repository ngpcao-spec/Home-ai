-- Provider-owned service pricing and immutable hourly mission invoices.
-- base_price remains legacy indicative data. Existing services stay on the
-- quote workflow until their provider explicitly configures hourly pricing.

alter table public.provider_services
  add column pricing_model text not null default 'quote',
  add column hourly_rate bigint,
  add column minimum_charge bigint,
  add constraint provider_services_pricing_model_check check (
    pricing_model in ('hourly','daily','fixed','per_unit','rental_daily','quote')
  ),
  add constraint provider_services_hourly_values_check check (
    (pricing_model = 'hourly'
      and hourly_rate between 1 and 1000000000
      and minimum_charge between 0 and 1000000000000)
    or (pricing_model <> 'hourly' and hourly_rate is null and minimum_charge is null)
  );

-- Explicit MVP test configuration. This does not derive hourly pricing from
-- base_price and does not change any other provider service.
do $$
declare configured_rows integer;
begin
  update public.provider_services ps
    set pricing_model='hourly', hourly_rate=300000, minimum_charge=400000,
        updated_at=statement_timestamp()
    from public.profiles p
    where p.user_id=ps.provider_id
      and p.role='provider'
      and p.display_name='Provider Test Nha Trang'
      and ps.service_category='electricity'
      and ps.enabled;
  get diagnostics configured_rows = row_count;
  if configured_rows <> 1 then
    raise exception 'Expected exactly one enabled electricity service for Provider Test Nha Trang; found %.', configured_rows;
  end if;
end $$;

create table public.mission_invoices (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null unique references public.missions(id) on delete restrict,
  provider_id uuid not null references public.provider_profiles(provider_id) on delete restrict,
  client_id uuid not null references public.profiles(user_id) on delete restrict,
  provider_service_id uuid not null references public.provider_services(id) on delete restrict,
  pricing_model text not null check (pricing_model='hourly'),
  worked_minutes integer not null check (worked_minutes between 1 and 10080),
  hourly_rate bigint not null check (hourly_rate between 1 and 1000000000),
  minimum_charge bigint not null check (minimum_charge between 0 and 1000000000000),
  labor_amount bigint not null,
  material_amount bigint not null check (material_amount between 0 and 1000000000000),
  total_amount bigint not null,
  currency char(3) not null default 'VND' check (currency=upper(currency)),
  submitted_at timestamptz not null default statement_timestamp(),
  constraint mission_invoices_labor_calculation_check check (
    labor_amount=greatest(minimum_charge,((hourly_rate*worked_minutes+30)/60))
  ),
  constraint mission_invoices_total_calculation_check check (total_amount=labor_amount+material_amount)
);

create index mission_invoices_provider_time_idx on public.mission_invoices(provider_id,submitted_at desc);
create index mission_invoices_client_time_idx on public.mission_invoices(client_id,submitted_at desc);
create index mission_invoices_provider_service_idx on public.mission_invoices(provider_service_id);

create trigger mission_invoices_append_only
  before update or delete on public.mission_invoices
  for each row execute function private.prevent_append_only_mutation();

alter table public.mission_invoices enable row level security;
revoke all on table public.mission_invoices from public,anon,authenticated;
grant select on table public.mission_invoices to authenticated;

create policy mission_invoices_participant_select on public.mission_invoices
  for select to authenticated using (
    client_id=(select auth.uid()) or provider_id=(select auth.uid()) or private.is_admin()
  );

create or replace function public.set_current_provider_service_hourly_pricing(
  target_service_category text,
  new_hourly_rate bigint,
  new_minimum_charge bigint
)
returns public.provider_services language plpgsql security definer set search_path='' as $$
declare uid uuid := (select auth.uid()); result public.provider_services;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider')
     or not exists(select 1 from public.provider_profiles pp where pp.provider_id=uid and pp.active and pp.kyc_status='verified') then
    raise exception 'Active provider authentication required.' using errcode='42501';
  end if;
  if new_hourly_rate is null or new_minimum_charge is null
     or new_hourly_rate not between 1 and 1000000000
     or new_minimum_charge not between 0 and 1000000000000 then
    raise exception 'Invalid hourly pricing.' using errcode='22023';
  end if;
  update public.provider_services
    set pricing_model='hourly',hourly_rate=new_hourly_rate,minimum_charge=new_minimum_charge,
        updated_at=statement_timestamp()
    where provider_id=uid and service_category=trim(target_service_category) and enabled
    returning * into result;
  if result.id is null then raise exception 'Provider service not found.' using errcode='42501'; end if;
  return result;
end $$;

create or replace function public.get_current_provider_billing_state(target_mission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; result jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' or not private.profile_has_role(uid,'provider') then
    raise exception 'Provider authentication required.' using errcode='42501';
  end if;
  select * into mission_row from public.missions where id=target_mission_id and provider_id=uid;
  if mission_row.id is null then raise exception 'Assigned mission not found.' using errcode='42501'; end if;
  select jsonb_build_object(
    'pricing',jsonb_build_object(
      'providerServiceId',ps.id,'pricingModel',ps.pricing_model,'hourlyRate',ps.hourly_rate,
      'minimumCharge',ps.minimum_charge,'currency',ps.currency
    ),
    'invoice',case when mi.id is null then null else jsonb_build_object(
      'id',mi.id,'missionId',mi.mission_id,'providerId',mi.provider_id,'clientId',mi.client_id,
      'providerServiceId',mi.provider_service_id,'pricingModel',mi.pricing_model,
      'workedMinutes',mi.worked_minutes,'hourlyRate',mi.hourly_rate,'minimumCharge',mi.minimum_charge,
      'laborAmount',mi.labor_amount,'materialAmount',mi.material_amount,'totalAmount',mi.total_amount,
      'currency',mi.currency,'submittedAt',mi.submitted_at
    ) end
  ) into result
  from public.provider_services ps
  left join public.mission_invoices mi on mi.mission_id=mission_row.id
  where ps.provider_id=uid and ps.service_category=mission_row.service_category and ps.enabled;
  if result is null then raise exception 'Provider service not found.' using errcode='55000'; end if;
  return result;
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
     or exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status in ('pending','supplement_pending'))
     or not exists(select 1 from public.quotes q where q.mission_id=mission_row.id and q.status='accepted') then
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

-- History remains participant-scoped and now includes the immutable invoice snapshot.
create or replace function public.get_current_user_mission_history()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid := (select auth.uid()); user_role public.app_role; result jsonb;
begin
  if uid is null or (select auth.role())<>'authenticated' then raise exception 'Authentication required.' using errcode='42501'; end if;
  select p.role into user_role from public.profiles p where p.user_id=uid and p.status='active';
  if user_role not in ('customer','provider') then raise exception 'Mission participant role required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'serviceCategory',m.service_category,'problemDescription',m.problem_description,
    'status',m.status,'providerId',m.provider_id,'clientId',m.client_id,'finalAuthorizedAmount',m.final_authorized_amount,
    'currency',m.currency,'paymentStatus',m.payment_status,'requestedAt',m.requested_at,'startedAt',m.started_at,'completedAt',m.completed_at,
    'invoice',case when mi.id is null then null else jsonb_build_object(
      'id',mi.id,'pricingModel',mi.pricing_model,'workedMinutes',mi.worked_minutes,
      'hourlyRate',mi.hourly_rate,'minimumCharge',mi.minimum_charge,'laborAmount',mi.labor_amount,
      'materialAmount',mi.material_amount,'totalAmount',mi.total_amount,'currency',mi.currency,'submittedAt',mi.submitted_at) end,
    'review',case when r.id is null then null else jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'createdAt',r.created_at) end
  ) order by m.created_at desc),'[]'::jsonb) into result
  from public.missions m
  left join public.reviews r on r.mission_id=m.id
  left join public.mission_invoices mi on mi.mission_id=m.id
  where (user_role='customer' and m.client_id=uid) or (user_role='provider' and m.provider_id=uid);
  return result;
end $$;

revoke all on function public.set_current_provider_service_hourly_pricing(text,bigint,bigint) from public,anon;
revoke all on function public.get_current_provider_billing_state(uuid) from public,anon;
revoke all on function public.submit_current_provider_hourly_invoice(uuid,integer,integer,integer,bigint) from public,anon;
grant execute on function public.set_current_provider_service_hourly_pricing(text,bigint,bigint) to authenticated;
grant execute on function public.get_current_provider_billing_state(uuid) to authenticated;
grant execute on function public.submit_current_provider_hourly_invoice(uuid,integer,integer,integer,bigint) to authenticated;
revoke all on function public.finish_current_provider_intervention(uuid,integer) from public,anon,authenticated;
