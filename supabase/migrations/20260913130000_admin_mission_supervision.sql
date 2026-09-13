-- Read-only Admin supervision. No lifecycle, participant permissions or pricing changes.
create or replace function private.guard_admin_supervision_read_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role())='authenticated' and private.is_admin() then
    raise exception 'Admin supervision is read-only.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.guard_admin_supervision_read_only() from public,anon,authenticated;
do $$ declare name text; begin
  foreach name in array array['profiles','provider_profiles','provider_services','provider_status',
    'missions','mission_offers','mission_events','quotes','quote_items','mission_invoices','reviews','customer_addresses'] loop
    execute format('create trigger admin_supervision_read_only before insert or update or delete on public.%I for each row execute function private.guard_admin_supervision_read_only()',name);
  end loop;
end $$;

create function private.admin_mission_summary(m public.missions)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'status',m.status,'serviceCategory',m.service_category,
    'clientName',(select display_name from public.profiles where user_id=m.client_id),
    'providerName',(select display_name from public.profiles where user_id=m.provider_id),
    'createdAt',m.created_at,'address',m.address_text,
    'finalAmount',coalesce((select total_amount from public.mission_invoices where mission_id=m.id),m.final_authorized_amount,
      (select total_amount from public.quotes where mission_id=m.id and status='accepted' order by version desc limit 1)),
    'currency',m.currency,'paymentStatus',m.payment_status)
$$;
revoke all on function private.admin_mission_summary(public.missions) from public,anon,authenticated;

create function public.get_admin_missions(new_filter text default 'all',page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
  perform public.require_current_admin();
  if new_filter not in ('all','active','completed','cancelled') or new_filter is null or page_offset is null or page_offset<0 then
    raise exception 'Invalid mission filter.' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(private.admin_mission_summary(m.mission) order by (m.mission).created_at desc,(m.mission).id desc) filter(where row_number<=page_offset+50),'[]'),
    'hasMore',coalesce(bool_or(row_number>page_offset+50),false)) into result
  from (select m as mission,row_number() over(order by m.created_at desc,m.id desc) from public.missions m
    where new_filter='all' or new_filter='active' and m.status not in ('completed','cancelled','expired')
      or new_filter='completed' and m.status='completed' or new_filter='cancelled' and m.status in ('cancelled','expired')
    order by m.created_at desc,m.id desc limit 51 offset page_offset) m;
  return result;
end $$;

create function public.get_admin_mission_detail(target_mission_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.missions; invoice public.mission_invoices; quote public.quotes; result jsonb; begin
  perform public.require_current_admin();
  select * into m from public.missions where id=target_mission_id;
  if m.id is null then raise exception 'Mission not found.' using errcode='P0002'; end if;
  select * into invoice from public.mission_invoices where mission_id=m.id;
  select * into quote from public.quotes where mission_id=m.id and status='accepted' order by version desc limit 1;
  result:=private.admin_mission_summary(m)||jsonb_build_object('problem',m.problem_description,
    'dates',jsonb_build_object('requested',m.requested_at,'accepted',m.accepted_at,'travelling',m.travelling_at,
      'arrived',m.arrived_at,'started',m.started_at,'completed',m.completed_at,'cancelled',m.cancelled_at),
    'invoice',case when invoice.id is null then null else jsonb_build_object('pricingModel',invoice.pricing_model,
      'hourlyRate',invoice.hourly_rate,'minimumCharge',invoice.minimum_charge,'workedMinutes',invoice.worked_minutes,
      'laborAmount',invoice.labor_amount,'materialAmount',invoice.material_amount,'totalAmount',invoice.total_amount,'submittedAt',invoice.submitted_at) end,
    'acceptedQuote',case when quote.id is null then null else jsonb_build_object('version',quote.version,'totalAmount',quote.total_amount,
      'warrantyDays',quote.warranty_days,'acceptedAt',quote.decided_at) end,
    'review',(select jsonb_build_object('rating',rating,'comment',comment,'createdAt',created_at) from public.reviews where mission_id=m.id),
    'events',coalesce((select jsonb_agg(jsonb_build_object('type',event_type,'createdAt',created_at) order by created_at,id)
      from public.mission_events where mission_id=m.id and event_type in ('mission.created','mission.offer.accepted',
        'mission.provider.travelling','mission.provider.arrived','mission.intervention.started','mission.intervention.finished',
        'mission.invoice.submitted','mission.completed.external_payment','mission.cancelled')),'[]'));
  return result;
end $$;

create function private.admin_provider_summary(target_provider_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',pp.provider_id,'name',p.display_name,'avatarPath',pp.avatar_storage_path,
    'verified',pp.kyc_status='verified','online',coalesce(s.online,false),'ratingAverage',pp.rating_average,
    'reviewCount',pp.review_count,'completedJobs',(select count(*) from public.missions where provider_id=pp.provider_id and status='completed'),
    'experienceYears',pp.experience_years,'introduction',pp.description,
    'activities',coalesce((select jsonb_agg(jsonb_build_object('serviceCategory',service_category,'name',activity_name) order by service_category)
      from public.provider_services where provider_id=pp.provider_id),'[]'))
  from public.provider_profiles pp join public.profiles p on p.user_id=pp.provider_id
  left join public.provider_status s on s.provider_id=pp.provider_id where pp.provider_id=target_provider_id
$$;
revoke all on function private.admin_provider_summary(uuid) from public,anon,authenticated;

create function public.get_admin_providers(page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
  perform public.require_current_admin();
  if page_offset is null or page_offset<0 then raise exception 'Invalid page.' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(private.admin_provider_summary(provider_id) order by provider_id) filter(where row_number<=page_offset+50),'[]'),
    'hasMore',coalesce(bool_or(row_number>page_offset+50),false)) into result
  from (select provider_id,row_number() over(order by provider_id) from public.provider_profiles order by provider_id limit 51 offset page_offset) p;
  return result;
end $$;

create function public.get_admin_provider_profile(target_provider_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
  perform public.require_current_admin();
  result:=private.admin_provider_summary(target_provider_id);
  if result is null then raise exception 'Provider not found.' using errcode='P0002'; end if;
  return result;
end $$;

revoke all on function public.get_admin_missions(text,integer) from public,anon,authenticated;
revoke all on function public.get_admin_mission_detail(uuid) from public,anon,authenticated;
revoke all on function public.get_admin_providers(integer) from public,anon,authenticated;
revoke all on function public.get_admin_provider_profile(uuid) from public,anon,authenticated;
grant execute on function public.get_admin_missions(text,integer), public.get_admin_mission_detail(uuid),
  public.get_admin_providers(integer),public.get_admin_provider_profile(uuid) to authenticated;
