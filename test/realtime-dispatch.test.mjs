import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviderDispatchController, renderIncomingOffer } from '../src/provider/provider-dispatch.js';
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
    assert.match(renderIncomingOffer(received[0],0),/Chấp nhận/);
    assert.match(renderIncomingOffer(received[0],0),/Từ chối/);
    controller.stop();
  });

  it('déclenche la RPC serveur au timeout, jamais une décision locale', async () => {
    let state={offers:[{id:'o1',expiresAt:new Date(1000).toISOString()}]}; const tasks=[]; const expired=[];
    const repository={source:'supabase',subscribeDispatch(){return()=>{};},async load(){return state;},
      async expire(id){expired.push(id);state={offers:[]};return state;}};
    const controller=createProviderDispatchController({repository,getState:()=>state,onState:next=>{state=next;},
      scheduleTask:(task,delay)=>{tasks.push({task,delay});return tasks.length;},clearTask(){},now:()=>0});
    controller.start();
    assert.equal(tasks[0].delay,1050);
    await tasks[0].task();
    assert.deepEqual(expired,['o1']);
    controller.stop();
  });

  it('abonne provider et client avec des filtres RLS sans service_role', () => {
    const channels=[]; const client={rpc(){},from(){return{};},channel(name){const registrations=[];const channel={name,on(...args){registrations.push(args);return channel;},subscribe(){return channel;},registrations};channels.push(channel);return channel;},removeChannel(){}};
    const offers=createSupabaseOffersRepository(client);
    const missions=createSupabaseMissionsRepository(client);
    offers.subscribeProviderDispatch('p1',()=>{});
    missions.subscribeMission('m1',()=>{});
    assert.match(channels[0].registrations[0][1].filter,/provider_id=eq.p1/);
    assert.match(channels[1].registrations[0][1].filter,/id=eq.m1/);
    assert.match(channels[1].registrations[1][1].filter,/mission_id=eq.m1/);
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
});
