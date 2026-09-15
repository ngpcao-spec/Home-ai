import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initialiseProviderOnboarding } from '../src/provider/provider-onboarding.js';
import { readProviderIdentityAssistForm, renderProviderKyc } from '../src/provider/provider-kyc.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';

const extraction={documentReadable:true,fields:{full_name:{value:'Nguyen Van A',confidence:.95},identity_number:{value:'123456789012',confidence:.9},date_of_birth:{value:'01/01/1990',confidence:.9},sex:{value:'Nam',confidence:.8},nationality:{value:'Việt Nam',confidence:.8},expiry_date:{value:null,confidence:0},address:{value:'Nha Trang',confidence:.8}}};
const pendingState={providerExists:true,providerId:'p1',identityAssistComplete:false,professionalProfileComplete:false,hasActivity:false,serviceAreaComplete:false,availabilityComplete:false,onboardingComplete:false,readyForMissions:false};

const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

test('photo CCCD -> extraction IA -> correction -> profil prérempli sans pending_review',async()=>{
  const dom=new JSDOM('<main id="root"></main>');const root=dom.window.document.querySelector('#root');
  let state={...pendingState};let completed=null;let uploaded=0;
  const submission={id:'s1',status:'draft',documentPath:'provider/p1/identity/front/private.jpg',extraction};
  const repository={
    getOnboardingState:async()=>state,loadKyc:async()=>({provider:{kycStatus:'pending'},submission:null}),
    uploadIdentity:async()=>{uploaded++;return{provider:{kycStatus:'pending'},submission};},getIdentityPreview:async()=>'/signed-short-lived',
    completeIdentityAssist:async(id,fields)=>{completed={id,fields};state={...state,identityAssistComplete:true};return state;},
    getProfessionalProfile:async()=>({name:completed?.fields.full_name??'Google Name',phone:'',experienceYears:null,introduction:''}),
  };
  const flow=await initialiseProviderOnboarding(root,repository);
  assert.match(root.textContent,/Chụp CCCD để điền thông tin nhanh hơn/);assert.match(root.textContent,/Nhập thông tin thủ công/);
  const input=root.querySelector('[data-provider-kyc-file]');Object.defineProperty(input,'files',{value:[{size:100,type:'image/jpeg',name:'cccd.jpg'}]});
  input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(uploaded,1);assert.match(root.textContent,/Xác nhận thông tin/);assert.doesNotMatch(root.textContent,/gửi HOME AI xem xét|đang được xác minh/);
  root.querySelector('[name="full_name"]').value='Nguyễn Văn A';root.querySelector('[data-confirm-provider-kyc]').click();await tick();
  assert.equal(completed.id,'s1');assert.equal(completed.fields.full_name,'Nguyễn Văn A');assert.equal(submission.status,'draft');
  assert.equal(root.querySelector('[name="displayName"]').value,'Nguyễn Văn A');
  flow.stop();dom.window.close();
});

test('analyse illisible autorise immédiatement la saisie manuelle',async()=>{
  const dom=new JSDOM('<main id="root"></main>');const root=dom.window.document.querySelector('#root');let state={...pendingState};let skipped=0;
  const repository={getOnboardingState:async()=>state,loadKyc:async()=>({submission:null}),uploadIdentity:async()=>{throw new Error('DOCUMENT_UNREADABLE');},
    markStep:async()=>{skipped++;state={...state,identityAssistComplete:true};return state;},getProfessionalProfile:async()=>({name:'Google Name',phone:'',experienceYears:null,introduction:''})};
  const flow=await initialiseProviderOnboarding(root,repository);const input=root.querySelector('[data-provider-kyc-file]');Object.defineProperty(input,'files',{value:[{size:100,type:'image/jpeg',name:'bad.jpg'}]});
  input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();assert.match(root.textContent,/chụp lại hoặc nhập thông tin thủ công/);
  root.querySelector('[data-skip-provider-identity-assist]').click();await tick();assert.equal(skipped,1);assert.ok(root.querySelector('[data-professional-profile-form]'));
  flow.stop();dom.window.close();
});

test('le mode aide rend les champs partiels éditables sans prétendre vérifier le KYC',()=>{
  const html=renderProviderKyc({submission:{id:'s1',status:'draft',extraction}},{stage:'confirm',assistMode:true});const dom=new JSDOM(html);
  const form=readProviderIdentityAssistForm(dom.window.document);assert.equal(form.valid,true);assert.equal(form.fields.full_name,'Nguyen Van A');
  assert.match(dom.window.document.body.textContent,/HOME AI chưa xác minh danh tính/);assert.doesNotMatch(dom.window.document.body.textContent,/gửi HOME AI xem xét/);
});

test('le repository confirme l’aide via une RPC auth.uid dédiée sans appeler la soumission KYC',async()=>{
  const calls=[];const client={from(){return{};},rpc:async(name,args)=>{calls.push([name,args]);return{data:{identityAssistComplete:true},error:null};}};
  await createSupabaseOffersRepository(client).completeCurrentProviderIdentityAssist('s1',{full_name:'Nguyễn Văn A'});
  assert.deepEqual(calls,[['complete_current_provider_identity_assist',{target_submission_id:'s1',new_fields:{full_name:'Nguyễn Văn A'}}]]);
});

test('la migration garde le brouillon privé et ne réintroduit aucun blocage KYC',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260915133000_provider_identity_assist_onboarding.sql',import.meta.url),'utf8');
  assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/submission\.provider_id<>uid/);assert.match(sql,/submission\.status<>'draft'/);
  assert.match(sql,/identity_assist_completed_at/);assert.match(sql,/update public\.profiles set display_name=confirmed_name/);
  const fn=sql.slice(sql.indexOf('create or replace function public.complete_current_provider_identity_assist'));
  assert.doesNotMatch(fn,/set\s+status\s*=\s*'pending_review'|set\s+kyc_status\s*=|status\s*=\s*'verified'/i);
  assert.match(fn,/revoke all on function public\.complete_current_provider_identity_assist\(uuid,jsonb\) from public,anon/);
});
