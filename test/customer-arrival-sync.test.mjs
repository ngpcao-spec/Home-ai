import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initialiseHomePage } from '../src/app.js';
import { createTrackingStageMarkup, updateTrackingPresentation } from '../src/tracking/tracking-sheet.js';

const peer={id:'p1',name:'Synthetic Provider',category:'electricity',verified:true,rating:5,reviewCount:1,callMission:{id:'m1',status:'arrived'},chatMission:{id:'m1',status:'arrived'}};
const settle=async()=>{for(let i=0;i<18;i++)await new Promise(resolve=>setImmediate(resolve));};
async function application({status='travelling',delayed=false}={}){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});const root=dom.window.document.querySelector('#root');const tasks=[];
  let current={id:'m1',providerId:'p1',status,version:2,serviceCategory:'electricity',problemDescription:'Synthetic',address:'Test',clientLocation:{latitude:12.2,longitude:109.2},paymentStatus:'unpaid'};
  let receive;let routeCalls=0;let finishRoute;
  const gps={latitude:12.22,longitude:109.2,recordedAt:new Date().toISOString(),providerId:'p1',missionId:'m1'};
  const route={source:'amazon-location',distanceKm:2.4,durationMinutes:8,points:[gps,current.clientLocation]};
  const repository={getById:async()=>({...current}),getQuoteHistory:async()=>[],getAssignedProviderLocation:async()=>gps,subscribeMission(_id,callback){receive=callback;return()=>{};}};
  const routing={async route(){routeCalls++;if(delayed)return new Promise(resolve=>{finishRoute=()=>resolve(route);});return route;}};
  initialiseHomePage(root,undefined,undefined,undefined,fn=>{tasks.push(fn);return tasks.length;},undefined,
    ()=>({setClientLocation(){},async render(){},moveProvider(){}}),routing,undefined,undefined,
    async()=>({source:'supabase',activeMission:current,repository,providerRepository:{getProfessionalProfile:async()=>peer}}),
    {resume:async()=>({authenticated:true,session:{user:{id:'customer'}}})});
  await tasks[0]();await settle();
  return {root,dom,tasks,get routeCalls(){return routeCalls;},async realtime(next){current={...current,...next};await receive({table:'missions',new:current});await settle();},async poll(){await tasks.at(-1)();await settle();},finishRoute:async()=>{finishRoute?.();await settle();}};
}
function assertArrived(root){
  const stage=root.querySelector('[data-mission-stage]');
  assert.equal(stage.querySelector('[data-tracking-status]').textContent,'Thợ đã đến');
  assert.match(stage.textContent,/Thợ đã đến địa điểm của bạn\./);
  assert.doesNotMatch(stage.textContent,/Thợ đang đến|Đang tính|Thời gian đến|Quãng đường còn lại/);
  for(const selector of ['[data-tracking-map]','[data-tracking-eta]','[data-tracking-distance]'])assert.equal(stage.querySelector(selector),null);
  assert.ok(stage.querySelector('[data-view-assigned-provider-profile]'));
}
test('Client realtime travelling -> arrived, polling and stale versions preserve arrival',async()=>{
  const app=await application();try{
    assert.equal(app.root.querySelector('[data-tracking-status]').textContent,'Thợ đang đến');
    assert.equal(app.root.querySelector('[data-tracking-eta]').textContent,'8 phút');
    assert.ok(app.root.querySelector('[data-tracking-distance]'));
    await app.realtime({status:'arrived',version:3});assertArrived(app.root);
    const routeCalls=app.routeCalls;await app.poll();assertArrived(app.root);assert.equal(app.routeCalls,routeCalls);
    await app.realtime({status:'travelling',version:2});assertArrived(app.root);
  }finally{app.dom.window.close();}
});
test('reload arrived requires neither GPS nor route and late route cannot restore travelling',async()=>{
  const restored=await application({status:'arrived'});try{assertArrived(restored.root);assert.equal(restored.routeCalls,0);}finally{restored.dom.window.close();}
  const app=await application({delayed:true});try{
    assert.ok(app.root.querySelector('[data-tracking-eta]'));
    await app.realtime({status:'arrived',version:3});assertArrived(app.root);
    await app.finishRoute();assertArrived(app.root);
  }finally{app.dom.window.close();}
});
test('arrival keeps profile/chat/call actions and rejects a stale GPS presentation',()=>{
  const dom=new JSDOM(`<div id="stage">${createTrackingStageMarkup(peer,{missionStatus:'arrived'})}</div>`);const stage=dom.window.document.querySelector('#stage');
  updateTrackingPresentation(stage,{status:'Thợ đang đến',etaMinutes:9,remainingDistanceKm:3});
  assert.equal(stage.querySelector('[data-tracking-status]').textContent,'Thợ đã đến');
  for(const selector of ['[data-mission-chat-open]','[data-mission-call-start]','[data-view-assigned-provider-profile]'])assert.ok(stage.querySelector(selector));
  dom.window.close();
});
test('hourly in_progress without a quote never returns to travelling after realtime or reload',async()=>{
  const app=await application({status:'arrived'});
  try{
    await app.realtime({status:'in_progress',version:4});
    await app.poll();
    const stage=app.root.querySelector('[data-mission-stage]');
    assert.equal(stage.querySelector('[data-tracking-status]').textContent,'Đang sửa chữa');
    assert.doesNotMatch(stage.textContent,/Thợ đang đến|Đang tính|Thời gian đến|Quãng đường còn lại/);
    assert.equal(stage.querySelector('[data-tracking-map]'),null);
    assert.equal(app.routeCalls,0);
  }finally{app.dom.window.close();}
  const restored=await application({status:'in_progress'});
  try{assert.equal(restored.root.querySelector('[data-tracking-status]').textContent,'Đang sửa chữa');assert.equal(restored.routeCalls,0);}
  finally{restored.dom.window.close();}
});
