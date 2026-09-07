import { straightLineDistanceKm } from '../routing/routing-provider.js';

const valid = point => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;

export async function prepareSupabaseTracking(snapshot, routes) {
  const { mission, providerLocation: origin } = snapshot;
  const destination = mission.clientLocation;
  if (!mission.providerId || origin?.providerId !== mission.providerId || origin?.missionId !== mission.id
      || !valid(origin) || !valid(destination) || !Number.isFinite(Date.parse(origin.recordedAt))) {
    throw new Error('Assigned provider GPS unavailable');
  }
  const near = straightLineDistanceKm(origin, destination) < 0.1;
  const route = near ? null : await routes.get(origin, destination);
  if (!near && (route?.source !== 'amazon-location' || !Number.isFinite(route?.distanceKm) || !Number.isFinite(route?.durationMinutes)
      || route.points?.length < 2 || !route.points?.every(valid))) throw new Error('Route unavailable');
  return { origin, destination, route, position: {
    ...origin, near, arrived: mission.status === 'arrived',
    remainingDistanceKm: near ? straightLineDistanceKm(origin, destination) : route.distanceKm,
    etaMinutes: near ? 0 : route.durationMinutes,
    status: mission.status === 'arrived' ? 'Thợ đã đến' : near ? 'Thợ đang ở gần bạn' : 'Thợ đang đến',
  } };
}
