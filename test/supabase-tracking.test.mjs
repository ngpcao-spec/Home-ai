import assert from 'node:assert/strict';
import { it } from 'node:test';
import { prepareSupabaseTracking, preserveNewestProviderLocation } from '../src/tracking/supabase-tracking.js';
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
  state.providerLocation.latitude += 0.001;
  await realtime({ table: 'provider_status' });
  assert.equal(updates.length, 3);
  assert.notEqual(updates[0].providerLocation.latitude, updates[1].providerLocation.latitude);
  assert.notEqual(updates[1].providerLocation.latitude, updates[2].providerLocation.latitude);
  stop(); stopPolling();
});

it('streams P1, P2 and P3 during travelling, then stops at arrived', async () => {
  const writes = []; const marker = []; const diagnostics = []; let callback; let cleared; let state = { status: { online: true, available: false }, assignment: { id: 'm1', status: 'travelling' } };
  const heartbeat = createProviderLocationHeartbeat({ repository: { source: 'supabase', updateLocation: async value => { writes.push(value); return {}; } },
    getState: () => state,
    geolocation: { watchPosition(success, _error, options) { callback = success; assert.deepEqual(options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); return 7; }, clearWatch(id) { cleared = id; } },
    scheduleTask: () => 1, clearTask() {},
    onPosition: position => marker.push([position.latitude, position.longitude]), onDiagnostic: event => diagnostics.push(event),
  });
  heartbeat.sync();
  await callback({ coords: { latitude: 12.245, longitude: 109.19, accuracy: 8 }, timestamp: 1000 });
  await callback({ coords: { latitude: 12.246, longitude: 109.191, accuracy: 7 }, timestamp: 4000 });
  await callback({ coords: { latitude: 12.247, longitude: 109.192, accuracy: 6 }, timestamp: 7000 });
  assert.deepEqual(writes, [
    { latitude: 12.245, longitude: 109.19 },
    { latitude: 12.246, longitude: 109.191 },
    { latitude: 12.247, longitude: 109.192 },
  ]);
  assert.deepEqual(marker, [[12.245,109.19],[12.246,109.191],[12.247,109.192]]);
  await callback({ coords: { latitude: 1, longitude: 1 }, timestamp: 6000 });
  assert.equal(writes.length, 3);
  assert.equal(diagnostics.find(event => event.outcome === 'rejected')?.reason, 'stale-or-equal-timestamp');
  state = { ...state, assignment: { id: 'm1', status: 'arrived' } };
  heartbeat.sync();
  assert.equal(cleared, 7);
  await callback({ coords: { latitude: 12.248, longitude: 109.193 }, timestamp: 10000 });
  assert.equal(writes.length, 3);
});

it('moves the local marker for every GPS callback but throttles insignificant backend writes', async () => {
  const writes=[];const marker=[];const diagnostics=[];let callback;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async value=>{writes.push(value);return{};}},
    getState:()=>({status:{online:true,available:false},assignment:{id:'m1',status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    minPublishIntervalMs:5000,minPublishDistanceMeters:20,
    onPosition:position=>marker.push(position),onDiagnostic:event=>diagnostics.push(event),
  });
  heartbeat.sync();
  await callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  await callback({coords:{latitude:12.245001,longitude:109.190001},timestamp:11000});
  await callback({coords:{latitude:12.245002,longitude:109.190002},timestamp:12000});
  assert.equal(marker.length,3);
  assert.equal(writes.length,1);
  assert.equal(diagnostics.filter(event=>event.reason==='throttled').length,2);
  heartbeat.stop();
});

it('publishes accumulated five-metre GPS steps against the last successful backend position', async () => {
  const writes=[];const marker=[];const diagnostics=[];let callback;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async value=>{writes.push(value);return{};}},
    getState:()=>({status:{online:true,available:false},assignment:{id:'m1',status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    onPosition:position=>marker.push(position),onDiagnostic:event=>diagnostics.push(event),
  });
  heartbeat.sync();
  for(let step=0;step<=10;step+=1){
    await callback({coords:{latitude:12.245+step*.000045,longitude:109.19,accuracy:5},timestamp:10000+step*1000});
  }
  assert.equal(marker.length,11,'the local marker receives every accepted callback');
  assert.deepEqual(writes.map(value=>value.latitude),[12.245,12.245+4*.000045,12.245+8*.000045]);
  const skipped=diagnostics.filter(event=>event.reason==='throttled');
  assert.equal(skipped.length,8);
  assert.equal(skipped[0].elapsed,1000);
  assert.equal(skipped[1].elapsed,2000,'a skip must not advance lastPublishedAt');
  assert.ok(skipped[1].moved>9&&skipped[1].moved<11,'a skip must not advance lastPublishedPosition');
  assert.equal(skipped[3].elapsed,1000,'success resets the publication baseline');
  heartbeat.stop();
});

it('does not advance the published GPS baseline when a backend write fails', async () => {
  const writes=[];const diagnostics=[];let callback;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async value=>{
      writes.push(value);if(writes.length===1)throw new Error('temporary backend failure');return{};
    }},
    getState:()=>({status:{online:true,available:false},assignment:{id:'m1',status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    onDiagnostic:event=>diagnostics.push(event),onError() {},
  });
  heartbeat.sync();
  await callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  await callback({coords:{latitude:12.245045,longitude:109.19},timestamp:11000});
  await callback({coords:{latitude:12.24509,longitude:109.19},timestamp:12000});
  assert.equal(writes.length,2,'the next callback retries after the failed publication');
  assert.equal(diagnostics.filter(event=>event.outcome==='send-error').length,1);
  assert.equal(diagnostics.filter(event=>event.stage==='backend'&&event.outcome==='accepted').length,1);
  assert.equal(diagnostics.find(event=>event.reason==='throttled')?.elapsed,1000);
  heartbeat.stop();
});

it('throttles callbacks while a GPS write is still queued', async () => {
  const writes=[];let callback;let finishWrite;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:value=>{
      writes.push(value);
      return new Promise(resolve=>{finishWrite=()=>resolve({});});
    }},
    getState:()=>({status:{online:true,available:false},assignment:{id:'m1',status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
  });
  heartbeat.sync();
  const pending=callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  await Promise.resolve();
  await callback({coords:{latitude:12.245045,longitude:109.19},timestamp:11000});
  await callback({coords:{latitude:12.24509,longitude:109.19},timestamp:12000});
  assert.equal(writes.length,1,'frequent callbacks must not create concurrent writes');
  finishWrite();await pending;
  await callback({coords:{latitude:12.245135,longitude:109.19},timestamp:13000});
  assert.equal(writes.length,1,'the successful publication remains the throttle baseline');
  heartbeat.stop();
});

it('never publishes multiple significant GPS moves inside the two-second write floor', async () => {
  const writes=[];const marker=[];let callback;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async value=>{writes.push(value);return{};}},
    getState:()=>({status:{online:true,available:false},assignment:{id:'m1',status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    onPosition:position=>marker.push(position),
  });
  heartbeat.sync();
  await callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  await callback({coords:{latitude:12.246,longitude:109.191},timestamp:10500});
  await callback({coords:{latitude:12.247,longitude:109.192},timestamp:11000});
  assert.equal(marker.length,3);
  assert.equal(writes.length,1);
  heartbeat.stop();
});

it('preserves the newest backend GPS when realtime responses complete out of order', () => {
  const latest = snapshot(); latest.providerLocation.recordedAt = '2026-09-07T09:30:00Z'; latest.providerLocation.latitude = 12.247;
  const stale = snapshot(); stale.providerLocation.recordedAt = '2026-09-07T09:29:00Z'; stale.providerLocation.latitude = 12.245;
  assert.equal(preserveNewestProviderLocation(latest, stale).providerLocation.latitude, 12.247);
  const newer = snapshot(); newer.providerLocation.recordedAt = '2026-09-07T09:31:00Z'; newer.providerLocation.latitude = 12.248;
  assert.equal(preserveNewestProviderLocation(latest, newer).providerLocation.latitude, 12.248);
});

it('restarts watchPosition when a travelling Provider returns to foreground', () => {
  let visible = true; let starts = 0; const cleared = [];
  const heartbeat = createProviderLocationHeartbeat({
    repository: { source: 'supabase', updateLocation: async () => ({}) },
    getState: () => ({ status: { online: true, available: false }, assignment: { id: 'm1', status: 'travelling' } }),
    isPageActive: () => visible,
    geolocation: { watchPosition() { starts += 1; return starts; }, clearWatch(id) { cleared.push(id); } },
  });
  heartbeat.sync();
  visible = false; heartbeat.sync();
  visible = true; heartbeat.sync();
  assert.equal(starts, 2);
  assert.deepEqual(cleared, [1]);
  heartbeat.stop();
});
