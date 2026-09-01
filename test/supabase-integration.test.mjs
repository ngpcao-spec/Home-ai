import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptMatchingProviderRow, adaptMissionRow, adaptProfileRow, adaptProviderRow } from '../src/supabase/adapters.js';
import { createSupabaseBrowserClient } from '../src/supabase/client.js';
import { readSupabaseConfig } from '../src/supabase/config.js';
import { createOptionalSupabaseRepositories } from '../src/supabase/repositories/index.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createSupabaseProfilesRepository } from '../src/supabase/repositories/profiles.js';
import { createSupabaseCustomerAddressesRepository } from '../src/supabase/repositories/customer-addresses.js';

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
      addresses: null,
      missions: null,
      providers: null,
      offers: null,
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
    const candidate = adaptMatchingProviderRow({
      provider_id: 'p1', display_name: 'Phạm Lan', specialty: 'Plomberie',
      service_category: 'plumbing', base_price: 150000, currency: 'VND',
      service_radius_km: '10', rating_average: '4.9', review_count: 20,
      completed_jobs: 30, reliability_score: '98', latitude: 12.24,
      longitude: 109.19, last_location_at: '2026-09-01T00:00:00Z',
      straight_line_distance_km: '1.25',
    });
    assert.equal(candidate.category, 'plumbing');
    assert.equal(candidate.distanceKm, 1.25);
    assert.equal(candidate.online, true);
  });

  it('demande la présélection et la création des offres uniquement via RPC', async () => {
    const calls = [];
    const client = {
      from() { return {}; },
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({ data: name.startsWith('get_matching') ? [] : [{ id: 'o1' }], error: null });
      },
    };
    const repositories = {
      providers: (await import('../src/supabase/repositories/providers.js')).createSupabaseProvidersRepository(client),
      missions: createSupabaseMissionsRepository(client),
    };
    await repositories.providers.listMatchingCandidates({
      serviceCategory: 'plumbing', latitude: 12.24, longitude: 109.19,
    });
    await repositories.missions.createOffers('m1');
    assert.deepEqual(calls.map(([name]) => name), [
      'get_matching_provider_candidates', 'create_current_customer_mission_offers',
    ]);
    assert.equal(calls.some(([, args]) => 'provider_id' in args), false);
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

  it('écrit le profil uniquement via la RPC customer sans rôle ni user_id contrôlable', async () => {
    const calls = [];
    const repository = createSupabaseProfilesRepository({
      from() { return {}; },
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({ data: { user_id: 'u1', role: 'customer', display_name: 'Minh', status: 'active' }, error: null });
      },
    });
    const saved = await repository.saveCurrent({ name: 'Minh', phone: '+84912345678', avatarUrl: null });
    assert.equal(saved.role, 'customer');
    assert.deepEqual(calls[0], ['upsert_current_customer_profile', {
      new_display_name: 'Minh', new_phone: '+84912345678', new_avatar_url: null,
    }]);
    assert.equal('role' in calls[0][1], false);
    assert.equal('user_id' in calls[0][1], false);
  });

  it('persiste les adresses via les RPC liées à auth.uid()', async () => {
    const calls = [];
    const repository = createSupabaseCustomerAddressesRepository({
      from() { return {}; },
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({ data: name.startsWith('delete_') ? null : {
          id: 'a1', label: 'Nhà', address_text: 'Nha Trang', is_default: true,
        }, error: null });
      },
    });
    await repository.save({ label: 'Nhà', address: 'Nha Trang', isDefault: true });
    await repository.setDefault('a1');
    await repository.delete('a1');
    assert.deepEqual(calls.map(([name]) => name), [
      'save_current_customer_address',
      'set_current_customer_default_address',
      'delete_current_customer_address',
    ]);
    assert.equal(calls.some(([, args]) => 'customer_id' in args), false);
  });
});
