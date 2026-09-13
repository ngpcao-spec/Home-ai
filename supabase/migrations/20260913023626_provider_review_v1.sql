-- Reuse immutable reviews and the existing review RPC; no mission lifecycle changes.
alter table public.reviews drop constraint reviews_comment_check;
alter table public.reviews add constraint reviews_comment_check check (comment is null or char_length(comment)<=500);

create or replace function public.create_current_customer_review(target_mission_id uuid,new_rating integer,new_comment text default null)
returns public.reviews language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mission_row public.missions; result public.reviews;
begin
  if uid is null or (select auth.role()) <> 'authenticated' or not private.profile_has_role(uid,'customer') then
    raise exception 'Customer authentication required.' using errcode='42501';
  end if;
  if new_rating is null or new_rating not between 1 and 5 or char_length(coalesce(new_comment,''))>500 then raise exception 'Invalid review.' using errcode='22023'; end if;
  select * into mission_row from public.missions where id=target_mission_id for update;
  if mission_row.id is null or mission_row.client_id is distinct from uid or mission_row.provider_id is null or mission_row.status<>'completed'
     or mission_row.payment_status<>'paid_external' then raise exception 'Completed customer mission not found.' using errcode='42501'; end if;
  if exists(select 1 from public.reviews r where r.mission_id=mission_row.id) then raise exception 'Mission already reviewed.' using errcode='23505'; end if;
  -- Serialize all submissions for this provider, including different missions.
  -- The cache is always recomputed from persisted reviews, never client values.
  perform 1 from public.provider_profiles where provider_id=mission_row.provider_id for update;
  insert into public.reviews(mission_id,client_id,provider_id,rating,comment)
    values(mission_row.id,uid,mission_row.provider_id,new_rating,nullif(trim(coalesce(new_comment,'')),'')) returning * into result;
  update public.provider_profiles pp set rating_average=summary.average_rating,review_count=summary.review_count,updated_at=statement_timestamp()
    from (select round(avg(r.rating)::numeric,2) average_rating,count(*)::integer review_count from public.reviews r where r.provider_id=mission_row.provider_id) summary
    where pp.provider_id=mission_row.provider_id;
  insert into public.mission_events(mission_id,event_type,actor_user_id,actor_role,payload)
    values(mission_row.id,'mission.review.created',uid,'customer',jsonb_build_object('reviewId',result.id,'rating',result.rating));
  return result;
end $$;


revoke insert,update,delete on public.reviews from authenticated,anon;
revoke all on function public.create_current_customer_review(uuid,integer,text) from public,anon;
grant execute on function public.create_current_customer_review(uuid,integer,text) to authenticated;
