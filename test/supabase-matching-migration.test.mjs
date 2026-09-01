import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260901000500_provider_matching_and_offers.sql', import.meta.url);
const securityTestUrl = new URL('../supabase/tests/005_provider_matching_security.sql', import.meta.url);
const concurrencyTestUrl = new URL('../supabase/tests/006_offer_acceptance_concurrency.sql', import.meta.url);

describe('contrat SQL matching et offres', () => {
  it('garde les trois opérations sensibles derrière des RPC SECURITY DEFINER verrouillées', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const rpc of [
      'get_matching_provider_candidates',
      'create_current_customer_mission_offers',
      'accept_current_provider_offer',
    ]) {
      assert.match(sql, new RegExp(`function public\\.${rpc}\\(`));
    }
    assert.equal((sql.match(/security definer/g) ?? []).length, 3);
    assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 4);
    assert.equal((sql.match(/grant execute on function public\./g) ?? []).length, 3);
    assert.equal((sql.match(/from public, anon;/g) ?? []).length, 3);
    assert.doesNotMatch(sql, /service_role/);
  });

  it('filtre l’éligibilité avant RouteMatrix et impose un classement déterministe', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const predicate of [
      "ps.service_category = trim(requested_service_category)",
      "pp.kyc_status = 'verified'", 'pp.active', 'pst.online', 'pst.available',
      'pst.last_location_at >=', 'e.distance_km <= e.service_radius_km',
    ]) assert.ok(sql.includes(predicate), `missing eligibility predicate: ${predicate}`);
    assert.match(sql, /order by e\.distance_km,[\s\S]*e\.provider_id/);
  });

  it('fournit des tests SQL dédiés à RLS et à une course multi-session', async () => {
    const [migration, security, concurrency] = await Promise.all([
      readFile(migrationUrl, 'utf8'), readFile(securityTestUrl, 'utf8'), readFile(concurrencyTestUrl, 'utf8'),
    ]);
    const missionLock = migration.indexOf('where id = offer_row.mission_id for update');
    const offerLock = migration.indexOf('where id = target_offer_id for update');
    assert.ok(missionLock >= 0 && offerLock > missionLock, 'mission must be locked before the competing offer');
    assert.match(security, /RLS is not enabled on all 14 public tables/);
    assert.match(security, /Direct offer insert bypassed RPC ownership/);
    assert.match(concurrency, /dblink_send_query\('offer_one'/);
    assert.match(concurrency, /dblink_send_query\('offer_two'/);
    assert.match(concurrency, /status='accepted'\) <> 1/);
  });
});
