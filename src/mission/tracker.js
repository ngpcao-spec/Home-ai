export const missionStatuses = [
  { id: 'accepted', label: 'Đã nhận yêu cầu' },
  { id: 'travelling', label: 'Đang di chuyển' },
  { id: 'arrived', label: 'Đã đến nơi' },
  { id: 'in_progress', label: 'Đang sửa chữa' },
  { id: 'completed_pending_payment', label: 'Hoàn thành' },
];

export function createMissionState() {
  return {
    statusIndex: 0,
    missionStatus: 'accepted',
    paymentStatus: 'unpaid',
    paidAt: null,
    reviewStage: 'hidden',
    interventionPhase: 'idle',
    quote: null,
    quoteHistory: [],
    completion: null,
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

export function startMissionDiagnosis(state, quote) {
  if (missionStatuses[state.statusIndex].id !== 'arrived' || !quote) return state;
  const version = createInitialQuoteVersion(quote);
  return {
    ...state,
    statusIndex: missionStatuses.findIndex(({ id }) => id === 'in_progress'),
    interventionPhase: 'quote_pending',
    quote: version,
    quoteHistory: [version],
  };
}

export function decideRepairQuote(state, decision) {
  if (state.interventionPhase !== 'quote_pending' || !['accepted', 'declined'].includes(decision)) return state;
  const version = decideInitialQuoteVersion(state.quoteHistory[0], decision);
  return {
    ...state,
    interventionPhase: decision === 'accepted' ? 'repairing' : 'quote_declined',
    quote: version,
    quoteHistory: [version],
  };
}

export function discoverMissionSupplement(state) {
  if (state.interventionPhase !== 'repairing' || state.quoteHistory.length !== 1) return state;
  const version = createSupplementQuoteVersion(state.quoteHistory[0]);
  if (!version) return state;
  return { ...state, quoteHistory: [...state.quoteHistory, version] };
}

export function decideMissionSupplement(state, decision) {
  const version = state.quoteHistory[1];
  const decidedVersion = decideSupplementQuoteVersion(version, decision);
  if (decidedVersion === version) return state;
  return { ...state, quoteHistory: [state.quoteHistory[0], decidedVersion] };
}

export const getAuthorizedMissionTotal = (state) => getAuthorizedQuoteTotal(state.quoteHistory);

export function completeMissionRepair(state, metadata = {}) {
  if (missionStatuses[state.statusIndex].id !== 'in_progress' || state.interventionPhase !== 'repairing') return state;
  if (state.quoteHistory.some(({ status }) => status === 'supplement_pending')) return state;
  const acceptedVersions = state.quoteHistory.filter(({ status }) => status === 'accepted');
  const acceptedQuote = acceptedVersions.at(-1);
  const initialQuote = state.quoteHistory[0];
  if (!acceptedQuote || initialQuote?.status !== 'accepted') return state;
  const completedWork = [
    ...initialQuote.recommendedTasks,
    ...acceptedVersions.slice(1).flatMap(({ authorizedWork = [] }) => authorizedWork),
  ];
  return {
    ...state,
    statusIndex: missionStatuses.findIndex(({ id }) => id === 'completed_pending_payment'),
    missionStatus: 'completed_pending_payment',
    interventionPhase: 'completed',
    completion: Object.freeze({
      missionId: metadata.missionId ?? 'HOMEAI-DEMO-001',
      completedAt: metadata.completedAt ?? new Date().toISOString(),
      completedWork: Object.freeze(completedWork),
      acceptedQuoteId: acceptedQuote.id,
      finalAuthorizedAmount: getAuthorizedMissionTotal(state),
      currency: 'VND',
      warrantyDays: initialQuote.warrantyDays,
    }),
  };
}

export function completeExternalPayment(state, metadata = {}) {
  if (state.missionStatus !== 'completed_pending_payment' || !state.completion) return state;
  return {
    ...state,
    missionStatus: 'completed',
    paymentStatus: 'paid_external',
    paidAt: metadata.paidAt ?? new Date().toISOString(),
    reviewStage: 'payment_confirmed',
  };
}

export function openProviderReview(state) {
  if (state.missionStatus !== 'completed' || state.paymentStatus !== 'paid_external') return state;
  return { ...state, reviewStage: 'rating' };
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
  if (missionStatuses[state.statusIndex].id !== 'completed_pending_payment') return state;
  return { ...state, completionConfirmed: true };
}

export function submitReview(state, rating) {
  if (!(state.completionConfirmed || state.paymentStatus === 'paid_external') || !Number.isInteger(rating) || rating < 1 || rating > 5) return state;
  return { ...state, rating, reviewSent: true };
}
import {
  createInitialQuoteVersion,
  createSupplementQuoteVersion,
  decideInitialQuoteVersion,
  decideSupplementQuoteVersion,
  getAuthorizedQuoteTotal,
} from './quote-versioning.js';
