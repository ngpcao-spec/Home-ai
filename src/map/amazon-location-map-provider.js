import { amazonLocationFailure, logAmazonLocationDiagnostic } from '../location/amazon-location-diagnostics.js';

const MAPLIBRE_VERSION = '5.6.2';
let loader;

function loadMapLibre(documentObject) {
  if (globalThis.maplibregl) return Promise.resolve(globalThis.maplibregl);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const css = documentObject.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
    documentObject.head.append(css);
    const script = documentObject.createElement('script');
    script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
    script.onload = () => resolve(globalThis.maplibregl);
    script.onerror = () => reject(new Error('Không thể tải thư viện bản đồ'));
    documentObject.head.append(script);
  });
  return loader;
}

const point = ({ longitude, latitude }) => [longitude, latitude];
const featureCollection = (features = []) => ({ type: 'FeatureCollection', features });

export function createAmazonLocationMapProvider({ apiKey, region = 'ap-southeast-1', document: documentObject = document }) {
  const state = { map: null, mapInstanceId: 0, client: null, markers: new Map(), markerDiagnostics: new Map(), nextMarkerInstanceId: 1 };
  const style = `https://maps.geo.${region}.amazonaws.com/v2/styles/Standard/descriptor?key=${encodeURIComponent(apiKey)}`;
  const provider = {
    id: 'amazon-location', customer: null, style,
    async render(container, view = {}) {
      try {
        const maplibregl = await loadMapLibre(documentObject);
        if (!state.map || state.map.getContainer() !== container) {
          if (state.map) {
            state.markers.forEach((marker) => marker.remove());
            state.markers.clear();
            state.markerDiagnostics.clear();
            state.client?.remove();
            state.client = null;
            state.map.remove();
          }
          state.map = new maplibregl.Map({ container, style, center: point(view.clientLocation ?? this.customer), zoom: 14 });
          state.mapInstanceId += 1;
          state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
          await new Promise((resolve, reject) => { state.map.once('load', resolve); state.map.once('error', ({ error } = {}) => reject(error ?? new Error('MapLoadError'))); });
          logAmazonLocationDiagnostic('map', true, { status: 200 });
        }
      } catch (error) {
        logAmazonLocationDiagnostic('map', false, amazonLocationFailure(error, 'MapInitializationError'));
        throw error;
      }
      this.setClientLocation(view.clientLocation ?? this.customer);
      this.setProviders(view.technicians ?? [], { selectedId: view.selectedId });
      this.setRadius(view.radiusKm, view.searching);
      if (view.route?.length) this.setRoute(view.route);
      else {
        state.map.getSource('route')?.setData(featureCollection());
        this.fitBounds([view.clientLocation ?? this.customer, ...(view.technicians ?? [])].filter(Boolean));
      }
    },
    setClientLocation(location) {
      if (!location || !state.map) return;
      this.customer = location;
      if (!state.client) {
        const element = documentObject.createElement('div');
        element.className = 'amazon-client-marker';
        element.setAttribute('aria-label', 'Vị trí của bạn');
        element.textContent = '⌂';
        state.client = new globalThis.maplibregl.Marker({ element }).setLngLat(point(location)).setPopup(new globalThis.maplibregl.Popup().setText('Vị trí của bạn')).addTo(state.map);
      }
      else state.client.setLngLat(point(location));
    },
    setProviders(technicians, { selectedId } = {}) {
      if (!state.map) return;
      const visible = new Set(technicians.map(({ id }) => id));
      state.markers.forEach((marker, id) => { if (!visible.has(id)) { marker.remove(); state.markers.delete(id); state.markerDiagnostics.delete(id); } });
      technicians.forEach((technician) => {
        let marker = state.markers.get(technician.id);
        if (!marker) {
          const element = documentObject.createElement('button');
          element.className = 'amazon-technician-marker'; element.type = 'button'; element.dataset.mapTechnician = technician.id; element.textContent = technician.initials;
          marker = new globalThis.maplibregl.Marker({ element, offset: [18, -18] }).setLngLat(point(technician)).setPopup(new globalThis.maplibregl.Popup({ offset: 18 }).setText(technician.name)).addTo(state.map);
          state.markers.set(technician.id, marker);
          state.markerDiagnostics.set(technician.id, { instanceId: state.nextMarkerInstanceId++, position: { latitude: technician.latitude, longitude: technician.longitude }, updatedAt: Date.now(), moves: 0 });
        }
        marker.setLngLat(point(technician));
        const diagnostic=state.markerDiagnostics.get(technician.id);
        if(diagnostic){diagnostic.position={latitude:technician.latitude,longitude:technician.longitude};diagnostic.updatedAt=Date.now();}
        marker.getElement().classList.toggle('is-selected', technician.id === selectedId);
      });
    },
    setRadius(radiusKm = 0, searching = false) {
      if (!state.map || !this.customer) return;
      const circle = Array.from({ length: 65 }, (_, index) => { const angle = index * Math.PI * 2 / 64; return [this.customer.longitude + Math.cos(angle) * radiusKm / (111.32 * Math.cos(this.customer.latitude * Math.PI / 180)), this.customer.latitude + Math.sin(angle) * radiusKm / 110.574]; });
      const data = featureCollection([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle] }, properties: {} }]);
      if (!state.map.getSource('search-radius')) { state.map.addSource('search-radius', { type: 'geojson', data }); state.map.addLayer({ id: 'search-radius-fill', type: 'fill', source: 'search-radius', paint: { 'fill-color': '#087b61', 'fill-opacity': searching ? .13 : .06 } }); state.map.addLayer({ id: 'search-radius-line', type: 'line', source: 'search-radius', paint: { 'line-color': '#087b61', 'line-width': 2, 'line-opacity': .65 } }); }
      else {
        state.map.getSource('search-radius').setData(data);
        state.map.setPaintProperty('search-radius-fill', 'fill-opacity', searching ? .13 : .06);
      }
      const bounds = circle.reduce((value, coordinate) => value.extend(coordinate), new globalThis.maplibregl.LngLatBounds(circle[0], circle[0]));
      state.map.fitBounds(bounds, { padding: 45, maxZoom: 14, duration: searching ? 500 : 0 });
    },
    moveProvider(id, location) {
      const marker=state.markers.get(id);if(!marker||!location)return false;
      marker.setLngLat(point(location));
      const diagnostic=state.markerDiagnostics.get(id);
      if(diagnostic){
        const moved=diagnostic.position?.latitude!==location.latitude||diagnostic.position?.longitude!==location.longitude;
        diagnostic.position={latitude:location.latitude,longitude:location.longitude};diagnostic.updatedAt=Date.now();
        if(moved)diagnostic.moves+=1;
      }
      return true;
    },
    getProviderMarkerSnapshot(id) {
      const marker=state.markers.get(id);const diagnostic=state.markerDiagnostics.get(id);
      if(!marker||!diagnostic)return null;
      return { ...diagnostic, position:{...diagnostic.position}, mapInstanceId:state.mapInstanceId, markerCount:state.markers.size, attached:marker.getElement?.().isConnected!==false };
    },
    resize() { state.map?.resize(); },
    setRoute(points, { fit = true } = {}) {
      if (!state.map) return;
      const data = featureCollection([{ type: 'Feature', geometry: { type: 'LineString', coordinates: points.map(point) }, properties: {} }]);
      if (!state.map.getSource('route')) { state.map.addSource('route', { type: 'geojson', data }); state.map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#087b61', 'line-width': 4, 'line-opacity': .9 } }); } else state.map.getSource('route').setData(data);
      if (fit) this.fitBounds(points);
    },
    center(location) { state.map?.flyTo({ center: point(location), zoom: 14 }); },
    fitBounds(points) { if (!points.length) return; const bounds = points.reduce((value, item) => value.extend(point(item)), new globalThis.maplibregl.LngLatBounds(point(points[0]), point(points[0]))); state.map?.fitBounds(bounds, { padding: 70, maxZoom: 16 }); },
  };
  return provider;
}
