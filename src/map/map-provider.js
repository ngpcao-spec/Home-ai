// Giao diện dữ liệu độc lập với nhà cung cấp bản đồ. Một provider thật sau này chỉ
// cần trả về cùng cấu trúc marker; tọa độ GPS, realtime và ETA thuộc backend.
export const mockCustomerLocation = {
  latitude: 12.2388,
  longitude: 109.1967,
  label: 'Vị trí của bạn',
};

const markerPositions = [
  { left: 27, top: 31 }, { left: 72, top: 25 }, { left: 67, top: 65 },
  { left: 19, top: 70 }, { left: 82, top: 47 }, { left: 39, top: 18 },
];

export function createMockMapProvider() {
  return {
    id: 'mock-local',
    customer: mockCustomerLocation,
    getMarkerPosition(technician, index) {
      const seed = [...technician.id].reduce((total, character) => total + character.charCodeAt(0), index);
      return markerPositions[seed % markerPositions.length];
    },
  };
}

export function createMapMarkup({ provider = createMockMapProvider(), technicians = [], selectedId, radiusKm = 2, searching = true }) {
  const markers = technicians.map((technician, index) => {
    const position = provider.getMarkerPosition(technician, index);
    const selected = technician.id === selectedId;
    return `<button type="button" class="map-marker map-marker--technician${selected ? ' is-selected' : ''}" style="--left:${position.left}%;--top:${position.top}%" data-map-technician="${technician.id}" aria-label="${technician.name}, ${technician.distanceKm} km, ${technician.availability}">
      <span>${technician.initials}</span><small>${technician.estimatedArrivalMinutes} phút</small>
    </button>`;
  }).join('');

  return `<div class="local-map" data-map-provider="${provider.id}" role="img" aria-label="Bản đồ mô phỏng thợ tại Nha Trang">
    <div class="map-block map-block--one"></div><div class="map-block map-block--two"></div><div class="map-block map-block--three"></div>
    <div class="search-radius${searching ? ' is-searching' : ''}" style="--radius:${Math.min(radiusKm, 10)}" aria-hidden="true"></div>
    <div class="map-marker map-marker--customer"><span>⌂</span><strong>${provider.customer.label}</strong></div>
    ${markers}
    <div class="map-location-label">Nha Trang · Khánh Hòa</div>
  </div>`;
}
