import { createMapProvider, createMockMapProvider, getAmazonLocationApiKey } from '../map/map-provider.js';
import { createMockRoutingProvider, createRouteService, straightLineDistanceKm } from '../routing/routing-provider.js';
import { getClientLocation } from '../location/client-location.js';

export const ARRIVAL_RADIUS_KM = 0.15;
export const usesDemoNavigationAdapters = (source, config) => source === 'mock' && !getAmazonLocationApiKey(config);

export async function prepareProviderNavigation(assignment, { source = 'mock', config = globalThis.__HOME_AI_CONFIG__, geolocation = globalThis.navigator?.geolocation, mapFactory, routeFactory } = {}) {
  const providerLocation = await getClientLocation(geolocation);
  const destination = assignment.clientLocation;
  if (!destination) throw new Error('Destination unavailable');
  // Demo data must not force the demo map in production: use the same configured
  // Amazon Location adapters as the customer journey whenever a browser key exists.
  const useDemoAdapters = usesDemoNavigationAdapters(source, config);
  const routing = routeFactory?.() ?? (useDemoAdapters ? createMockRoutingProvider() : createRouteService(config));
  const map = await (mapFactory?.() ?? (useDemoAdapters ? createMockMapProvider() : createMapProvider({ config })));
  const route = await routing.route(providerLocation, destination);
  return { map, route, providerLocation, destination, arrived: straightLineDistanceKm(providerLocation, destination) <= ARRIVAL_RADIUS_KM };
}

export async function renderProviderNavigation(container, navigation, provider = {}) {
  if (!container || !navigation) return;
  navigation.map.setClientLocation({ ...navigation.destination, label: 'Khách hàng' });
  await navigation.map.render(container, {
    clientLocation: { ...navigation.destination, label: 'Khách hàng' },
    technicians: [{
      id: provider.id ?? 'current-provider', name: provider.name ?? 'Bạn', initials: 'P',
      distanceKm: navigation.route.distanceKm, estimatedArrivalMinutes: navigation.route.durationMinutes,
      availability: 'Đang di chuyển', ...navigation.providerLocation,
    }],
    selectedId: provider.id ?? 'current-provider', route: navigation.route.points, radiusKm: 0, searching: false,
  });
}
