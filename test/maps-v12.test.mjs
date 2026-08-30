import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMapProvider, createMockMapProvider, getMapsApiKey, nhaTrangFallbackLocation } from '../src/map/map-provider.js';
import { getClientLocation } from '../src/location/client-location.js';
import { getRouteMatrixCandidates, isLocationFresh, rankTechnicians } from '../src/technicians/matching.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';
import { createMockRoutingProvider } from '../src/routing/routing-provider.js';
import { createMockProviderLocationStream } from '../src/tracking/location-stream.js';

describe('architecture cartographique V1.2', () => {
  it('sélectionne Amazon Location par configuration et Mock sans clé côté tests', async () => {
    assert.equal(getMapsApiKey({ AMAZON_LOCATION_API_KEY: ' public-key ' }), 'public-key');
    assert.equal((await createMapProvider({ config: {} })).id, 'mock-local');
    assert.equal(createMockMapProvider().id, 'mock-local');
  });
  it('récupère la géolocalisation et replie sur Nha Trang', async () => {
    const located = await getClientLocation({ getCurrentPosition(ok) { ok({ coords: { latitude: 12.2, longitude: 109.2, accuracy: 8 } }); } });
    assert.equal(located.source, 'browser'); assert.equal(located.accuracy, 8);
    const fallback = await getClientLocation({ getCurrentPosition(ok, fail) { fail(); } });
    assert.equal(fallback.source, 'fallback'); assert.equal(fallback.latitude, nhaTrangFallbackLocation.latitude);
  });
  it('exclut les statuts incompatibles et les positions périmées', () => {
    const now = Date.now(); const base = mockTechnicians[0];
    assert.equal(isLocationFresh({ ...base, lastLocationAt: new Date(now - 301000).toISOString() }, now), false);
    const candidates = [base, { ...base, id: 'offline', online: false }, { ...base, id: 'busy', available: false }, { ...base, id: 'old', lastLocationAt: new Date(now - 301000).toISOString() }];
    assert.deepEqual(rankTechnicians(candidates, 'electricity', { now }).map(({ id }) => id), [base.id]);
  });
  it('n’envoie à RouteMatrix que les prestataires compatibles et actifs', () => {
    const base = mockTechnicians[0];
    const candidates = [base, { ...base, id: 'wrong-service', category: 'plumbing' }, { ...base, id: 'unverified', verified: false }, { ...base, id: 'offline', online: false }, { ...base, id: 'busy', available: false }];
    assert.deepEqual(getRouteMatrixCandidates(candidates, 'electricity').map(({ id }) => id), [base.id]);
  });
  it('simule une route fluide avec ETA et distance décroissantes', async () => {
    const route = await createMockRoutingProvider().route(mockTechnicians[0], nhaTrangFallbackLocation);
    const callbacks = []; const values = [];
    const stream = createMockProviderLocationStream({ providerId: 'x', route: route.points.slice(0, 4), durationMinutes: 4, scheduler(fn) { callbacks.push(fn); return 1; }, cancel() {} });
    stream.subscribe((position) => values.push(position)); callbacks[0](); callbacks[0](); callbacks[0]();
    assert.equal(values.length, 4);
    assert.ok(values.every((value, index) => !index || value.etaMinutes <= values[index - 1].etaMinutes));
    assert.ok(values.every((value, index) => !index || value.remainingDistanceKm <= values[index - 1].remainingDistanceKm));
  });
});
