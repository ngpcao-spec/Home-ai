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
    const mapped = mapRouteMatrixResponse({ RouteMatrix: [[{ Status: 'Ok', Distance: 3.25, Duration: 721 }, { Status: 'NoRoute' }]] }, technicians);
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

  it('retourne un échec de routage au lieu d’un faux ETA', async () => {
    const service = createAmazonRouteService({ apiKey: 'placeholder', fetch: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(service.matrix(technicians, { longitude: 109.1967, latitude: 12.2388 }), /503/);
  });

  it('utilise un adaptateur sans réseau lorsque la clé manque', () => {
    assert.equal(createRouteService({}).id, 'mock-routing');
  });
});
