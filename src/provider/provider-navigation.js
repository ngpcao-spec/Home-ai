import { createMapProvider, createMockMapProvider } from '../map/map-provider.js';
import { createMockRoutingProvider, createRouteService, straightLineDistanceKm } from '../routing/routing-provider.js';
import { getClientLocation } from '../location/client-location.js';

export const ARRIVAL_RADIUS_KM = 0.15;

export async function prepareProviderNavigation(assignment, { source = 'mock', config = globalThis.__HOME_AI_CONFIG__, geolocation = globalThis.navigator?.geolocation, mapFactory, routeFactory } = {}) {
  const providerLocation = await getClientLocation(geolocation);
  const destination = assignment.clientLocation;
  if (!destination) throw new Error('Destination unavailable');
  const routing = routeFactory?.() ?? (source === 'mock' ? createMockRoutingProvider() : createRouteService(config));
  const map = await (mapFactory?.() ?? (source === 'mock' ? createMockMapProvider() : createMapProvider({ config })));
  const route = await routing.route(providerLocation, destination);
  return { map, route, providerLocation, destination, arrived: straightLineDistanceKm(providerLocation, destination) <= ARRIVAL_RADIUS_KM };
}

export async function renderProviderNavigation(container, navigation, provider = {}) {
  if (!container || !navigation) return;
  await navigation.map.render(container, {
    clientLocation: { ...navigation.destination, label: 'Khách hàng' },
    technicians: [{ id: provider.id ?? 'current-provider', name: provider.name ?? 'Bạn', initials: 'P', ...navigation.providerLocation }],
    selectedId: provider.id ?? 'current-provider', route: navigation.route.points, radiusKm: 0, searching: false,
  });
}
