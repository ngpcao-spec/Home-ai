import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { getProviderOnboardingStep, initialiseProviderOnboarding, renderProviderOnboarding } from '../src/provider/provider-onboarding.js';
import { createProgressiveProviderAppRepository } from '../src/provider/provider-repository.js';
import { renderProviderLogin } from '../src/provider/provider-app.js';

const base={providerExists:true,providerId:'p1',kycStatus:'pending',kycSubmissionStatus:null,
  professionalProfileComplete:false,hasActivity:false,serviceAreaComplete:false,
  availabilityComplete:false,onboardingComplete:false,readyForMissions:false};

test('déduit toujours la prochaine étape depuis les données persistées',()=>{
  assert.equal(getProviderOnboardingStep({providerExists:false}),'welcome');
  assert.equal(getProviderOnboardingStep(base),'profile');
  assert.equal(getProviderOnboardingStep({...base,kycSubmissionStatus:'pending_review'}),'profile');
  assert.equal(getProviderOnboardingStep({...base,professionalProfileComplete:true}),'activities');
  assert.equal(getProviderOnboardingStep({...base,professionalProfileComplete:true,hasActivity:true}),'service-area');
  assert.equal(getProviderOnboardingStep({...base,professionalProfileComplete:true,hasActivity:true,serviceAreaComplete:true}),'availability');
  assert.equal(getProviderOnboardingStep({...base,professionalProfileComplete:true,hasActivity:true,serviceAreaComplete:true,availabilityComplete:true}),'complete');
});

test('remplace le blocage Admin par un accueil Provider explicite',()=>{
  const html=renderProviderOnboarding({providerExists:false});
  assert.match(html,/Chào mừng bạn đến với HOME AI/);assert.match(html,/data-start-provider-onboarding/);
  assert.doesNotMatch(html,/chưa được kích hoạt|Quản trị viên.*cấp vai trò/i);
  assert.doesNotMatch(renderProviderLogin({provisioning:true}),/chưa được kích hoạt|Quản trị viên.*cấp vai trò/i);
});

test('un compte Supabase sans profil reçoit le repository onboarding sans fallback mock',async()=>{
  let fallbackLoads=0;const rpc=[];
  const offers={getCurrentProviderOnboardingState:async()=>({providerExists:false,onboardingComplete:false,readyForMissions:false}),provisionCurrentProvider:async()=>({providerExists:true})};
  const repo=await createProgressiveProviderAppRepository({}, {source:'mock',load:async()=>{fallbackLoads++;}},()=>({enabled:true,client:{auth:{getUser:async()=>({data:{user:{id:'p1'}},error:null})}},offers}));
  assert.equal(repo.source,'supabase');assert.equal(repo.onboardingRequired,true);assert.equal(fallbackLoads,0);
  await repo.provision();assert.equal(fallbackLoads,0);
});

test('l’accueil déclenche une seule création auth.uid puis reprend sur le profil sans KYC',async()=>{
  const dom=new JSDOM('<div id="root"></div>');const root=dom.window.document.querySelector('#root');let created=0;
  let state={providerExists:false};
  const repo={getOnboardingState:async()=>state,provision:async()=>{created++;state={...base,providerExists:true};return state;},getProfessionalProfile:async()=>({name:'',phone:'',experienceYears:null,introduction:''})};
  const app=await initialiseProviderOnboarding(root,repo);
  root.querySelector('[data-start-provider-onboarding]').click();root.querySelector('[data-start-provider-onboarding]')?.click();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(created,1);assert.equal(root.dataset.providerOnboarding??root.firstElementChild.dataset.providerOnboarding,'profile');
  app.stop();dom.window.close();
});

test('la migration limite le provisioning à auth.uid et retire seulement KYC de l’éligibilité V1',async()=>{
  const [migration,v1]=await Promise.all([
    readFile(new URL('../supabase/migrations/20260915120000_provider_self_onboarding.sql',import.meta.url),'utf8'),
    readFile(new URL('../supabase/migrations/20260915123000_v1_provider_without_kyc.sql',import.meta.url),'utf8'),
  ]);
  assert.match(migration,/uid uuid:=\(select auth\.uid\(\)\)/);assert.doesNotMatch(migration,/target_provider_id|new_role|role text/);
  assert.match(migration,/values\(uid,'provider'/);assert.doesNotMatch(migration,/values\(uid,'admin'/);
  assert.match(migration,/values\(uid,false,false\)/);assert.match(migration,/existing_role<>\s*'provider'/);
  assert.match(v1,/private\.provider_v1_onboarding_complete/);assert.match(v1,/svc\.enabled/);assert.match(v1,/pst\.online and pst\.available/);
  assert.doesNotMatch(v1,/and\s+pp\.kyc_status\s*=\s*'verified'/);assert.doesNotMatch(v1,/kyc_status\s*<>\s*'verified'/);
});
