import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { connectSupabaseCustomerMissions, createCustomerMissionDraft } from '../src/customer/supabase-mission.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';

const runtime = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

describe('missions client Supabase', () => {
  it('construit les données essentielles sans provider ni statut contrôlé par le navigateur', () => {
    const draft = createCustomerMissionDraft({
      diagnosis: { summary: 'Điều hòa không lạnh' },
      problemDescription: 'Máy lạnh không hoạt động',
      serviceCategory: 'air-conditioning', address: 'Nha Trang',
      location: { latitude: 12.24, longitude: 109.19 }, scheduledFor: null,
    });
    assert.equal(draft.problemDescription, 'Máy lạnh không hoạt động');
    assert.equal(draft.clientLocation.longitude, 109.19);
    assert.equal('providerId' in draft, false);
    assert.equal('status' in draft, false);
  });

  it('reste en fallback mock sans session Supabase', async () => {
    const result = await connectSupabaseCustomerMissions({
      runtimeConfig: runtime,
      repositoryLoader: async () => ({ profiles: { getCurrentUserId: async () => null } }),
    });
    assert.equal(result.source, 'mock');
    assert.equal(result.reason, 'no-session');
  });

  it('lit la mission active avant toute création', async () => {
    const activeMission = { id: 'm1', status: 'searching' };
    const repository = { getActiveCurrent: async () => activeMission };
    const result = await connectSupabaseCustomerMissions({
      runtimeConfig: runtime,
      repositoryLoader: async () => ({
        profiles: { getCurrentUserId: async () => 'customer-1' }, missions: repository,
      }),
    });
    assert.equal(result.source, 'supabase');
    assert.equal(result.activeMission, activeMission);
    assert.equal(result.repository, repository);
  });

  it('utilise uniquement les RPC server-owned pour créer et annuler', async () => {
    const calls = [];
    const client = {
      from() { return {}; },
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({ data: {
          id: 'm1', client_id: 'c1', provider_id: null, service_category: 'hvac',
          problem_description: 'Test', address_text: 'Nha Trang', client_latitude: 12.24,
          client_longitude: 109.19, status: name.startsWith('cancel_') ? 'cancelled' : 'searching',
          version: name.startsWith('cancel_') ? 2 : 1, currency: 'VND', payment_status: 'unpaid',
          requested_at: '2026-09-01T00:00:00Z',
        }, error: null });
      },
    };
    const repository = createSupabaseMissionsRepository(client);
    const mission = await repository.createCurrent({
      serviceCategory: 'hvac', problemDescription: 'Test', diagnosticSummary: 'HVAC',
      address: 'Nha Trang', clientLocation: { latitude: 12.24, longitude: 109.19 },
    });
    await repository.cancelCurrent(mission);
    assert.deepEqual(calls.map(([name]) => name), ['create_current_customer_mission', 'cancel_current_customer_mission']);
    assert.equal('client_id' in calls[0][1], false);
    assert.equal('provider_id' in calls[0][1], false);
    assert.equal('status' in calls[0][1], false);
  });
});
