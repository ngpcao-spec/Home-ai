import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMockProviderLocationSource,
  createRealtimeProviderLocationSource,
  getProviderArrivalStatus,
} from '../src/tracking/location-stream.js';
import { createTrackingRouteSession } from '../src/tracking/route-session.js';
import { createTrackingStageMarkup } from '../src/tracking/tracking-sheet.js';

const collectSource = (options) => {
  const callbacks = [];
  const cancelled = [];
  const positions = [];
  const source = createMockProviderLocationSource({
    ...options,
    scheduler(callback) { callbacks.push(callback); return 17; },
    cancel(timer) { cancelled.push(timer); },
  });
  const unsubscribe = source.subscribe((position) => positions.push(position));
  while (!positions.at(-1).arrived) callbacks[0]();
  return { source, positions, cancelled, unsubscribe };
};

describe('suivi C13', () => {
  it('expose une source de localisation abstraite remplaçable par le backend', () => {
    const subscribe = () => () => {};
    const source = createRealtimeProviderLocationSource({ subscribe });
    assert.equal(source.kind, 'backend-realtime');
    assert.equal(source.subscribe, subscribe);
  });

  it('fait progresser le technicien sur chaque segment de la géométrie routière', () => {
    const route = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
    ];
    const { source, positions } = collectSource({ providerId: 'provider-1', route, durationMinutes: 8, totalDistanceKm: 4, sampleCount: 8 });
    assert.equal(source.kind, 'mock-route');
    assert.equal(positions.length, 9);
    assert.ok(positions.every(({ latitude, longitude }) => Math.abs(latitude) < 1e-9 || Math.abs(longitude - 1) < 1e-9), 'aucun point ne coupe le virage en diagonale');
    assert.ok(positions.every((position, index) => !index || position.progress > positions[index - 1].progress));
  });

  it('met à jour distance et ETA de façon monotone puis signale l’arrivée exacte', () => {
    const route = [{ latitude: 12.2, longitude: 109.1 }, { latitude: 12.3, longitude: 109.2 }];
    const { positions, cancelled } = collectSource({ providerId: 'provider-1', route, durationMinutes: 6, totalDistanceKm: 3.2, sampleCount: 4 });
    assert.ok(positions.every((position, index) => !index || position.remainingDistanceKm < positions[index - 1].remainingDistanceKm));
    assert.ok(positions.every((position, index) => !index || position.etaMinutes <= positions[index - 1].etaMinutes));
    assert.deepEqual(positions.at(-1), {
      ...positions.at(-1),
      remainingDistanceKm: 0,
      etaMinutes: 0,
      arrived: true,
      status: 'Thợ đã đến',
      speed: 0,
    });
    assert.deepEqual(cancelled, [17]);
    assert.equal(getProviderArrivalStatus({ arrived: false, remainingDistanceKm: 0.4, etaMinutes: 4 }), 'Sắp đến nơi');
  });

  it('réutilise CalculateRoutes pour un même trajet et réessaie après une erreur', async () => {
    let routeCalls = 0;
    let fail = false;
    const route = { points: [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }] };
    const session = createTrackingRouteSession({ async route() { routeCalls += 1; if (fail) throw new Error('network'); return route; } });
    const origin = { id: 'p1', latitude: 1, longitude: 1 };
    const destination = { latitude: 2, longitude: 2 };
    assert.equal(await session.get(origin, destination), route);
    assert.equal(await session.get(origin, destination), route);
    assert.equal(routeCalls, 1);
    session.reset();
    fail = true;
    await assert.rejects(session.get(origin, destination), /network/);
    fail = false;
    assert.equal(await session.get(origin, destination), route);
    assert.equal(routeCalls, 3);
  });

  it('rend la bottom sheet C13 avec les informations et actions attendues', () => {
    const markup = createTrackingStageMarkup({ initials: 'NM', name: 'Nguyễn Văn Minh', rating: 4.9, reviewCount: 186, shortDescription: 'Thợ điện dân dụng' });
    ['Thợ đang đến', 'Thời gian đến', 'Quãng đường còn lại', 'Gọi thợ', 'Nhắn tin', 'Bắt đầu sửa chữa'].forEach((text) => assert.match(markup, new RegExp(text)));
  });
});
