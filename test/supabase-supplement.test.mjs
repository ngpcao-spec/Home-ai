import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { createCustomerMissionStateFromServer, createCustomerMissionSynchronizer, decidePendingCustomerSupplement } from '../src/customer/supabase-mission.js';
import { createInterventionProgressMarkup } from '../src/tracking/tracking-sheet.js';
import { renderProviderDashboard } from '../src/provider/provider-app.js';

const v1 = { id:'q1', version:1, type:'initial', status:'accepted', totalAmount:290000, warrantyDays:30, recommendedTasks:['Repair'], items:[] };
const v2 = { id:'q2', missionId:'m1', parentQuoteId:'q1', version:2, type:'supplement', status:'supplement_pending', totalAmount:390000, finding:'Extra', items:[{type:'part',amount:80000},{type:'labor',amount:20000}] };

it('creates a cumulative pending proposal through the assigned-provider RPC without editing V1', async()=>{
  const before=structuredClone(v1);let call;
  const repo=createSupabaseOffersRepository({from(){},rpc:async(name,args)=>{call={name,args};return {data:v2};}});
  await repo.createCurrentProviderSupplement('m1',v1,{finding:'Extra',additionalPartsAmount:80000,additionalLaborAmount:20000});
  assert.equal(call.name,'create_current_provider_quote_version');
  assert.equal(call.args.target_parent_quote_id,'q1');
  assert.equal(call.args.new_items.reduce((s,i)=>s+i.amount,0),390000);
  assert.equal('status' in call.args,false);
  assert.deepEqual(v1,before);
  await assert.rejects(repo.createCurrentProviderSupplement('m1',v2,{}),/Accepted parent/);
});
for(const status of ['supplement_pending','accepted','rejected']){
  it('renders real supplement '+status+' with the authorized total and explicit decisions',()=>{
    const state=createCustomerMissionStateFromServer({mission:{status:status==='supplement_pending'?'supplement_pending':'in_progress'},quotes:[v1,{...v2,status}]});
    assert.equal(state.interventionPhase,'repairing');
    const html=createInterventionProgressMarkup(state);
    assert.doesNotMatch(html,/NaN|undefined|data-discover-supplement|data-complete-repair/);
    assert.equal(html.includes('data-supplement-quote-decision'),status==='supplement_pending');
    assert.ok(html.includes('Giá được phép thực hiện</dt><dd>'+new Intl.NumberFormat('vi-VN').format(status==='accepted'?390000:290000)+'đ'));
  });
}
it('keeps the demo discovery out of the real customer screen and exposes it to the provider',()=>{
  const state=createCustomerMissionStateFromServer({mission:{status:'in_progress'},quotes:[v1]});
  assert.doesNotMatch(createInterventionProgressMarkup(state),/data-discover-supplement/);
  assert.match(renderProviderDashboard({status:{online:true},assignment:{status:'in_progress',quote:v1}}),/data-provider-supplement/);
  assert.doesNotMatch(renderProviderDashboard({status:{online:true},assignment:{status:'supplement_pending',quote:v2}}),/data-finish-intervention|data-provider-supplement/);
});
it('customer decision uses the existing RPC and reloads authoritative state',async()=>{
  const calls=[];
  const sync=createCustomerMissionSynchronizer({missionRepository:{
    decideCurrentQuote:async(id,decision)=>{calls.push([id,decision]);return {missionId:'m1'};},
    getById:async()=>({id:'m1',status:'in_progress'}),
    getQuoteHistory:async()=>[v1,{...v2,status:'accepted'}],
  },providerRepository:{}});
  const snapshot=await sync.decideQuote('q2','accepted');
  assert.deepEqual(calls,[['q2','accepted']]);
  assert.equal(snapshot.quotes[1].status,'accepted');
});

for (const [uiDecision, rpcDecision, finalStatus, authorizedAmount] of [
  ['accepted', 'accepted', 'accepted', 390000],
  ['rejected', 'declined', 'rejected', 290000],
]) {
  it(`routes V2 ${uiDecision} to the existing RPC and preserves V1`, async () => {
    const before = structuredClone(v1);
    const calls = [];
    const finalV2 = { ...v2, status: finalStatus };
    const synchronizer = {
      decideQuote: async (quoteId, decision) => {
        calls.push({ quoteId, decision });
        return { mission: { id: 'm1', status: 'in_progress', finalAuthorizedAmount: authorizedAmount }, quotes: [v1, finalV2] };
      },
    };
    const result = await decidePendingCustomerSupplement(
      { mission: { id: 'm1' }, quotes: [v1, v2] }, uiDecision, synchronizer,
    );
    assert.deepEqual(calls, [{ quoteId: 'q2', decision: rpcDecision }]);
    assert.equal(result.quotes[1].status, finalStatus);
    assert.equal(result.mission.finalAuthorizedAmount, authorizedAmount);
    assert.deepEqual(v1, before);
  });
}

it('never decides an unrelated or no-longer-pending supplement', async () => {
  const synchronizer = { decideQuote: () => assert.fail('Unexpected RPC') };
  await assert.rejects(decidePendingCustomerSupplement(
    { mission: { id: 'm1' }, quotes: [{ ...v2, missionId: 'other' }] }, 'accepted', synchronizer,
  ), /unavailable/);
  await assert.rejects(decidePendingCustomerSupplement(
    { mission: { id: 'm1' }, quotes: [{ ...v2, status: 'accepted' }] }, 'rejected', synchronizer,
  ), /unavailable/);
});

it('handles the Supabase V2 action before the remote-mode guard', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const decision = source.indexOf("const remoteSupplementDecision = event.target.closest('[data-supplement-quote-decision]')");
  const guard = source.indexOf('if (remoteMissionState) return;', decision);
  assert.ok(decision >= 0 && guard > decision);
  assert.match(source.slice(decision, guard), /supplementDecisionPending[\s\S]*decidePendingCustomerSupplement/);
});
