import assert from 'node:assert/strict';
import { it } from 'node:test';
import { prepareSupabaseTracking } from '../src/tracking/supabase-tracking.js';
import { updateTrackingPresentation } from '../src/tracking/tracking-sheet.js';
import { createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createProviderLocationHeartbeat } from '../src/provider/provider-location-heartbeat.js';

const snapshot = () => ({
  mission: { id: 'm1', providerId: 'p1', status: 'travelling', clientLocation: { latitude: 12.2476767550813, longitude: 109.159554676145 } },
  providerLocation: { missionId: 'm1', providerId: 'p1', latitude: 12.2471748242705, longitude: 109.159483112991, recordedAt: '2026-09-07T09:28:51Z' },
});

it('renders real 56m and identical GPS without Amazon routing or fabricated arrival', async () => {
  for (const identical of [false, true]) {
    const state = snapshot();
    if (identical) Object.assign(state.providerLocation, state.mission.clientLocation);
    const result = await prepareSupabaseTracking(state, { get() { throw new Error('Must not request route'); } });
    assert.equal(result.route, null);
    assert.equal(result.position.near, true);
    assert.equal(result.position.arrived, false);
    assert.ok(result.position.remainingDistanceKm < 0.1);
    assert.equal(result.origin.latitude, state.providerLocation.latitude);
    const elements = new Map();
    const container = { querySelector(key) { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); } };
    updateTrackingPresentation(container, result.position);
    assert.equal(elements.get('[data-tracking-eta]').textContent, '< 1 phút');
    assert.equal(elements.get('[data-tracking-distance]').textContent, '< 0.1 km');
  }
});

it('uses Amazon geometry and metrics for a normal route and refuses demo routes', async () => {
  const state = snapshot(); state.providerLocation.latitude += 0.02;
  const route = { source: 'amazon-location', distanceKm: 3, durationMinutes: 8, points: [state.providerLocation, state.mission.clientLocation] };
  const result = await prepareSupabaseTracking(state, { get: async (origin, destination) => {
    assert.equal(origin, state.providerLocation); assert.equal(destination, state.mission.clientLocation); return route;
  } });
  assert.equal(result.position.etaMinutes, 8);
  assert.equal(result.position.remainingDistanceKm, 3);
  await assert.rejects(prepareSupabaseTracking(state, { get: async () => ({ ...route, source: 'demo' }) }), /Route unavailable/);
});

it('rejects missing, invalid or unrelated GPS without simulation', async () => {
  for (const patch of [{ providerId: 'other' }, { missionId: 'other' }, { latitude: null }, { latitude: NaN }, { recordedAt: null }]) {
    const state = snapshot(); Object.assign(state.providerLocation, patch);
    await assert.rejects(prepareSupabaseTracking(state, { get() { assert.fail('Unexpected routing'); } }), /GPS unavailable/);
  }
});

it('queries GPS only for the assigned provider and mission under the caller RLS', async () => {
  const filters = [];
  const client = { rpc() {}, from(table) { assert.equal(table, 'provider_status'); return {
    select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
    maybeSingle: async () => ({ data: { provider_id: 'p1', current_mission_id: 'm1', last_latitude: 12, last_longitude: 109, last_location_at: '2026-09-07T09:28:51Z' }, error: null }),
  }; } };
  const repo = createSupabaseMissionsRepository(client);
  assert.equal((await repo.getAssignedProviderLocation(snapshot().mission)).providerId, 'p1');
  assert.deepEqual(filters, [['provider_id', 'p1'], ['current_mission_id', 'm1']]);
});

it('refreshes assigned GPS via realtime and polling fallback', async () => {
  const state = snapshot(); let realtime; let tick; const updates = [];
  const sync = createCustomerMissionSynchronizer({ missionRepository: {
    getById: async () => state.mission, getQuoteHistory: async () => [],
    getAssignedProviderLocation: async () => ({ ...state.providerLocation }),
    subscribeMission: (id, callback) => { realtime = callback; return () => {}; },
  }, providerRepository: { getById: async () => ({ id: 'p1' }) }, scheduleTask: callback => { tick = callback; return 1; }, clearTask() {} });
  const stop = sync.subscribe('m1', value => updates.push(value), assert.fail);
  const stopPolling = sync.poll('m1', value => updates.push(value), assert.fail);
  await realtime({ table: 'provider_status' });
  state.providerLocation.latitude += 0.001;
  await tick();
  assert.equal(updates.length, 2);
  assert.notEqual(updates[0].providerLocation.latitude, updates[1].providerLocation.latitude);
  stop(); stopPolling();
});

it('keeps sending actual device GPS during an assigned mission without making provider available', async () => {
  const writes = [];
  const heartbeat = createProviderLocationHeartbeat({ repository: { source: 'supabase', updateLocation: async value => { writes.push(value); return {}; } },
    getState: () => ({ status: { online: true, available: false }, assignment: { id: 'm1' } }),
    geolocation: { getCurrentPosition: success => success({ coords: { latitude: 12.2, longitude: 109.1 } }) },
    scheduleTask: () => 1, clearTask() {},
  });
  await heartbeat.refresh(); heartbeat.stop();
  assert.deepEqual(writes, [{ latitude: 12.2, longitude: 109.1 }]);
});
