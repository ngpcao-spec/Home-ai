import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createProviderDispatchController, createProviderOfferAlert, renderIncomingOffer, updateDispatchCountdown } from '../src/provider/provider-dispatch.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';

describe('dispatch Provider Realtime', () => {
  it('reçoit une offre en Realtime et affiche le plein écran avec compte à rebours', async () => {
    let state={offers:[]}; let realtime; const received=[]; const tasks=[];
    const repository={source:'supabase',subscribeDispatch(callback){realtime=callback;return()=>{};},
      async load(){return state;},async expire(){return state;}};
    const controller=createProviderDispatchController({repository,getState:()=>state,onState:next=>{state=next;},
      onOffer:offer=>received.push(offer),scheduleTask:(task,delay)=>{tasks.push({task,delay});return tasks.length;},clearTask(){},now:()=>0});
    controller.start();
    state={offers:[{id:'o1',serviceCategory:'electricity',distanceKm:1.3,etaMinutes:5,approximateAddress:'Khu vực Nha Trang',request:'Mất điện',expiresAt:new Date(120000).toISOString()}]};
    await realtime({eventType:'INSERT'});
    assert.equal(received[0].id,'o1');
    assert.match(renderIncomingOffer(received[0],0),/02:00/);
    assert.match(renderIncomingOffer(received[0],0),/NHẬN VIỆC/);
    assert.match(renderIncomingOffer(received[0],0),/TỪ CHỐI/);
    assert.match(renderIncomingOffer({...received[0],indicativeAmount:200000,currency:'VND'},0),/200\.000đ/);
    controller.stop();
  });

  it('ne dépend d’aucune RPC navigateur pour expirer une offre', () => {
    const repository={source:'supabase',subscribeDispatch(){return()=>{};},async load(){return{offers:[]};}};
    const controller=createProviderDispatchController({repository,getState:()=>({offers:[{id:'o1'}]}),onState(){}});
    controller.start();
    assert.equal('expire' in repository,false);
    controller.stop();
  });

  it('utilise un polling court lorsque la page Provider est active', async () => {
    let state={offers:[]}; const received=[]; const tasks=[];
    const repository={source:'supabase',subscribeDispatch(){return()=>{};},async load(){return state;}};
    const controller=createProviderDispatchController({repository,getState:()=>state,onState:next=>{state=next;},
      onOffer:offer=>received.push(offer),scheduleTask:(task,delay)=>{tasks.push({task,delay});return tasks.length;},clearTask(){},intervalMs:2500,isPageActive:()=>true});
    controller.start();
    assert.equal(tasks[0].delay,2500);
    state={offers:[{id:'poll-offer'}]};
    await tasks.shift().task();
    assert.equal(received[0].id,'poll-offer');
    controller.stop();
  });

  it('charge le CSS plein écran au bon chemin Provider et privilégie le viewport iPhone', async () => {
    const [html,css,app]=await Promise.all([
      readFile(new URL('../provider/index.html',import.meta.url),'utf8'),
      readFile(new URL('../src/provider/provider-dispatch.css',import.meta.url),'utf8'),
      readFile(new URL('../src/provider/provider-app.js',import.meta.url),'utf8'),
    ]);
    assert.match(html,/href="\.\.\/src\/provider\/provider-dispatch\.css" data-provider-dispatch-styles/);
    assert.match(app,/link\.href = '\.\.\/src\/provider\/provider-dispatch\.css'/);
    assert.match(css,/position:fixed;z-index:50;inset:0;width:100%;height:100%/);
    assert.match(css,/@keyframes dispatch-bell-aura/);
    assert.match(css,/\.dispatch-countdown\{[^}]*width:68px;[^}]*height:68px;[^}]*border:4px solid/);
    assert.doesNotMatch(css,/\.dispatch-offer\{[^}]*animation:/);
    assert.match(css,/min-height:64px/);
  });

  it('répète une seule alerte par offre et arrête immédiatement son et vibration', async () => {
    const repeats=[]; const cleared=[]; const vibrations=[]; let oscillatorStarts=0;
    const audioContext={state:'suspended',currentTime:0,destination:{},resume:async()=>{audioContext.state='running';},createOscillator:()=>({frequency:{},connect(){},start(){oscillatorStarts+=1;},stop(){}}),createGain:()=>({gain:{},connect(){}})};
    const environment={AudioContext:function(){return audioContext;},navigator:{vibrate:value=>vibrations.push(value)}};
    const alert=createProviderOfferAlert({environment,scheduleRepeat:(fn,delay)=>{repeats.push({fn,delay});return 7;},clearRepeat:id=>cleared.push(id)});
    const offer={id:'o1',status:'pending',expiresAt:new Date(Date.now()+60000).toISOString()};
    assert.equal(alert.start(offer),true);
    assert.equal(alert.isAudioEnabled(),false);
    assert.equal(alert.needsAudioActivation(),true);
    assert.equal(alert.start(offer),false);
    assert.equal(repeats.length,1);
    await alert.unlock();
    assert.equal(alert.isAudioEnabled(),true);
    assert.equal(alert.needsAudioActivation(),false);
    repeats[0].fn();
    assert.ok(oscillatorStarts>=2);
    assert.equal(alert.stop('o1'),true);
    assert.deepEqual(cleared,[7]);
    assert.equal(vibrations.at(-1),0);
  });

  it('ne demande pas une activation audio quand le navigateur ne la requiert pas', () => {
    const alert=createProviderOfferAlert({environment:{navigator:{}},scheduleRepeat:()=>7,clearRepeat(){}});
    alert.start({id:'o1',status:'pending',expiresAt:new Date(Date.now()+60000).toISOString()});
    assert.equal(alert.needsAudioActivation(),false);
    alert.stop();
  });

  it('met à jour le compte à rebours sans reconstruire le DOM et atteint zéro', () => {
    let text=''; const element={dataset:{expiresAt:new Date(5000).toISOString()},set textContent(value){text=value;}};
    const root={querySelector:()=>element};
    assert.equal(updateDispatchCountdown(root,4000),1);
    assert.equal(text,'00:01');
    assert.equal(updateDispatchCountdown(root,5000),0);
    assert.equal(text,'00:00');
  });

  it('n invalide pas le DOM lorsque le polling retourne les mêmes données métier', async () => {
    const state={provider:{id:'p1'},status:{online:true,available:true},offers:[],assignment:null};
    let renders=0;
    const repository={source:'supabase',subscribeDispatch(){return()=>{};},async load(){return structuredClone(state);}};
    const controller=createProviderDispatchController({repository,getState:()=>state,onState:()=>{renders+=1;},scheduleTask:()=>1,clearTask(){}});
    controller.start();
    await controller.refresh();
    await controller.refresh();
    assert.equal(renders,0);
    controller.stop();
  });

  it('ne charge pas le dashboard en polling quand la page est inactive', async () => {
    let loads=0; const tasks=[];
    const repository={source:'supabase',subscribeDispatch(){return()=>{};},async load(){loads+=1;return{offers:[]};}};
    const controller=createProviderDispatchController({repository,getState:()=>({offers:[]}),onState(){},
      scheduleTask:(task)=>{tasks.push(task);return tasks.length;},clearTask(){},isPageActive:()=>false});
    controller.start();
    await tasks.shift()();
    assert.equal(loads,0);
    controller.stop();
  });

  it('abonne provider et client avec des filtres RLS sans service_role', () => {
    const channels=[]; const client={rpc(){},from(){return{};},channel(name){const registrations=[];const channel={name,on(...args){registrations.push(args);return channel;},subscribe(){return channel;},registrations};channels.push(channel);return channel;},removeChannel(){}};
    const offers=createSupabaseOffersRepository(client);
    const missions=createSupabaseMissionsRepository(client);
    offers.subscribeProviderDispatch('p1',()=>{});
    missions.subscribeMission('m1',()=>{});
    assert.match(channels[0].registrations[0][1].filter,/provider_id=eq.p1/);
    assert.ok(channels[1].registrations.some(([, spec]) => spec.table === 'missions' && spec.filter === 'id=eq.m1'));
    assert.ok(channels[1].registrations.some(([, spec]) => spec.table === 'provider_status' && spec.filter === 'current_mission_id=eq.m1'));
  });

  it('recharge immédiatement le client lors des changements mission et événements', async () => {
    let receive; const states=[];
    const mission={id:'m1',providerId:null,status:'searching'};
    const missionRepository={async getById(){return mission;},async getQuoteHistory(){return[];},async getOffers(){return[];},
      subscribeMission(id,callback){assert.equal(id,'m1');receive=callback;return()=>{};}};
    const sync=createCustomerMissionSynchronizer({missionRepository,providerRepository:{async getById(){return null;}}});
    sync.subscribe('m1',state=>states.push(state),()=>{});
    await receive({table:'mission_events',new:{event_type:'mission.offer.declined'}});
    assert.equal(states[0].mission.status,'searching');
    assert.equal(states[0].dispatchEvent.new.event_type,'mission.offer.declined');
  });

  it('couvre customer → mission → mission_offer → réception Provider', async () => {
    const calls=[]; let realtime; let providerState={offers:[]}; const received=[];
    const missionRepository={
      createCurrent:async()=>{calls.push('mission');return{id:'m1',providerId:null};},
      createOffers:async()=>{calls.push('matching+offer');providerState={offers:[{id:'o1',providerId:'p1',status:'pending'}]};return providerState.offers;},
      getById:async()=>({id:'m1',providerId:null,status:'offered'}),getQuoteHistory:async()=>[],getOffers:async()=>providerState.offers,
    };
    const customer=createCustomerMissionSynchronizer({missionRepository,providerRepository:{getById:async()=>null}});
    const providerRepository={source:'supabase',load:async()=>providerState,subscribeDispatch:callback=>{realtime=callback;return()=>{};}};
    const dispatch=createProviderDispatchController({repository:providerRepository,getState:()=>({offers:[]}),onState:()=>{},onOffer:offer=>received.push(offer),scheduleTask:()=>1,clearTask(){}});
    dispatch.start();
    const snapshot=await customer.create({serviceCategory:'electricity'});
    await realtime({eventType:'INSERT',new:{id:'o1'}});
    assert.deepEqual(calls,['mission','matching+offer']);
    assert.equal(snapshot.offers[0].id,'o1');
    assert.equal(received[0].id,'o1');
    dispatch.stop();
  });
});
