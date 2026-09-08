import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseProviderApp } from '../src/provider/provider-app.js';

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
