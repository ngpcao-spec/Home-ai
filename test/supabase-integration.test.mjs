import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptMissionRow, adaptProfileRow, adaptProviderRow } from '../src/supabase/adapters.js';
import { createSupabaseBrowserClient } from '../src/supabase/client.js';
import { readSupabaseConfig } from '../src/supabase/config.js';
import { createOptionalSupabaseRepositories } from '../src/supabase/repositories/index.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';

const jwt = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ role })}.signature`;
};

describe('configuration Supabase optionnelle', () => {
  it('conserve le fallback mock quand la configuration est absente ou incomplète', () => {
    assert.equal(readSupabaseConfig({}), null);
    assert.equal(readSupabaseConfig({ SUPABASE_URL: 'https://example.supabase.co' }), null);
    assert.deepEqual(createOptionalSupabaseRepositories({}), {
      enabled: false,
      client: null,
      profiles: null,
      missions: null,
      providers: null,
    });
  });

  it('refuse explicitement toute clé service_role côté navigateur', () => {
    assert.throws(() => readSupabaseConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: jwt('service_role'),
    }), /service_role/);
    assert.throws(() => readSupabaseConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'sb_secret_never-in-browser',
    }), /service_role/);
  });

  it('crée un client central uniquement avec URL HTTPS et clé anon', () => {
    const config = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_ANON_KEY: jwt('anon') };
    assert.deepEqual(readSupabaseConfig(config), {
      url: 'https://example.supabase.co',
      anonKey: config.SUPABASE_ANON_KEY,
    });
    assert.equal(typeof createSupabaseBrowserClient(config).from, 'function');
  });
});

describe('adapters et repositories Supabase préparatoires', () => {
  it('adapte les lignes SQL sans modifier les modèles mock existants', () => {
    assert.equal(adaptProfileRow({ user_id: 'u1', role: 'customer', display_name: 'Minh', status: 'active' }).name, 'Minh');
    assert.equal(adaptMissionRow({
      id: 'm1', client_id: 'u1', provider_id: null, service_category: 'hvac', problem_description: 'Test',
      address_text: 'Nha Trang', client_latitude: 12.24, client_longitude: 109.19, status: 'requested',
      version: 1, currency: 'VND', payment_status: 'unpaid', requested_at: '2026-09-01T00:00:00Z',
    }).clientLocation.longitude, 109.19);
    assert.equal(adaptProviderRow({
      provider_id: 'p1', profiles: { display_name: 'Khoa' }, specialty: 'HVAC', experience_years: 7,
      service_radius_km: '10', rating_average: '4.9', review_count: 10, completed_jobs: 20,
      reliability_score: '98', languages: ['vi'], kyc_status: 'verified', active: true,
    }).verified, true);
  });

  it('exécute le contrat missions via un client injecté et laisse RLS filtrer côté serveur', async () => {
    const rows = [{
      id: 'm1', client_id: 'u1', service_category: 'hvac', problem_description: 'Test', address_text: 'Nha Trang',
      client_latitude: 12.24, client_longitude: 109.19, status: 'requested', version: 1,
      currency: 'VND', payment_status: 'unpaid', requested_at: '2026-09-01T00:00:00Z',
    }];
    const calls = [];
    const query = {
      select(columns) { calls.push(['select', columns]); return this; },
      eq(column, value) { calls.push(['eq', column, value]); return this; },
      order(column, options) { calls.push(['order', column, options]); return Promise.resolve({ data: rows, error: null }); },
    };
    const repository = createSupabaseMissionsRepository({ from(table) { calls.push(['from', table]); return query; } });
    const missions = await repository.listForClient('u1');
    assert.equal(missions[0].id, 'm1');
    assert.deepEqual(calls.find(([name]) => name === 'eq'), ['eq', 'client_id', 'u1']);
  });
});
