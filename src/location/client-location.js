import { nhaTrangFallbackLocation } from '../map/map-provider.js';

export function getClientLocation(geolocation = globalThis.navigator?.geolocation, now = () => new Date()) {
  if (!geolocation) return Promise.resolve({ ...nhaTrangFallbackLocation, updatedAt: now().toISOString() });
  return new Promise((resolve) => geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? null, source: 'browser', updatedAt: now().toISOString(), label: 'Vị trí của bạn' }),
    () => resolve({ ...nhaTrangFallbackLocation, updatedAt: now().toISOString() }),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  ));
}
