import { straightLineDistanceKm } from '../routing/routing-provider.js';

export function createMockProviderLocationStream({ providerId, route, durationMinutes, intervalMs = 500, scheduler = globalThis.setInterval, cancel = globalThis.clearInterval }) {
  let timer;
  return {
    subscribe(listener) {
      let index = 0;
      const emit = () => {
        const point = route[index]; const next = route[Math.min(index + 1, route.length - 1)];
        const remainingDistanceKm = route.slice(index).reduce((sum, item, i, rest) => i ? sum + straightLineDistanceKm(rest[i - 1], item) : sum, 0);
        listener({ providerId, ...point, heading: Math.atan2(next.longitude - point.longitude, next.latitude - point.latitude) * 180 / Math.PI, speed: 25, accuracy: 12, timestamp: new Date().toISOString(), remainingDistanceKm, etaMinutes: Math.max(0, Math.ceil(durationMinutes * (route.length - 1 - index) / (route.length - 1))) });
        index += 1; if (index >= route.length) cancel(timer);
      };
      emit(); timer = scheduler(emit, intervalMs); return () => cancel(timer);
    },
  };
}

export function createRealtimeProviderLocationStream({ subscribe }) {
  return { subscribe }; // future WebSocket/SSE adapter; backend remains source of truth.
}
