import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { readSupplementForm } from '../src/provider/supplement-form.js';

it('opens without RPC, retains inputs through refresh and failure, then explicitly sends custom amounts once',async()=>{
  const handlers={};let nodes={};let heartbeat;let refresh;let writes=0;let fail=true;let sent;
  let state={status:{online:true},offers:[],assignment:{id:'m1',status:'in_progress',quote:{id:'q1',status:'accepted',version:1,totalAmount:200000,warrantyDays:30}}};
  const initial=structuredClone(state.assignment.quote);
  const root={set innerHTML(html){
    nodes={};
    if(html.includes('data-supplement-form')){
      for(const name of ['reason','labor','parts','warranty','total'])nodes['[data-supplement-'+name+']']={value:'',textContent:''};
      for(const name of ['supplement-form','send-supplement','cancel-supplement'])nodes['[data-'+name+']']={};
    }
  },querySelector:key=>nodes[key]??null,addEventListener:(key,fn)=>handlers[key]=fn};
  const repo={source:'supabase',load:async()=>structuredClone(state),updateLocation:async()=>structuredClone(state),
    subscribeDispatch:fn=>{refresh=fn;return()=>{};},
    createSupplement:async(id,draft)=>{writes++;sent={id,draft};if(fail)throw Error('offline');state={...state,assignment:{...state.assignment,status:'supplement_pending',quote:{status:'supplement_pending',version:2}}};return state;}};
  const app=await initialiseProviderApp(root,async()=>repo,async()=>null,{enabled:false,getSession:async()=>null},
    opts=>{heartbeat=opts;return{sync(){},stop(){}};},
    {getState:async()=>'granted',request:async()=>({latitude:12,longitude:109})});
  const click=key=>handlers.click({target:{closest:s=>s===key?{}:null}});
  try{
    await click('[data-provider-supplement]');
    assert.equal(writes,0);
    const originalNodes=nodes;
    assert.equal(nodes['[data-supplement-labor]'].value,'');
    nodes['[data-supplement-reason]'].value='Thay bộ phận bị hỏng';
    nodes['[data-supplement-labor]'].value='37000';
    nodes['[data-supplement-parts]'].value='64000';
    nodes['[data-supplement-warranty]'].value='45';
    handlers.input();
    assert.match(nodes['[data-supplement-total]'].textContent,/301.000/);
    await refresh();await heartbeat.onState(structuredClone(state));await heartbeat.onError();
    assert.equal(nodes,originalNodes);
    await click('[data-send-supplement]');
    assert.equal(nodes,originalNodes);
    assert.equal(nodes['[data-supplement-reason]'].value,'Thay bộ phận bị hỏng');
    fail=false;
    const sending=click('[data-send-supplement]');
    await click('[data-send-supplement]');
    await sending;
    assert.equal(writes,2);
    assert.deepEqual(sent,{id:'m1',draft:{finding:'Thay bộ phận bị hỏng',additionalLaborAmount:37000,additionalPartsAmount:64000,warrantyDays:45,parentQuoteId:'q1'}});
    assert.deepEqual(initial,{id:'q1',status:'accepted',version:1,totalAmount:200000,warrantyDays:30});
    assert.equal(app.getState().assignment.status,'supplement_pending');
  }finally{app.stop();}
});
it('validates amounts and inherits warranty only when omitted',()=>{
  const values={reason:'Reason',labor:'-1',parts:'20',warranty:''};
  const root={querySelector:key=>({value:values[key.match(/supplement-(\w+)/)[1]]})};
  assert.equal(readSupplementForm(root,{id:'q1',totalAmount:100,warrantyDays:60}).valid,false);
  values.labor='13';
  const result=readSupplementForm(root,{id:'q1',totalAmount:100,warrantyDays:60});
  assert.equal(result.total,133);assert.equal(result.draft.warrantyDays,60);assert.equal(result.valid,true);
  values.parts='1.5';assert.equal(readSupplementForm(root,{totalAmount:100,warrantyDays:60}).valid,false);
});
