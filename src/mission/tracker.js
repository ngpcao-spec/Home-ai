export const missionStatuses = [
  { id: 'accepted', label: 'Đã nhận yêu cầu' },
  { id: 'travelling', label: 'Đang di chuyển' },
  { id: 'arrived', label: 'Đã đến nơi' },
  { id: 'repairing', label: 'Đang sửa chữa' },
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
