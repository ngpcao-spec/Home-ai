begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('59900000-0000-0000-0000-000000000001','identity-a@test.invalid','{"full_name":"Provider A"}'),
 ('59900000-0000-0000-0000-000000000002','identity-b@test.invalid','{"full_name":"Provider B"}');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','59900000-0000-0000-0000-000000000001',true);
select public.provision_current_provider();
select set_config('request.jwt.claim.sub','59900000-0000-0000-0000-000000000002',true);
select public.provision_current_provider();

reset role;
insert into public.provider_kyc_submissions(id,provider_id,status,document_path,ai_extraction)
values(
 '59900000-0000-0000-0000-000000000010','59900000-0000-0000-0000-000000000001','draft',
 'provider/59900000-0000-0000-0000-000000000001/identity/front/59900000-0000-0000-0000-000000000011.jpg',
 '{"documentReadable":true,"fields":{"address":{"value":"Nha Trang","confidence":0.8},"date_of_birth":{"value":"01/01/1990","confidence":0.9},"expiry_date":{"value":null,"confidence":0},"full_name":{"value":"Provider A","confidence":0.9},"identity_number":{"value":"123456789012","confidence":0.9},"nationality":{"value":"Việt Nam","confidence":0.8},"sex":{"value":"Nam","confidence":0.8}}}'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','59900000-0000-0000-0000-000000000001',true);
select public.complete_current_provider_identity_assist(
 '59900000-0000-0000-0000-000000000010',
 '{"address":"Nha Trang","date_of_birth":"01/01/1990","expiry_date":null,"full_name":"Nguyễn Văn A","identity_number":"123456789012","nationality":"Việt Nam","sex":"Nam"}'
);

do $$ begin
  if (select status from public.provider_kyc_submissions where provider_id=auth.uid())<>'draft' then raise exception 'Identity assist submitted KYC'; end if;
  if (select submitted_at from public.provider_kyc_submissions where provider_id=auth.uid()) is not null then raise exception 'Identity assist marked submission submitted'; end if;
  if (select kyc_status from public.provider_profiles where provider_id=auth.uid())='verified' then raise exception 'Identity assist verified KYC'; end if;
  if (select display_name from public.profiles where user_id=auth.uid())<>'Nguyễn Văn A' then raise exception 'Confirmed name did not prefill profile'; end if;
  if not (public.get_current_provider_onboarding_state()->>'identityAssistComplete')::boolean then raise exception 'Identity assist step was not persisted'; end if;
end $$;

select set_config('request.jwt.claim.sub','59900000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform public.complete_current_provider_identity_assist(
      '59900000-0000-0000-0000-000000000010',
      '{"address":null,"date_of_birth":null,"expiry_date":null,"full_name":"Attack","identity_number":null,"nationality":null,"sex":null}'
    );
    raise exception 'Provider B changed Provider A identity draft';
  exception when insufficient_privilege then null; end;
  perform public.mark_current_provider_onboarding_step('identity_assist');
  if not (public.get_current_provider_onboarding_state()->>'identityAssistComplete')::boolean then raise exception 'Manual entry path did not advance'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.complete_current_provider_identity_assist(uuid,jsonb)','execute') then raise exception 'Anon identity assist allowed'; end if;
  if has_table_privilege('authenticated','public.provider_onboarding_progress','update') then raise exception 'Frontend can update progress directly'; end if;
end $$;
rollback;
