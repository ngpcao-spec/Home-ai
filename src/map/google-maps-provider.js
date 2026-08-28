let googleLoader;

function loadGoogleMaps(apiKey, documentObject) {
  if (globalThis.google?.maps) return Promise.resolve(globalThis.google.maps);
  if (googleLoader) return googleLoader;
  googleLoader = new Promise((resolve, reject) => {
    const callback = `homeAiMapsReady${Date.now()}`;
    globalThis[callback] = () => { delete globalThis[callback]; resolve(globalThis.google.maps); };
    const script = documentObject.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callback}&v=weekly`;
    script.async = true;
    script.onerror = () => reject(new Error('Không thể tải Google Maps'));
    documentObject.head.append(script);
  });
  return googleLoader;
}

export function createGoogleMapsProvider({ apiKey, document: documentObject = document }) {
  const state = { map: null, clientMarker: null, providerMarkers: new Map(), route: null, radius: null };
  const provider = {
    id: 'google-maps', customer: null,
    async render(container, view = {}) {
      const maps = await loadGoogleMaps(apiKey, documentObject);
      if (!state.map) state.map = new maps.Map(container, { center: view.clientLocation ?? this.customer, zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      this.setClientLocation(view.clientLocation ?? this.customer);
      this.setProviders(view.technicians ?? [], { approximate: view.searching, selectedId: view.selectedId });
      if (view.route?.length) this.setRoute(view.route);
      if (view.radiusKm) {
        state.radius?.setMap(null);
        state.radius = new maps.Circle({ map: state.map, center: this.customer, radius: view.radiusKm * 1000, fillColor: '#087b61', fillOpacity: .09, strokeColor: '#087b61', strokeOpacity: .45 });
      }
    },
    setClientLocation(location) {
      if (!location || !state.map) return;
      this.customer = location;
      const position = { lat: location.latitude, lng: location.longitude };
      if (!state.clientMarker) state.clientMarker = new globalThis.google.maps.Marker({ map: state.map, position, title: 'Vị trí của bạn', label: '⌂' });
      else state.clientMarker.setPosition(position);
      state.map.setCenter(position);
    },
    setProviders(technicians, { approximate = true, selectedId } = {}) {
      if (!state.map) return;
      const visible = new Set(technicians.map(({ id }) => id));
      state.providerMarkers.forEach((marker, id) => { if (!visible.has(id)) { marker.setMap(null); state.providerMarkers.delete(id); } });
      technicians.forEach((technician) => {
        // Before assignment use a deterministic ~100m offset, not the exact GPS fix.
        const offset = approximate ? (([...technician.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7) - 3) * .00018 : 0;
        const position = { lat: technician.latitude + offset, lng: technician.longitude - offset };
        let marker = state.providerMarkers.get(technician.id);
        if (!marker) {
          marker = new globalThis.google.maps.Marker({ map: state.map, position, title: approximate ? 'Thợ demo gần bạn' : technician.name });
          state.providerMarkers.set(technician.id, marker);
        }
        marker.setPosition(position);
        marker.setOpacity(selectedId && technician.id !== selectedId ? .55 : 1);
      });
    },
    moveProvider(id, location) { state.providerMarkers.get(id)?.setPosition({ lat: location.latitude, lng: location.longitude }); },
    setRoute(points) {
      state.route?.setMap(null);
      state.route = new globalThis.google.maps.Polyline({ map: state.map, path: points.map((p) => ({ lat: p.latitude, lng: p.longitude })), strokeColor: '#087b61', strokeWeight: 5 });
      this.fitBounds(points);
    },
    center(location) { state.map?.panTo({ lat: location.latitude, lng: location.longitude }); },
    fitBounds(points) { const bounds = new globalThis.google.maps.LatLngBounds(); points.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude })); state.map?.fitBounds(bounds, 52); },
  };
  return provider;
}
