begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now() from (values
 ('62000000-0000-0000-0000-000000000001'::uuid,'push-a@test.invalid'),('62000000-0000-0000-0000-000000000002'::uuid,'push-b@test.invalid'),('62000000-0000-0000-0000-000000000003'::uuid,'push-client@test.invalid')) u(id,email);
insert into public.profiles(user_id,role,display_name,phone) values
 ('62000000-0000-0000-0000-000000000001','provider','Push A','+84910000101'),('62000000-0000-0000-0000-000000000002','provider','Push B','+84910000102'),('62000000-0000-0000-0000-000000000003','customer','Push Client','+84910000103');
insert into public.provider_profiles(provider_id,specialty,kyc_status,active) values
 ('62000000-0000-0000-0000-000000000001','Electricity','verified',true),('62000000-0000-0000-0000-000000000002','Electricity','verified',true);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.register_current_provider_push_subscription('62000000-0000-4000-8000-000000000011','https://push.example/a','pppppppppppppppppppppppppppppppppppppppp','aaaaaaaaaaaaaaaaaaaa');
select public.register_current_provider_push_subscription('62000000-0000-4000-8000-000000000012','https://push.example/a2','qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq','bbbbbbbbbbbbbbbbbbbb');
select public.register_current_provider_push_subscription('62000000-0000-4000-8000-000000000012','https://push.example/a2-renewed','qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx','bbbbbbbbbbbbbbbbbbbx');
do $$ begin
 begin perform * from public.provider_push_subscriptions;raise exception 'Direct subscription SELECT allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.provider_push_outbox;raise exception 'Direct outbox SELECT allowed';exception when insufficient_privilege then null;end;
 begin perform public.claim_provider_push_outbox(gen_random_uuid(),'forbidden');raise exception 'Provider invoked backend claim';exception when insufficient_privilege then null;end;
 if (public.get_current_provider_push_state()->>'enabledCount')::int<>2 then raise exception 'Multiple device count incorrect';end if;
end $$;

set local "request.jwt.claims"='{"sub":"62000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
 begin perform public.register_current_provider_push_subscription('62000000-0000-4000-8000-000000000021','https://push.example/a','rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr','cccccccccccccccccccc');raise exception 'Provider B stole endpoint';exception when insufficient_privilege then null;end;
 if public.revoke_current_provider_push_installation('62000000-0000-4000-8000-000000000011') then raise exception 'Provider B revoked A';end if;
end $$;

set local "request.jwt.claims"='{"sub":"62000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
 begin perform public.register_current_provider_push_subscription('62000000-0000-4000-8000-000000000031','https://push.example/client','ssssssssssssssssssssssssssssssssssssssss','dddddddddddddddddddd');raise exception 'Client registered push';exception when insufficient_privilege then null;end;
 begin perform public.get_current_provider_push_state();raise exception 'Client read push state';exception when insufficient_privilege then null;end;
 begin perform public.revoke_current_provider_push_installation('62000000-0000-4000-8000-000000000011');raise exception 'Client invoked revoke';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.register_current_provider_push_subscription(uuid,text,text,text)','execute') then raise exception 'Anon can register';end if;end $$;
do $$ begin
 if has_function_privilege('anon','public.claim_provider_push_outbox(uuid,text)','execute') then raise exception 'Anon can claim outbox';end if;
 if has_function_privilege('authenticated','public.claim_provider_push_outbox(uuid,text)','execute') then raise exception 'Authenticated can claim outbox';end if;
 if not has_function_privilege('service_role','public.claim_provider_push_outbox(uuid,text)','execute') then raise exception 'Service role cannot claim outbox';end if;
 if not has_column_privilege('service_role','public.mission_offers','id','select')
    or not has_column_privilege('service_role','public.mission_offers','push_reference','select')
    or not has_column_privilege('service_role','public.mission_offers','status','select')
    or not has_column_privilege('service_role','public.mission_offers','expires_at','select')
    or not has_column_privilege('service_role','public.mission_offers','mission_id','select')
    or not has_column_privilege('service_role','public.mission_offers','provider_id','select') then
   raise exception 'Push backend cannot read the required offer columns';
 end if;
 if not has_column_privilege('service_role','public.missions','id','select')
    or not has_column_privilege('service_role','public.missions','status','select')
    or not has_column_privilege('service_role','public.missions','service_category','select')
    or not has_column_privilege('service_role','public.missions','provider_id','select') then
   raise exception 'Push backend cannot read the required mission columns';
 end if;
 if not has_column_privilege('service_role','public.provider_status','provider_id','select')
    or not has_column_privilege('service_role','public.provider_status','online','select')
    or not has_column_privilege('service_role','public.provider_status','available','select')
    or not has_column_privilege('service_role','public.provider_status','current_mission_id','select') then
   raise exception 'Push backend cannot read the required provider status columns';
 end if;
 if has_table_privilege('service_role','public.mission_offers','select')
    or has_table_privilege('service_role','public.missions','select')
    or has_table_privilege('service_role','public.provider_status','select') then
   raise exception 'Push backend received broader table SELECT than required';
 end if;
 if not exists(select 1 from pg_trigger where tgname='provider_push_outbox_webhook' and not tgisinternal) then raise exception 'Push webhook trigger missing';end if;
 if not exists(select 1 from vault.secrets where name='provider_push_webhook_secret') then raise exception 'Push webhook Vault secret missing';end if;
end $$;
rollback;
