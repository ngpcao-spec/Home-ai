const toRad = (value) => value * Math.PI / 180;
export function straightLineDistanceKm(a, b) { const dLat = toRad(b.latitude - a.latitude); const dLng = toRad(b.longitude - a.longitude); const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }
const position = ({ longitude, latitude }) => [longitude, latitude];

export function mapRouteMatrixResponse(response, technicians) {
  const routes = response.RouteMatrix?.[0] ?? response.routeMatrix?.[0] ?? [];
  return technicians.map((technician, index) => {
    const result = routes[index];
    if (!result || result.Status && result.Status !== 'Ok') return { ...technician, routeError: true };
    return { ...technician, distanceKm: result.Distance, estimatedArrivalMinutes: Math.ceil(result.Duration / 60), routeDistanceKm: result.Distance, routeDurationSeconds: result.Duration };
  });
}

export function createAmazonRouteService({ apiKey, region = 'ap-southeast-1', fetch: fetchObject = globalThis.fetch, travelMode = 'Car' }) {
  const request = async (path, body) => {
    const response = await fetchObject(`https://routes.geo.${region}.amazonaws.com/v2/${path}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Amazon Location request failed (${response.status})`);
    return response.json();
  };
  return {
    id: 'amazon-location-routes', travelMode,
    async matrix(technicians, client) { return mapRouteMatrixResponse(await request('route-matrix', { Origins: technicians.map((item) => ({ Position: position(item) })), Destinations: [{ Position: position(client) }], TravelMode: travelMode }), technicians); },
    async route(origin, destination) { const data = await request('routes', { Origin: position(origin), Destination: position(destination), TravelMode: travelMode }); const points = data.Legs?.flatMap((leg) => leg.Geometry?.LineString ?? []).map(([longitude, latitude]) => ({ longitude, latitude })) ?? []; return { distanceKm: data.Summary?.Distance, durationMinutes: Math.ceil(data.Summary?.Duration / 60), points, source: 'amazon-location' }; },
  };
}

export function createMockRoutingProvider() { return { id: 'mock-routing', async matrix(technicians, destination) { return technicians.map((item) => { const distanceKm = straightLineDistanceKm(item, destination) * 1.22; return { ...item, distanceKm, routeDistanceKm: distanceKm, estimatedArrivalMinutes: Math.max(2, Math.ceil(distanceKm / .32)) }; }); }, async route(origin, destination) { const distanceKm = straightLineDistanceKm(origin, destination) * 1.22; const points = Array.from({ length: 21 }, (_, i) => ({ latitude: origin.latitude + (destination.latitude - origin.latitude) * i / 20, longitude: origin.longitude + (destination.longitude - origin.longitude) * i / 20 })); return { distanceKm, durationMinutes: Math.max(2, Math.ceil(distanceKm / .32)), points, source: 'demo' }; } }; }

export function createRouteService(config = globalThis.__HOME_AI_CONFIG__, options = {}) {
  const apiKey = config?.AMAZON_LOCATION_API_KEY?.trim();
  if (apiKey) return createAmazonRouteService({ apiKey, ...options });
  if (typeof document === 'undefined') return createMockRoutingProvider();
  return { id: 'amazon-location-unconfigured', async matrix() { throw new Error('Amazon Location API key missing'); }, async route() { throw new Error('Amazon Location API key missing'); } };
}
