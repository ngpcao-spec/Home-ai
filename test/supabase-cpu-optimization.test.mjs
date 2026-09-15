import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';
import { createProviderDispatchController } from '../src/provider/provider-dispatch.js';

test('a provider_status event reloads only GPS instead of mission, offers, quotes and invoice',async()=>{
  const calls={mission:0,quotes:0,offers:0,gps:0,review:0,invoice:0};let receive;
  const mission={id:'m1',providerId:'p1',status:'travelling'};
  const repository={
    getById:async()=>{calls.mission++;return mission;},getQuoteHistory:async()=>{calls.quotes++;return[];},
    getOffers:async()=>{calls.offers++;return[];},getAssignedProviderLocation:async()=>{calls.gps++;return{latitude:12,longitude:109};},
    getReview:async()=>{calls.review++;return null;},getInvoice:async()=>{calls.invoice++;return null;},
    subscribeMission:(_id,handler)=>{receive=handler;return()=>{};},
  };
  const sync=createCustomerMissionSynchronizer({missionRepository:repository,providerRepository:{getById:async()=>({id:'p1'})}});
  await sync.load('m1');const baseline={...calls};
  let snapshot;sync.subscribe('m1',next=>{snapshot=next;},assert.fail);
  await receive({table:'provider_status'});
  assert.equal(snapshot.providerLocation.latitude,12);
  assert.deepEqual(calls,{...baseline,gps:baseline.gps+1});
});

test('Provider creates one scoped subscription, pauses in background and refreshes once in foreground',async()=>{
  let state={offers:[],assignment:{id:'m1',status:'travelling'}};let subscriptions=0;let removals=0;let loads=0;
  const repository={source:'supabase',subscribeDispatch(missionId,_receive){assert.equal(missionId,'m1');subscriptions++;return()=>{removals++;};},load:async()=>{loads++;return state;}};
  const controller=createProviderDispatchController({repository,getState:()=>state,onState:next=>{state=next;},isPageActive:()=>true});
  controller.start();controller.setActive(false);controller.setActive(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(subscriptions,2);assert.equal(removals,1);assert.equal(loads,1);
  controller.stop();assert.equal(removals,2);
});

test('SQL migrations remove recursive missions RLS and preserve the six required Realtime tables',()=>{
  const missions=readFileSync('supabase/migrations/20260915051541_optimize_missions_rls.sql','utf8');
  const realtime=readFileSync('supabase/migrations/20260915051559_optimize_realtime_rls.sql','utf8');
  assert.doesNotMatch(missions,/using\s*\(private\.is_mission_participant\(id\)\)/i);
  assert.match(missions,/client_id = \(select auth\.uid\(\)\)/);
  assert.match(missions,/provider_id = \(select auth\.uid\(\)\)/);
  assert.match(realtime,/mission_messages_participants[\s\S]*\(select auth\.uid\(\)\)/);
  const publication=readFileSync('supabase/migrations/20260903001000_realtime_provider_dispatch.sql','utf8')
    +readFileSync('supabase/migrations/20260911120000_mission_calls_foundation.sql','utf8')
    +readFileSync('supabase/migrations/20260913090000_mission_messages.sql','utf8');
  for(const table of ['missions','mission_offers','mission_events','mission_calls','mission_messages'])assert.match(publication,new RegExp(table));
});
