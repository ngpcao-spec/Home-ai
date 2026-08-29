export const nhaTrangFallbackLocation = Object.freeze({
  latitude: 12.2388,
  longitude: 109.1967,
  accuracy: null,
  source: 'fallback',
  updatedAt: null,
  label: 'Vị trí của bạn',
});

export const mockCustomerLocation = nhaTrangFallbackLocation;

const markerPositions = [
  { left: 27, top: 31 }, { left: 72, top: 25 }, { left: 67, top: 65 },
  { left: 19, top: 70 }, { left: 82, top: 47 }, { left: 39, top: 18 },
];

// MapProvider contract: render, setClientLocation, setProviders, moveProvider,
// setRoute, center and fitBounds. Business code never imports Google Maps.
export function createMockMapProvider() {
  return {
    id: 'mock-local',
    customer: { ...nhaTrangFallbackLocation },
    getMarkerPosition(technician, index) {
      const seed = [...technician.id].reduce((total, character) => total + character.charCodeAt(0), index);
      return markerPositions[seed % markerPositions.length];
    },
    render(container, state) { container.innerHTML = createMapMarkup({ provider: this, ...state }); },
    setClientLocation(location) { this.customer = { ...location, label: 'Vị trí của bạn' }; },
    setProviders() {}, moveProvider() {}, setRoute() {}, center() {}, fitBounds() {},
  };
}

export function createMapMarkup({ provider = createMockMapProvider(), technicians = [], selectedId, radiusKm = 2, searching = true, route = [] }) {
  const markers = technicians.map((technician, index) => {
    const position = provider.getMarkerPosition(technician, index);
    const selected = technician.id === selectedId;
    return `<button type="button" class="map-marker map-marker--technician${selected ? ' is-selected' : ''}" style="--left:${position.left}%;--top:${position.top}%" data-map-technician="${technician.id}" aria-label="${technician.name}, ${technician.distanceKm} km, ${technician.availability}">
      <span>${technician.initials}</span><small>${technician.estimatedArrivalMinutes} phút</small>
    </button>`;
  }).join('');
  const routeMarkup = route.length ? '<div class="mock-route" aria-hidden="true"></div>' : '';
  return `<div class="local-map" data-map-provider="${provider.id}" role="img" aria-label="Bản đồ mô phỏng thợ tại Nha Trang">
    <div class="map-block map-block--one"></div><div class="map-block map-block--two"></div><div class="map-block map-block--three"></div>
    <div class="search-radius${searching ? ' is-searching' : ''}" style="--radius:${Math.min(radiusKm, 10)}" aria-hidden="true"></div>
    ${routeMarkup}<div class="map-marker map-marker--customer"><span>⌂</span><strong>${provider.customer.label}</strong></div>
    ${markers}<div class="map-location-label">Nha Trang · Khánh Hòa <small>Chế độ bản đồ demo</small></div>
  </div>`;
}

export function getAmazonLocationApiKey(config = globalThis.__HOME_AI_CONFIG__) {
  return config?.AMAZON_LOCATION_API_KEY?.trim() || '';
}

export const getMapsApiKey = getAmazonLocationApiKey;

export async function createMapProvider(options = {}) {
  const apiKey = options.apiKey ?? getAmazonLocationApiKey(options.config);
  if (!apiKey && typeof document !== 'undefined') return {
    id: 'amazon-location-unconfigured',
    setClientLocation() {}, setProviders() {}, moveProvider() {}, setRoute() {}, center() {}, fitBounds() {},
    render(container) { container.innerHTML = '<div class="map-error" role="alert"><strong>Chưa cấu hình bản đồ</strong><span>Thiếu Amazon Location API key. Vui lòng liên hệ quản trị viên hoặc thử lại sau.</span></div>'; },
  };
  if (!apiKey) return createMockMapProvider();
  const { createAmazonLocationMapProvider } = await import('./amazon-location-map-provider.js');
  return createAmazonLocationMapProvider({ apiKey, region: options.region, document: options.document ?? document });
}
