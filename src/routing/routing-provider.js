import { amazonLocationFailure, logAmazonLocationDiagnostic } from '../location/amazon-location-diagnostics.js';

const toRad = (value) => value * Math.PI / 180;
export function straightLineDistanceKm(a, b) { const dLat = toRad(b.latitude - a.latitude); const dLng = toRad(b.longitude - a.longitude); const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }
const position = ({ longitude, latitude }) => [longitude, latitude];

export function mapRouteMatrixResponse(response, technicians) {
  const matrix = response.RouteMatrix ?? response.routeMatrix ?? [];
  return technicians.map((technician, index) => {
    // The service returns one row per Origin and one column per Destination.
    const result = matrix[index]?.[0];
    if (!result || result.Error || result.Status && result.Status !== 'Ok') return { ...technician, routeError: true };
    const distanceKm = result.Distance / 1000;
    return { ...technician, distanceKm, estimatedArrivalMinutes: Math.ceil(result.Duration / 60), routeDistanceKm: distanceKm, routeDurationSeconds: result.Duration };
  });
}

export function createAmazonRouteService({ apiKey, region = 'ap-southeast-1', fetch: fetchObject = globalThis.fetch, travelMode = 'Car' }) {
  const request = async (operation, path, body) => {
    const response = await fetchObject(`https://routes.geo.${region}.amazonaws.com/v2/${path}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      let awsErrorCode = response.headers?.get?.('x-amzn-errortype')?.split(':')[0];
      if (!awsErrorCode) {
        try { awsErrorCode = (await response.clone().json()).code; } catch { /* Non-JSON AWS/proxy response. */ }
      }
      const error = new Error(`Amazon Location ${operation} request failed (${response.status})`);
      error.status = response.status;
      error.awsErrorCode = awsErrorCode || 'HttpError';
      logAmazonLocationDiagnostic('routing', false, amazonLocationFailure(error));
      throw error;
    }
    const data = await response.json();
    logAmazonLocationDiagnostic('routing', true, { status: response.status });
    return data;
  };
  return {
    id: 'amazon-location-routes', travelMode,
    async matrix(technicians, client) { return mapRouteMatrixResponse(await request('CalculateRouteMatrix', 'route-matrix', { Origins: technicians.map((item) => ({ Position: position(item) })), Destinations: [{ Position: position(client) }], TravelMode: travelMode }), technicians); },
    async route(origin, destination) { const data = await request('CalculateRoutes', 'routes', { Origin: position(origin), Destination: position(destination), TravelMode: travelMode }); const points = data.Legs?.flatMap((leg) => leg.Geometry?.LineString ?? []).map(([longitude, latitude]) => ({ longitude, latitude })) ?? []; return { distanceKm: data.Summary?.Distance, durationMinutes: Math.ceil(data.Summary?.Duration / 60), points, source: 'amazon-location' }; },
  };
}

export function createMockRoutingProvider() { return { id: 'mock-routing', async matrix(technicians, destination) { return technicians.map((item) => { const distanceKm = straightLineDistanceKm(item, destination) * 1.22; return { ...item, distanceKm, routeDistanceKm: distanceKm, estimatedArrivalMinutes: Math.max(2, Math.ceil(distanceKm / .32)) }; }); }, async route(origin, destination) { const distanceKm = straightLineDistanceKm(origin, destination) * 1.22; const points = Array.from({ length: 21 }, (_, i) => ({ latitude: origin.latitude + (destination.latitude - origin.latitude) * i / 20, longitude: origin.longitude + (destination.longitude - origin.longitude) * i / 20 })); return { distanceKm, durationMinutes: Math.max(2, Math.ceil(distanceKm / .32)), points, source: 'demo' }; } }; }

export function createRouteService(config = globalThis.__HOME_AI_CONFIG__, options = {}) {
  const apiKey = config?.AMAZON_LOCATION_API_KEY?.trim();
  if (apiKey) return createAmazonRouteService({ apiKey, ...options });
  if (typeof document === 'undefined') return createMockRoutingProvider();
  return { id: 'amazon-location-unconfigured', async matrix() { throw new Error('Amazon Location API key missing'); }, async route() { throw new Error('Amazon Location API key missing'); } };
}
