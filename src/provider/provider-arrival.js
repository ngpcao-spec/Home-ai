import { straightLineDistanceKm } from '../routing/routing-provider.js';

export const ARRIVAL_GPS_MAX_AGE_MS = 120000;
export function arrivalAssessment(location, destination, now = Date.now()) {
  const timestamp = Date.parse(location?.updatedAt);
  const valid = location?.source !== 'fallback' && Number.isFinite(timestamp)
    && now - timestamp >= 0 && now - timestamp <= ARRIVAL_GPS_MAX_AGE_MS
    && Number.isFinite(location?.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location?.longitude) && Math.abs(location.longitude) <= 180;
  const distanceKm = valid && destination ? straightLineDistanceKm(location, destination) : null;
  return { location: valid ? location : null, distanceKm, confirmationRequired: distanceKm == null || distanceKm > 0.15 };
}

export function readArrivalLocation(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation) return Promise.resolve(null);
  return new Promise(resolve => geolocation.getCurrentPosition(
    ({ coords, timestamp }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, updatedAt: new Date(timestamp).toISOString(), source: 'browser' }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  ));
}

export function confirmProviderArrival(documentRef, assessment) {
  if (!assessment.confirmationRequired) return Promise.resolve(true);
  const host = documentRef.createElement('div');
  host.className = 'provider-arrival-confirmation';
  host.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="arrival-confirmation-title"><h2 id="arrival-confirmation-title">Xác nhận đã đến</h2><p>${assessment.distanceKm == null ? 'Không thể xác nhận vị trí hiện tại.' : `Vị trí GPS cho thấy bạn vẫn còn cách khách hàng ${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(assessment.distanceKm)} km.`} Bạn có chắc đã đến nơi?</p><div><button type="button" data-arrival-cancel>Quay lại</button><button type="button" data-arrival-confirm>Xác nhận đã đến</button></div></section>`;
  documentRef.body.append(host);
  const previousFocus = documentRef.activeElement;
  return new Promise(resolve => {
    const finish = accepted => { host.remove(); documentRef.removeEventListener('keydown', keydown); previousFocus?.focus(); resolve(accepted); };
    const keydown = event => {
      if (event.key === 'Escape') finish(false);
      if (event.key === 'Tab') { event.preventDefault(); const buttons = host.querySelectorAll('button'); (documentRef.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus(); }
    };
    host.querySelector('[data-arrival-cancel]').onclick = () => finish(false);
    host.querySelector('[data-arrival-confirm]').onclick = () => finish(true);
    documentRef.addEventListener('keydown', keydown);
    host.querySelector('[data-arrival-cancel]').focus();
  });
}
