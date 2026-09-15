import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20260915123000_v1_provider_without_kyc.sql',import.meta.url);

test('V1 garde KYC installé mais le retire de tous les contrôles opérationnels',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  const operationalFunctions=[
    'dispatch_next_mission_offer','accept_current_provider_offer','decline_current_provider_offer',
    'create_current_provider_activity','create_current_provider_quote_version',
    'finish_current_provider_intervention','get_current_provider_dashboard',
    'get_current_provider_hourly_rate_reference','get_current_provider_quote_state',
    'get_matching_provider_candidates','set_current_provider_availability',
    'set_current_provider_service_hourly_pricing','start_current_provider_intervention',
    'submit_current_provider_hourly_invoice','update_current_provider_activity',
    'update_current_provider_location','update_current_provider_mission_progress',
  ];
  for(const name of operationalFunctions){
    const start=sql.search(new RegExp(`function (?:private|public)\\.${name}\\(`,'i'));
    assert.ok(start>=0,`missing ${name}`);
    const nextComment=sql.indexOf('\n-- V1 removes',start+1);
    const next=nextComment<0?sql.length:nextComment;
    const body=sql.slice(start,next);
    assert.doesNotMatch(body,/kyc_status\s*(?:=|<>)\s*'verified'/i,`${name} still gates KYC`);
  }
  assert.match(sql,/'verified',pp\.kyc_status='verified'/);
  assert.match(sql,/private\.provider_v1_onboarding_complete/);
  assert.match(sql,/Provider onboarding is incomplete/);
});

test('le frontend V1 ne filtre plus le matching et ne montre pas le parcours CCCD',async()=>{
  const [matching,providers,onboarding,app,kyc]=await Promise.all([
    readFile(new URL('../src/technicians/matching.js',import.meta.url),'utf8'),
    readFile(new URL('../src/supabase/repositories/providers.js',import.meta.url),'utf8'),
    readFile(new URL('../src/provider/provider-onboarding.js',import.meta.url),'utf8'),
    readFile(new URL('../src/provider/provider-app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/provider/provider-kyc.js',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(matching,/\.verified\s*!==\s*true/);
  assert.doesNotMatch(providers,/\.eq\(['"]kyc_status['"],\s*['"]verified['"]\)/);
  assert.doesNotMatch(onboarding,/kyc-review|data-open-provider-kyc/);
  assert.doesNotMatch(app,/kycRequired|data-open-provider-kyc/);
  assert.match(kyc,/data-provider-kyc/);
});

test('la checklist V2 documente la réactivation de KYC et du téléphone',async()=>{
  const doc=await readFile(new URL('../docs/provider-v2-identity-reactivation.md',import.meta.url),'utf8');
  assert.match(doc,/KYC/i);assert.match(doc,/phone ownership verification/i);assert.match(doc,/centralized backend eligibility predicate/i);
});
