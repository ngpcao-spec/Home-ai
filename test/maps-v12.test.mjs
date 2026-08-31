import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMapProvider, createMockMapProvider, getMapsApiKey, nhaTrangFallbackLocation } from '../src/map/map-provider.js';
import { getClientLocation } from '../src/location/client-location.js';
import { getRouteMatrixCandidates, isLocationFresh, rankTechnicians } from '../src/technicians/matching.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';
import { createMockRoutingProvider } from '../src/routing/routing-provider.js';
import { createMockProviderLocationStream } from '../src/tracking/location-stream.js';
import { createAmazonLocationMapProvider } from '../src/map/amazon-location-map-provider.js';

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
    const stream = createMockProviderLocationStream({ providerId: 'x', route: route.points.slice(0, 4), durationMinutes: 4, sampleCount: 3, scheduler(fn) { callbacks.push(fn); return 1; }, cancel() {} });
    stream.subscribe((position) => values.push(position)); callbacks[0](); callbacks[0](); callbacks[0]();
    assert.equal(values.length, 4);
    assert.ok(values.every((value, index) => !index || value.etaMinutes <= values[index - 1].etaMinutes));
    assert.ok(values.every((value, index) => !index || value.remainingDistanceKm <= values[index - 1].remainingDistanceKm));
    assert.equal(values.at(-1).arrived, true);
    assert.equal(values.at(-1).status, 'Thợ đã đến');
  });
  it('libère la carte C09 avant de créer la carte de suivi C13', async () => {
    const maps = [];
    class FakeMap {
      constructor({ container }) { this.container = container; this.sources = new Map(); this.layers = []; this.removed = false; maps.push(this); }
      addControl() {}
      once(event, listener) { if (event === 'load') listener(); }
      getContainer() { return this.container; }
      addSource(id, source) { this.sources.set(id, { ...source, setData() {} }); }
      getSource(id) { return this.sources.get(id); }
      addLayer(layer) { this.layers.push(layer); }
      setPaintProperty() {}
      fitBounds() {}
      remove() { this.removed = true; }
    }
    class FakeMarker {
      setLngLat() { return this; }
      setPopup() { return this; }
      addTo() { return this; }
      getElement() { return { classList: { toggle() {} } }; }
      remove() { this.removed = true; }
    }
    class FakePopup { setText() { return this; } }
    class FakeBounds { extend() { return this; } }
    const previousMapLibre = globalThis.maplibregl;
    globalThis.maplibregl = { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeBounds, NavigationControl: class {} };
    try {
      const document = { createElement() { return { className: '', dataset: {}, setAttribute() {} }; } };
      const provider = createAmazonLocationMapProvider({ apiKey: 'test', document });
      const clientLocation = { latitude: 12.24, longitude: 109.19 };
      const technician = { id: 'p1', initials: 'P1', name: 'Provider', latitude: 12.23, longitude: 109.18 };
      await provider.render({ id: 'c09' }, { clientLocation, technicians: [technician] });
      const route = [{ latitude: 12.23, longitude: 109.18 }, { latitude: 12.235, longitude: 109.185 }, { latitude: 12.24, longitude: 109.19 }];
      await provider.render({ id: 'c13' }, { clientLocation, technicians: [technician], route });
      assert.equal(maps.length, 2);
      assert.equal(maps[0].removed, true);
      assert.equal(maps[1].removed, false);
      assert.deepEqual(maps[1].sources.get('route').data.features[0].geometry.coordinates, route.map(({ longitude, latitude }) => [longitude, latitude]));
      const routeLayer = maps[1].layers.find(({ id }) => id === 'route');
      assert.deepEqual(routeLayer.layout, { 'line-join': 'round', 'line-cap': 'round' });
      assert.equal(routeLayer.paint['line-width'], 4);
    } finally {
      globalThis.maplibregl = previousMapLibre;
    }
  });
});
