import { rankTechnicians } from '../technicians/matching.js';

export const searchRadiiKm = Object.freeze([2, 5, 10]);

// C08 uses these delays only to make the prototype search understandable. When
// realtime matching is connected, inject realtimeSearchTiming so backend
// results are rendered immediately instead of retaining an artificial wait.
export const prototypeSearchTiming = Object.freeze({
  expandRadiusMs: 1500,
  compareMs: 3000,
  highlightBestMs: 3900,
  completeMs: 4800,
});

export const realtimeSearchTiming = Object.freeze({
  expandRadiusMs: 0,
  compareMs: 0,
  highlightBestMs: 0,
  completeMs: 0,
});

export const isTechnicianAvailable = ({ availability }) =>
  availability === 'Đang sẵn sàng' || availability === 'Có thể nhận việc hôm nay';

export function createSearchPlan(technicians, categoryId, radii = searchRadiiKm) {
  const maximumRadius = radii.at(-1);
  const compatible = rankTechnicians(technicians, categoryId)
    .filter(isTechnicianAvailable)
    .filter(({ distanceKm }) => distanceKm <= maximumRadius);
  const phases = radii.map((radiusKm) => ({
    radiusKm,
    technicians: compatible.filter(({ distanceKm }) => distanceKm <= radiusKm),
  }));
  const successfulPhaseIndex = phases.findIndex(({ technicians: found }) => found.length > 0);
  const visiblePhases = successfulPhaseIndex < 0 ? phases : phases.slice(0, successfulPhaseIndex + 1);
  return { compatible, phases: visiblePhases, selected: compatible[0] ?? null };
}

export function getNextTechnician(technicians, currentId) {
  if (!technicians.length) return null;
  const currentIndex = technicians.findIndex(({ id }) => id === currentId);
  return technicians[(currentIndex + 1) % technicians.length];
}
