import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = new URL('../supabase/migrations/20260902000700_provider_mission_navigation.sql', import.meta.url);
describe('audit sécurité de la navigation provider', () => {
  it('lie la RPC au provider authentifié, actif et KYC vérifié', async () => {
    const sql=await readFile(migration,'utf8');
    assert.match(sql,/auth\.uid\(\)/); assert.match(sql,/profile_has_role\(uid,'provider'\)/);
    assert.equal((sql.match(/pp\.active and pp\.kyc_status='verified'/g)??[]).length,2);
    assert.doesNotMatch(sql,/service_role/);
  });
  it('verrouille la mission assignée et limite strictement les transitions', async () => {
    const sql=await readFile(migration,'utf8');
    assert.match(sql,/where id=target_mission_id for update/);
    assert.match(sql,/mission_row\.provider_id is distinct from uid/);
    assert.match(sql,/status='accepted' and new_status='travelling'/);
    assert.match(sql,/status='travelling' and new_status='arrived'/);
    assert.match(sql,/distance_km>0\.15/);
  });
  it('réserve adresse et coordonnées client à la sous-requête de mission assignée', async () => {
    const sql=await readFile(migration,'utf8');
    assert.equal((sql.match(/m\.address_text/g)??[]).length,1);
    assert.match(sql,/from public\.missions m where m\.provider_id=uid/);
    assert.match(sql,/'approximateAddress','Khu vực Nha Trang'/);
  });
  it('utilise SECURITY DEFINER avec search_path vide et refuse anon PUBLIC', async () => {
    const sql=await readFile(migration,'utf8');
    assert.equal((sql.match(/security definer set search_path = ''/g)??[]).length,2);
    assert.equal((sql.match(/from public,anon/g)??[]).length,2);
    assert.equal((sql.match(/to authenticated/g)??[]).length,2);
  });
});
