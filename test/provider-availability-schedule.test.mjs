import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { renderProviderAvailabilitySchedule, readProviderAvailabilitySchedule, syncProviderAvailabilityScheduleForm } from '../src/provider/provider-availability-schedule.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';

test('rend les modes manuel, horaire et 24/24 en vietnamien', () => {
  const html=renderProviderAvailabilitySchedule({mode:'manual',available24h:false,weeklySchedule:[]});
  assert.match(html,/Thủ công/);assert.match(html,/Theo lịch \+ Trực tuyến/);assert.match(html,/Sẵn sàng 24\/24/);
  assert.match(html,/Thứ Hai/);assert.match(html,/Chủ Nhật/);
});

test('lit un horaire hebdomadaire sans rendre le texte libre obligatoire', () => {
  const dom=new JSDOM(`<main>${renderProviderAvailabilitySchedule({mode:'scheduled',available24h:false,weeklySchedule:[{day:1,start:'08:00',end:'18:00'}]})}</main>`);
  const root=dom.window.document.querySelector('main');
  assert.deepEqual(readProviderAvailabilitySchedule(root),{mode:'scheduled',available24h:false,weeklySchedule:[{day:1,start:'08:00',end:'18:00'}],valid:true});
  root.querySelector('[data-availability-24h]').checked=true;syncProviderAvailabilityScheduleForm(root);
  assert.equal(root.querySelector('[data-availability-days]').hidden,true);
  assert.equal(readProviderAvailabilitySchedule(root).valid,true);
});

test('refuse le mode horaire sans plage ni option 24/24', () => {
  const dom=new JSDOM(`<main>${renderProviderAvailabilitySchedule({mode:'scheduled',available24h:false,weeklySchedule:[]})}</main>`);
  assert.equal(readProviderAvailabilitySchedule(dom.window.document.querySelector('main')).valid,false);
});

test('utilise des RPC authentifiées limitées à l’utilisateur courant', async () => {
  const calls=[];const client={from(){return{};},rpc:async(name,args)=>{calls.push([name,args]);return {data:{mode:'scheduled',available_24h:true,weekly_schedule:[]},error:null};}};
  const repository=createSupabaseOffersRepository(client);
  await repository.getCurrentProviderAvailabilityPreferences();
  await repository.setCurrentProviderAvailabilityPreferences({mode:'scheduled',available24h:true,weeklySchedule:[]});
  assert.deepEqual(calls,[
    ['get_current_provider_availability_preferences',undefined],
    ['set_current_provider_availability_preferences',{new_mode:'scheduled',new_available_24h:true,new_weekly_schedule:[]}],
  ]);
  assert.equal(JSON.stringify(calls).includes('provider_id'),false);
});

test('applique la contrainte horaire dans présélection, dispatch et acceptation', async () => {
  const migration=await readFile(new URL('../supabase/migrations/20260911005000_provider_availability_schedule.sql',import.meta.url),'utf8');
  assert.match(migration,/availability_mode text not null default 'manual'/);
  assert.match(migration,/private\.provider_schedule_allows\(pp\.provider_id,statement_timestamp\(\)\)/);
  assert.match(migration,/dispatch_next_mission_offer[\s\S]*provider_schedule_allows/);
  assert.match(migration,/accept_current_provider_offer[\s\S]*provider_schedule_allows\(uid,statement_timestamp\(\)\)/);
  assert.match(migration,/pst\.online and pst\.available and pst\.current_mission_id is null/);
  assert.match(migration,/last_location_at>=statement_timestamp\(\)-maximum_location_age/);
  assert.match(migration,/distance_km<=c\.service_radius_km/);
  assert.match(migration,/revoke all on function public\.set_current_provider_availability_preferences[\s\S]*from public, anon/);
});
