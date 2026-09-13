import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { arrivalAssessment, confirmProviderArrival } from '../src/provider/provider-arrival.js';
import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';

const destination={latitude:12.2,longitude:109.2};
const location=(extra={})=>({...destination,updatedAt:new Date().toISOString(),source:'browser',...extra});
test('fresh GPS <=150m validates directly; far, missing, stale and fallback require confirmation',()=>{
  assert.equal(arrivalAssessment(location(),destination).confirmationRequired,false);
  assert.equal(arrivalAssessment(location({latitude:12.201}),destination).confirmationRequired,false);
  assert.equal(arrivalAssessment(location({latitude:12.22}),destination).confirmationRequired,true);
  for(const gps of [null,location({source:'fallback'}),location({updatedAt:new Date(Date.now()-180000).toISOString()})]) {
    assert.deepEqual(arrivalAssessment(gps,destination),{location:null,distanceKm:null,confirmationRequired:true});
  }
});
test('confirmation cancel and accept have explicit outcomes without changing GPS',async()=>{
  const dom=new JSDOM('<body></body>');
  for(const accepted of [false,true]){
    const assessment=arrivalAssessment(location({latitude:12.22}),destination);
    const pending=confirmProviderArrival(dom.window.document,assessment);
    assert.match(dom.window.document.querySelector('[role="dialog"]').textContent,/km/);
    dom.window.document.querySelector(accepted?'[data-arrival-confirm]':'[data-arrival-cancel]').click();
    assert.equal(await pending,accepted);
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
  }
  dom.window.close();
});
for(const scenario of ['near','far-confirm','far-cancel','missing','stale'])test(`Provider arrival UI: ${scenario}`,async()=>{
  const base=createMockProviderAppRepository({provider:{id:'p1',name:'Test'},status:{online:true,available:false},offers:[],assignment:{id:'m1',status:'travelling',serviceCategory:'electricity',request:'Test',address:'Test',clientLocation:destination}});
  let writes=0;
  const repository={...base,async updateMissionProgress(...args){writes++;return base.updateMissionProgress(...args);}};
  const dom=new JSDOM('<div id="root"></div>');const root=dom.window.document.querySelector('#root');
  const geolocation=scenario==='missing'?null:{getCurrentPosition(resolve){resolve({coords:{latitude:scenario==='near'?12.2:12.22,longitude:109.2},timestamp:Date.now()-(scenario==='stale'?180000:0)});}};
  const app=await initialiseProviderApp(root,async()=>repository,async()=>{throw new Error('Routing unavailable');},{enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}),{geolocation},{});
  const wait=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate());};
  try{
    assert.equal(root.querySelector('[data-mark-arrived]').disabled,false);
    root.querySelector('[data-mark-arrived]').click();
    if(scenario!=='near'){
      await wait(()=>dom.window.document.querySelector('[data-arrival-confirm]'));
      assert.equal(writes,0);
      if(['missing','stale'].includes(scenario))assert.match(dom.window.document.querySelector('[role="dialog"]').textContent,/Không thể xác nhận vị trí hiện tại/);
      dom.window.document.querySelector(scenario==='far-cancel'?'[data-arrival-cancel]':'[data-arrival-confirm]').click();
    }
    await wait(()=>!root.querySelector('[data-mark-arrived]')||!root.querySelector('[data-mark-arrived]').disabled);
    assert.equal(writes,scenario==='far-cancel'?0:1);
    assert.equal((await base.load()).assignment.status,scenario==='far-cancel'?'travelling':'arrived');
  }finally{app.stop();dom.window.close();}
});
