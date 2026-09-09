import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';

it('a dashboard received through GPS mounts an overlay that survives unchanged dispatch polls and redraws', async () => {
  const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#provider-root');
  let state={provider:{id:'p',name:'Provider'},status:{online:true,available:true},offers:[],assignment:null};
  let heartbeat; let refresh;
  const repository={source:'supabase',load:async()=>structuredClone(state),updateLocation:async()=>structuredClone(state),
    subscribeDispatch(fn){refresh=fn;return()=>{};},
    decline:async()=>{state={...state,offers:[]};return state;}};
  const app=await initialiseProviderApp(root,async()=>repository,undefined,{enabled:true,getSession:async()=>({user:{id:'p'}})},
    options=>{heartbeat=options;return{sync(){},stop(){}};},
    {getState:async()=>'granted',request:async()=>({latitude:12,longitude:109})});
  try {
    state={...state,offers:[{id:'offer',status:'pending',serviceCategory:'electricity',request:'Repair',expiresAt:new Date(Date.now()+60000).toISOString(),distanceKm:1,etaMinutes:3}]};
    await heartbeat.onState(structuredClone(state));
    const overlay=dom.window.document.querySelector('.dispatch-offer');
    assert.ok(overlay,'GPS dashboard must not render only the normal offer card');
    assert.equal(overlay.parentElement.parentElement,dom.window.document.body);
    assert.ok(overlay.querySelector('[data-accept="offer"]'));
    assert.ok(overlay.querySelector('[data-decline="offer"]'));
    assert.ok(overlay.querySelector('[data-dispatch-countdown]'));
    for(let i=0;i<3;i++){
      await refresh();
      await heartbeat.onState(structuredClone(state));
      assert.equal(dom.window.document.querySelector('.dispatch-offer'),overlay,'same overlay node and animation must survive');
    }
    overlay.querySelector('[data-decline]').click();
    for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(dom.window.document.querySelector('.dispatch-offer'),null);
  } finally {app.stop();dom.window.close();}
});

it('opens the accepted mission after one second without waiting for Amazon Location',async()=>{
  const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#provider-root');
  const repository=createMockProviderAppRepository();let finishNavigation;
  const navigationPromise=new Promise(resolve=>{finishNavigation=resolve;});
  const app=await initialiseProviderApp(root,async()=>repository,()=>navigationPromise,{enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}));
  try{
    root.querySelector('[data-accept="offer-demo-1"]').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(dom.window.document.body.textContent,/Đã nhận nhiệm vụ!.*Đang mở chi tiết nhiệm vụ/s);
    await new Promise(resolve=>setTimeout(resolve,1050));
    assert.equal(dom.window.document.querySelector('.mission-accepted-confirmation'),null);
    assert.equal(root.querySelector('.active-mission h1').textContent,'Chi tiết nhiệm vụ');
    assert.ok(root.querySelector('[data-start-travel]'));
    assert.match(root.textContent,/Đang chuẩn bị lộ trình/);
    finishNavigation({map:{setClientLocation(){},async render(){}},route:{distanceKm:1,durationMinutes:4,points:[]},providerLocation:{latitude:12.2,longitude:109.2},destination:{latitude:12.21,longitude:109.21},arrived:false});
    await new Promise(resolve=>setTimeout(resolve,20));
  }finally{app.stop();dom.window.close();}
});
