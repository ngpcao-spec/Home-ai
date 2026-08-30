import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAmazonRouteService, createRouteService, mapRouteMatrixResponse } from '../src/routing/routing-provider.js';
import { rankTechnicians } from '../src/technicians/matching.js';

const technicians = [
  { id: 'a', category: 'electricity', verified: true, online: true, available: true, distanceKm: 1, rating: 4.9, reliabilityScore: 97, completedJobs: 100 },
  { id: 'b', category: 'electricity', verified: true, online: true, available: true, distanceKm: 1, rating: 4.9, reliabilityScore: 96, completedJobs: 200 },
];

describe('Amazon Location v2 dispatch', () => {
  it('mappe la matrice réelle sans inventer les valeurs', () => {
    const mapped = mapRouteMatrixResponse({ RouteMatrix: [[{ Distance: 3250, Duration: 721 }], [{ Error: 'NoRoute' }]] }, technicians);
    assert.equal(mapped[0].distanceKm, 3.25);
    assert.equal(mapped[0].estimatedArrivalMinutes, 13);
    assert.equal(mapped[1].routeError, true);
  });

  it('classe ETA, route, note, fiabilité puis missions de façon déterministe', () => {
    const ranked = rankTechnicians([{ ...technicians[0], estimatedArrivalMinutes: 10 }, { ...technicians[1], estimatedArrivalMinutes: 10 }], 'electricity');
    assert.deepEqual(ranked.map(({ id }) => id), ['a', 'b']);
  });

  it('garde le mode de voyage configurable', () => {
    const service = createAmazonRouteService({ apiKey: 'placeholder', travelMode: 'Scooter', fetch: async () => ({ ok: true, json: async () => ({ RouteMatrix: [[]] }) }) });
    assert.equal(service.travelMode, 'Scooter');
  });

  it('appelle les endpoints v2 avec des positions longitude/latitude', async () => {
    const calls = [];
    const service = createAmazonRouteService({ apiKey: 'placeholder', fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => calls.length === 1 ? { RouteMatrix: [[{ Status: 'Ok', Distance: 1, Duration: 60 }], [{ Status: 'Ok', Distance: 2, Duration: 120 }]] } : { Legs: [], Summary: { Distance: 1, Duration: 60 } } };
    } });
    await service.matrix(technicians.map((item, index) => ({ ...item, longitude: 109.1 + index, latitude: 12.2 + index })), { longitude: 109.1967, latitude: 12.2388 });
    await service.route({ longitude: 109.1, latitude: 12.2 }, { longitude: 109.1967, latitude: 12.2388 });
    assert.equal(new URL(calls[0].url).pathname, '/v2/route-matrix');
    assert.deepEqual(calls[0].body.Origins[0].Position, [109.1, 12.2]);
    assert.deepEqual(calls[0].body.Destinations[0].Position, [109.1967, 12.2388]);
    assert.equal(new URL(calls[1].url).pathname, '/v2/routes');
  });

  it('retourne un échec de routage au lieu d’un faux ETA', async () => {
    const service = createAmazonRouteService({ apiKey: 'placeholder', fetch: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(service.matrix(technicians, { longitude: 109.1967, latitude: 12.2388 }), /503/);
  });

  it('utilise un adaptateur sans réseau lorsque la clé manque', () => {
    assert.equal(createRouteService({}).id, 'mock-routing');
  });
});
