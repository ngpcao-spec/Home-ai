import { straightLineDistanceKm } from '../routing/routing-provider.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function getRouteMetrics(route) {
  const segmentLengths = route.slice(1).map((point, index) => straightLineDistanceKm(route[index], point));
  return { segmentLengths, geometryDistanceKm: segmentLengths.reduce((sum, distance) => sum + distance, 0) };
}

function pointAtProgress(route, segmentLengths, geometryDistanceKm, progress) {
  if (progress <= 0 || geometryDistanceKm === 0) return { ...route[0], heading: 0 };
  if (progress >= 1) return { ...route.at(-1), heading: 0 };

  const targetDistance = geometryDistanceKm * progress;
  let travelled = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (travelled + segmentLength >= targetDistance) {
      const start = route[index];
      const end = route[index + 1];
      const ratio = segmentLength ? (targetDistance - travelled) / segmentLength : 0;
      return {
        latitude: start.latitude + (end.latitude - start.latitude) * ratio,
        longitude: start.longitude + (end.longitude - start.longitude) * ratio,
        heading: Math.atan2(end.longitude - start.longitude, end.latitude - start.latitude) * 180 / Math.PI,
      };
    }
    travelled += segmentLength;
  }
  return { ...route.at(-1), heading: 0 };
}

export function getProviderArrivalStatus({ arrived, remainingDistanceKm, etaMinutes }) {
  if (arrived) return 'Thợ đã đến';
  if (remainingDistanceKm <= 0.5 || etaMinutes <= 2) return 'Sắp đến nơi';
  return 'Thợ đang đến';
}

/**
 * ProviderLocationSource contract: subscribe(listener) emits backend-shaped
 * provider positions and returns an unsubscribe function. The browser never
 * reads the provider phone GPS directly.
 */
export function createMockProviderLocationSource({
  providerId,
  route,
  durationMinutes,
  totalDistanceKm,
  intervalMs = 500,
  sampleCount = 40,
  scheduler = globalThis.setInterval,
  cancel = globalThis.clearInterval,
}) {
  if (!Array.isArray(route) || route.length < 2) throw new Error('ProviderLocationSource requires a route with at least two points');
  const steps = Math.max(1, Math.floor(sampleCount));
  const { segmentLengths, geometryDistanceKm } = getRouteMetrics(route);
  const routeDistanceKm = Number.isFinite(totalDistanceKm) ? totalDistanceKm : geometryDistanceKm;

  return {
    kind: 'mock-route',
    subscribe(listener) {
      let timer;
      let index = 0;
      let active = true;
      const emit = () => {
        if (!active) return;
        const progress = clamp(index / steps, 0, 1);
        const arrived = progress >= 1;
        const point = pointAtProgress(route, segmentLengths, geometryDistanceKm, progress);
        const remainingDistanceKm = arrived ? 0 : routeDistanceKm * (1 - progress);
        const etaMinutes = arrived ? 0 : Math.max(1, Math.ceil(durationMinutes * (1 - progress)));
        listener({
          providerId,
          ...point,
          speed: arrived ? 0 : 25,
          accuracy: 12,
          timestamp: new Date().toISOString(),
          progress,
          remainingDistanceKm,
          etaMinutes,
          arrived,
          status: getProviderArrivalStatus({ arrived, remainingDistanceKm, etaMinutes }),
        });
        index += 1;
        if (arrived) {
          active = false;
          if (timer !== undefined) cancel(timer);
        }
      };

      emit();
      if (active) timer = scheduler(emit, intervalMs);
      return () => {
        active = false;
        if (timer !== undefined) cancel(timer);
      };
    },
  };
}

export const createMockProviderLocationStream = createMockProviderLocationSource;

export function createRealtimeProviderLocationSource({ subscribe }) {
  return { kind: 'backend-realtime', subscribe };
}

export const createRealtimeProviderLocationStream = createRealtimeProviderLocationSource;
