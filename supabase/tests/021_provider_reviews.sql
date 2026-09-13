-- Run after provider_review_v1. Synthetic fixtures; no real user data retained.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('59300000-0000-0000-0000-000000000001'::uuid,'call-provider-a@test.invalid'),
  ('59300000-0000-0000-0000-000000000002'::uuid,'call-provider-b@test.invalid'),
  ('59300000-0000-0000-0000-000000000003'::uuid,'call-customer-a@test.invalid'),
  ('59300000-0000-0000-0000-000000000004'::uuid,'call-customer-b@test.invalid'),
  ('59300000-0000-0000-0000-000000000005'::uuid,'call-customer-searching@test.invalid')
) u(id,email);

insert into public.profiles(user_id,role,display_name,phone) values
  ('59300000-0000-0000-0000-000000000001','provider','Call Provider A','+84910000001'),
  ('59300000-0000-0000-0000-000000000002','provider','Call Provider B','+84910000002'),
  ('59300000-0000-0000-0000-000000000003','customer','Call Customer A','+84910000003'),
  ('59300000-0000-0000-0000-000000000004','customer','Call Customer B','+84910000004'),
  ('59300000-0000-0000-0000-000000000005','customer','Call Customer Searching','+84910000005');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
  ('59300000-0000-0000-0000-000000000001','Electricity','verified',true),
  ('59300000-0000-0000-0000-000000000002','Plumbing','verified',true);

insert into public.missions(id,client_id,provider_id,service_category,problem_description,
  address_text,client_latitude,client_longitude,status) values
  ('59300000-0000-0000-0000-000000000010','59300000-0000-0000-0000-000000000003','59300000-0000-0000-0000-000000000001','electricity','Pending payment fixture','Nha Trang',12.2,109.2,'completed_pending_payment'),
  ('59300000-0000-0000-0000-000000000011','59300000-0000-0000-0000-000000000005',null,'electricity','Searching call','Nha Trang',12.2,109.2,'searching'),
  ('59300000-0000-0000-0000-000000000012','59300000-0000-0000-0000-000000000003','59300000-0000-0000-0000-000000000001','electricity','Completed call','Nha Trang',12.2,109.2,'completed'),
  ('59300000-0000-0000-0000-000000000013','59300000-0000-0000-0000-000000000003',null,'electricity','Cancelled call','Nha Trang',12.2,109.2,'cancelled');



update public.missions set payment_status='paid_external',final_authorized_amount=100000 where id='59300000-0000-0000-0000-000000000012';
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status,payment_status)
select ('59300000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'59300000-0000-0000-0000-000000000003','59300000-0000-0000-0000-000000000001','electricity','Review fixture','Test',12.2,109.2,'completed','paid_external' from generate_series(20,23)n;
insert into public.missions(id,client_id,provider_id,service_category,problem_description,address_text,client_latitude,client_longitude,status)
values ('59300000-0000-0000-0000-000000000025','59300000-0000-0000-0000-000000000003','59300000-0000-0000-0000-000000000001','electricity','Unpaid completed fixture','Test',12.2,109.2,'completed');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"59300000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare r public.reviews;
begin
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000025',5,null);raise exception 'Unpaid completed review';exception when insufficient_privilege then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000013',5,null);raise exception 'Cancelled review';exception when insufficient_privilege then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000010',5,null);raise exception 'Active mission review';exception when insufficient_privilege then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',0,null);raise exception 'Rating zero';exception when sqlstate '22023' then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',6,null);raise exception 'Rating six';exception when sqlstate '22023' then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',null,null);raise exception 'Rating null';exception when sqlstate '22023' then null;end;
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',5,repeat('x',501));raise exception 'Long comment';exception when sqlstate '22023' then null;end;
 r:=public.create_current_customer_review('59300000-0000-0000-0000-000000000012',5,repeat('x',500));
 if r.client_id<>auth.uid() or r.provider_id<>'59300000-0000-0000-0000-000000000001' or char_length(r.comment)<>500 then raise exception 'Participants not derived';end if;
 begin perform public.create_current_customer_review(r.mission_id,1,null);raise exception 'Duplicate accepted';exception when unique_violation then null;end;
 if (select count(*) from public.reviews where mission_id=r.mission_id)<>1 then raise exception 'Duplicate rows';end if;
 begin insert into public.reviews(mission_id,client_id,provider_id,rating)values('59300000-0000-0000-0000-000000000020',auth.uid(),'59300000-0000-0000-0000-000000000002',5);raise exception 'Spoofed direct insert';exception when insufficient_privilege then null;end;
 begin update public.reviews set rating=1 where id=r.id;raise exception 'Review update';exception when insufficient_privilege then null;end;
 begin delete from public.reviews where id=r.id;raise exception 'Review delete';exception when insufficient_privilege then null;end;
 r:=public.create_current_customer_review('59300000-0000-0000-0000-000000000020',5,null);if r.comment is not null then raise exception 'Optional comment';end if;
 r:=public.create_current_customer_review('59300000-0000-0000-0000-000000000021',4,'  ');if r.comment is not null then raise exception 'Blank optional comment';end if;
 if not exists(select from public.provider_profiles where provider_id=r.provider_id and rating_average=4.67 and review_count=3)then raise exception 'Odd mean/count';end if;
 r:=public.create_current_customer_review('59300000-0000-0000-0000-000000000022',5,null);
 if not exists(select from public.provider_profiles where provider_id=r.provider_id and rating_average=4.75 and review_count=4)then raise exception 'Even mean/count';end if;
 if public.get_provider_professional_profile(r.provider_id,null)->>'ratingAverage'<>'4.75' then raise exception 'Public profile stale mean';end if;
 if public.get_provider_professional_profile(r.provider_id,null)->>'reviewCount'<>'4' then raise exception 'Public profile stale count';end if;
 if public.get_provider_professional_profile(r.provider_id,null) ?| array['clientId','client_id','customerName','comment','reviews','phone','birthDate','nationality','documentPath'] then raise exception 'Private client/KYC exposed';end if;
 r:=public.create_current_customer_review('59300000-0000-0000-0000-000000000023',1,null);
 if not exists(select from public.provider_profiles where provider_id=r.provider_id and rating_average=4 and review_count=5)then raise exception 'Rating one and mean';end if;
end $$;
set local "request.jwt.claims"='{"sub":"59300000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',5,null);raise exception 'Other client review';exception when insufficient_privilege then null;end;
 if exists(select from public.reviews where provider_id='59300000-0000-0000-0000-000000000001')then raise exception 'Other client sees reviews';end if;
end $$;
set local "request.jwt.claims"='{"sub":"59300000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',5,null);raise exception 'Provider review';exception when insufficient_privilege then null;end;
 update public.provider_profiles set rating_average=1,review_count=99 where provider_id=auth.uid();
 if not exists(select from public.provider_profiles where provider_id=auth.uid() and rating_average=4 and review_count=5)then raise exception 'Provider could forge rating';end if;
 if public.get_current_provider_professional_profile()->>'ratingAverage'<>'4.00' then raise exception 'Own profile mean';end if;
end $$;
reset role;
set local role anon;
set local "request.jwt.claims"='{}';
do $$ begin
 begin perform public.create_current_customer_review('59300000-0000-0000-0000-000000000012',5,null);raise exception 'Anonymous review';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- The unique constraint is the final concurrency guard even outside the RPC.
do $$ begin
 begin insert into public.reviews(mission_id,client_id,provider_id,rating)values('59300000-0000-0000-0000-000000000012','59300000-0000-0000-0000-000000000003','59300000-0000-0000-0000-000000000001',1);raise exception 'Missing unique guard';exception when unique_violation then null;end;
 if (select count(*) from public.reviews where mission_id='59300000-0000-0000-0000-000000000012')<>1 then raise exception 'More than one review';end if;
 if pg_get_functiondef('public.create_current_customer_review(uuid,integer,text)'::regprocedure) not like '%provider_profiles where provider_id=mission_row.provider_id for update%' then raise exception 'Missing provider aggregate lock';end if;
end $$;
rollback;
