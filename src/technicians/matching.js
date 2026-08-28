const isImmediatelyAvailable = ({ availability }) => availability === 'Đang sẵn sàng';
export const DEFAULT_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

export function isLocationFresh(technician, now = Date.now(), maxAgeMs = DEFAULT_LOCATION_MAX_AGE_MS) {
  if (!technician.lastLocationAt) return true; // compatibility with legacy/API records
  const timestamp = Date.parse(technician.lastLocationAt);
  return Number.isFinite(timestamp) && now - timestamp <= maxAgeMs;
}

export function isEligibleTechnician(technician, categoryId, { now = Date.now(), maxLocationAgeMs = DEFAULT_LOCATION_MAX_AGE_MS } = {}) {
  return technician.category === categoryId
    && technician.verified !== false
    && technician.online !== false
    && technician.available !== false
    && (technician.serviceRadiusKm == null || technician.distanceKm <= technician.serviceRadiusKm)
    && isLocationFresh(technician, now, maxLocationAgeMs);
}

// Deterministic only: filtering and ranking never involve the diagnostic LLM.
export function rankTechnicians(technicians, categoryId, options) {
  return technicians.filter((item) => isEligibleTechnician(item, categoryId, options)).toSorted((a, b) =>
    (a.estimatedArrivalMinutes ?? Infinity) - (b.estimatedArrivalMinutes ?? Infinity)
    || a.distanceKm - b.distanceKm
    || b.rating - a.rating
    || b.completedJobs - a.completedJobs
    || Number(isImmediatelyAvailable(b)) - Number(isImmediatelyAvailable(a))
    || a.id.localeCompare(b.id));
}

export function findBestTechnicians(technicians, categoryId, limit = 3) { return rankTechnicians(technicians, categoryId).slice(0, limit); }
export function getMatchReasons(technician) {
  const reasons = [];
  if (technician.distanceKm <= 2.5) reasons.push('Gần bạn');
  if (isImmediatelyAvailable(technician)) reasons.push('Đang sẵn sàng');
  if (technician.rating >= 4.8) reasons.push('Đánh giá cao');
  if (technician.completedJobs >= 200) reasons.push('Nhiều kinh nghiệm');
  return reasons.slice(0, 4);
}
