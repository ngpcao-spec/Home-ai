import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';

describe('mission completion repositories', () => {
  it('uses RPCs for payment, review and history', async () => {
    const calls=[]; const client={ rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_current_user_mission_history'?[]:{id:'m1',version:3,client_latitude:1,client_longitude:2},error:null};},from(){throw new Error('not used');} };
    const repo=createSupabaseMissionsRepository(client);
    await repo.completeExternalPayment({id:'m1',version:2}); await repo.createReview('m1',5,'Tốt'); await repo.getCurrentUserHistory();
    assert.deepEqual(calls.map(([name])=>name),['complete_current_customer_external_payment','create_current_customer_review','get_current_user_mission_history']);
    assert.equal(calls[0][1].expected_version,2);
  });

  it('keeps the provider demo fallback and requires acceptance before work', async () => {
    const repo=createMockProviderAppRepository({provider:{name:'P'},status:{online:true,available:false},offers:[],assignment:{id:'m1',status:'quote_pending',quote:{status:'pending'}}});
    await assert.rejects(()=>repo.startIntervention('m1'));
    const accepted=createMockProviderAppRepository({provider:{name:'P'},status:{online:true,available:false},offers:[],assignment:{id:'m1',status:'quote_pending',quote:{status:'accepted'}}});
    assert.equal((await accepted.startIntervention('m1')).assignment.status,'in_progress');
    assert.equal((await accepted.finishIntervention('m1')).assignment.status,'completed_pending_payment');
  });
});
