const toRad = (value) => value * Math.PI / 180;
export function straightLineDistanceKm(a, b) {
  const dLat = toRad(b.latitude - a.latitude); const dLng = toRad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
export function createMockRoutingProvider() {
  return { id: 'mock-routing', async route(origin, destination) {
    const distanceKm = straightLineDistanceKm(origin, destination) * 1.22;
    const points = Array.from({ length: 21 }, (_, i) => ({ latitude: origin.latitude + (destination.latitude - origin.latitude) * i / 20, longitude: origin.longitude + (destination.longitude - origin.longitude) * i / 20 }));
    return { distanceKm, durationMinutes: Math.max(2, Math.ceil(distanceKm / 0.32)), points, source: 'demo' };
  } };
}

// Adapter seam for a server-side Routes/Route Matrix proxy. A browser key must
// never be used to expose a server credential or call privileged APIs directly.
export function createGoogleRoutingProvider({ routeClient, fallback = createMockRoutingProvider() } = {}) {
  return { id: routeClient ? 'google-routing' : fallback.id, async route(origin, destination) { return routeClient ? routeClient.route(origin, destination) : fallback.route(origin, destination); } };
}
