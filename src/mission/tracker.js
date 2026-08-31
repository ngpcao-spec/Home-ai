export const missionStatuses = [
  { id: 'accepted', label: 'Đã nhận yêu cầu' },
  { id: 'travelling', label: 'Đang di chuyển' },
  { id: 'arrived', label: 'Đã đến nơi' },
  { id: 'in_progress', label: 'Đang sửa chữa' },
  { id: 'completed', label: 'Hoàn thành' },
];

export function createMissionState() {
  return {
    statusIndex: 0,
    supplement: { amount: 120000, reason: 'Cần thay linh kiện bị hỏng', decision: 'pending', requested: false },
    completionConfirmed: false,
    rating: 0,
    reviewSent: false,
  };
}

export function advanceMission(state) {
  return { ...state, statusIndex: Math.min(state.statusIndex + 1, missionStatuses.length - 1) };
}

export function markMissionArrived(state) {
  if (missionStatuses[state.statusIndex].id !== 'travelling') return state;
  return { ...state, statusIndex: missionStatuses.findIndex(({ id }) => id === 'arrived') };
}

export function startMissionRepair(state) {
  if (missionStatuses[state.statusIndex].id !== 'arrived') return state;
  return { ...state, statusIndex: missionStatuses.findIndex(({ id }) => id === 'in_progress') };
}

export function getMissionProgress(state) {
  return missionStatuses.map((status, index) => ({
    ...status,
    progress: index < state.statusIndex ? 'done' : index === state.statusIndex ? 'active' : 'pending',
  }));
}

export function requestSupplement(state) {
  return { ...state, supplement: { ...state.supplement, requested: true, decision: 'pending' } };
}

export function decideSupplement(state, decision) {
  if (!state.supplement.requested || !['accepted', 'declined'].includes(decision)) return state;
  return { ...state, supplement: { ...state.supplement, decision } };
}

export const getAcceptedSupplement = (state) => (
  state.supplement.requested && state.supplement.decision === 'accepted' ? state.supplement.amount : 0
);

export function confirmCompletion(state) {
  if (missionStatuses[state.statusIndex].id !== 'completed') return state;
  return { ...state, completionConfirmed: true };
}

export function submitReview(state, rating) {
  if (!state.completionConfirmed || !Number.isInteger(rating) || rating < 1 || rating > 5) return state;
  return { ...state, rating, reviewSent: true };
}
