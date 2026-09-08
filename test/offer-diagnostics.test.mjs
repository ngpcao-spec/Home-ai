import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readOfferDiagnostics } from '../src/provider/offer-diagnostics.js';

it('distinguishes missing expiration, locally expired offers and missing overlay without exposing customer data',()=>{
  const report=readOfferDiagnostics({document:{querySelector:()=>null,hidden:false,visibilityState:'visible'},source:'supabase',busy:false,buildId:'test',offers:[
    {id:'missing',request:'Private customer description'},
    {id:'past',expiresAt:new Date(Date.now()-60000).toISOString()},
    {id:'future',expiresAt:new Date(Date.now()+60000).toISOString()},
  ]});
  assert.equal(report.offers[0].remainingSeconds,null);
  assert.ok(report.offers[1].remainingSeconds<0);
  assert.ok(report.offers[2].remainingSeconds>0);
  assert.equal(report.overlay,null);
  assert.ok(!JSON.stringify(report).includes('Private customer'));
});
