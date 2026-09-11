import { readSupabaseConfig } from '../supabase/config.js';
import { createMissionState, missionStatuses } from '../mission/tracker.js';
import { getCustomerDispatchState } from './dispatch-state.js';

const defaultRepositoryLoader = async (runtimeConfig) => {
  const { createOptionalSupabaseRepositories } = await import('../supabase/repositories/index.js');
  return createOptionalSupabaseRepositories(runtimeConfig);
};

export const resumableMissionStatuses = Object.freeze([
  'requested', 'searching', 'offered', 'accepted', 'travelling', 'arrived',
  'quote_pending', 'in_progress', 'supplement_pending', 'completed_pending_payment', 'completed',
]);

export function createCustomerMissionDraft({ diagnosis, problemDescription, serviceCategory, address, location, scheduledFor = null }) {
  return Object.freeze({
    serviceCategory,
    problemDescription: String(problemDescription ?? diagnosis.summary).trim(),
    diagnosticSummary: diagnosis.summary,
    addressId: null,
    address: String(address).trim(),
    clientLocation: Object.freeze({ latitude: location.latitude, longitude: location.longitude }),
    scheduledFor,
  });
}

export function createAssignedCustomerTechnician(provider, mission) {
  const providerId = provider?.id ?? provider?.providerId;
  if (!provider || !mission?.providerId || providerId !== mission.providerId
      || getCustomerDispatchState({ mission }).phase !== 'accepted') return null;
  const missionActivity = provider.activities?.find(({ serviceCategory }) => serviceCategory === mission.serviceCategory);
  const configuredActivityName = String(missionActivity?.name ?? '').trim();
  const activityName = (configuredActivityName && configuredActivityName.toLowerCase() !== mission.serviceCategory.toLowerCase())
    ? configuredActivityName : ({
    electricity: 'Thợ điện',
    plumbing: 'Thợ sửa ống nước',
    'air-conditioning': 'Thợ điều hòa',
    appliances: 'Thợ sửa điện gia dụng',
  })[mission.serviceCategory] || 'Dịch vụ HOME AI';
  const name = provider.name || 'Đối tác HOME AI';
  return Object.freeze({
    ...provider,
    id: providerId,
    initials: name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase(),
    category: mission.serviceCategory,
    categoryLabel: activityName,
    activityName,
    activityDescription: missionActivity?.description ?? null,
    specialty: activityName,
    shortDescription: provider.introduction || missionActivity?.description || provider.description || activityName,
    verified: provider.verified === true,
    availability: 'Đã nhận nhiệm vụ',
    estimatedArrivalMinutes: null,
    distanceKm: null,
  });
}

export function createCustomerMissionStateFromServer({ mission, quotes, review = null, invoice = null }) {
  const state = createMissionState();
  const statusForTimeline = mission.status === 'completed' ? 'completed_pending_payment' : mission.status;
  const timelineStatus = ['quote_pending', 'supplement_pending'].includes(statusForTimeline) ? 'in_progress' : statusForTimeline;
  const statusIndex = missionStatuses.findIndex(({ id }) => id === timelineStatus);
  const quoteHistory = Object.freeze((quotes ?? []).map(quote => {
    const parent = quotes.find(item => item.id === quote.parentQuoteId);
    return parent ? { ...quote, supplementAmount: quote.totalAmount - parent.totalAmount,
      additionalPartsAmount: quote.items.filter(item => item.type === 'part').reduce((sum,item)=>sum+item.amount,0),
      additionalLaborAmount: quote.items.filter(item => item.type === 'labor').reduce((sum,item)=>sum+item.amount,0) } : quote;
  }));
  const quote = quoteHistory.at(-1) ?? null;
  const acceptedQuote = quoteHistory.filter(({ status }) => status === 'accepted').at(-1) ?? null;
  const completed = ['completed_pending_payment', 'completed'].includes(mission.status);
  const interventionPhase = !quote ? 'idle'
    : quote.status === 'pending' ? 'quote_pending'
      : quote.type === 'supplement' ? 'repairing'
      : quote.status === 'declined' ? 'quote_declined'
        : mission.status === 'quote_pending' ? 'quote_accepted'
          : quote.status === 'accepted' ? 'repairing' : 'idle';
  return {
    ...state,
    statusIndex,
    source: 'supabase',
    missionStatus: mission.status,
    paymentStatus: mission.paymentStatus,
    interventionPhase,
    quote,
    quoteHistory,
    completion: completed && (acceptedQuote || invoice) ? Object.freeze({
      missionId: mission.id,
      completedAt: mission.completedAt,
      completedWork: Object.freeze(quoteHistory
        .filter(({ status }) => status === 'accepted')
        .flatMap(({ recommendedTasks = [] }) => recommendedTasks)),
      acceptedQuoteId: acceptedQuote?.id ?? null,
      finalAuthorizedAmount: invoice?.totalAmount ?? mission.finalAuthorizedAmount,
      currency: invoice?.currency ?? acceptedQuote?.currency ?? mission.currency,
      warrantyDays: acceptedQuote?.warrantyDays ?? null,
      invoice,
    }) : null,
    reviewStage: mission.status === 'completed' ? 'rating' : 'hidden',
    rating: review?.rating ?? 0,
    reviewComment: review?.comment ?? '',
    reviewSent: Boolean(review),
  };
}

export async function decidePendingCustomerSupplement(snapshot, decision, missionSynchronizer) {
  if (!snapshot?.mission?.id || !['accepted', 'rejected'].includes(decision)) {
    throw new TypeError('Invalid customer supplement decision');
  }
  const pending = snapshot.quotes?.find(quote => quote.type === 'supplement'
    && quote.status === 'supplement_pending'
    && quote.missionId === snapshot.mission.id);
  if (!pending) throw new Error('Pending supplement unavailable');
  return missionSynchronizer.decideQuote(pending.id, decision === 'rejected' ? 'declined' : 'accepted');
}

export async function connectSupabaseCustomerMissions({
  runtimeConfig = globalThis.__HOME_AI_CONFIG__, repositoryLoader = defaultRepositoryLoader,
  verifiedUserId = null,
} = {}) {
  try {
    if (!readSupabaseConfig(runtimeConfig)) return Object.freeze({ source: 'mock', reason: 'not-configured' });
    const repositories = await repositoryLoader(runtimeConfig);
    const userId = verifiedUserId ?? await repositories.profiles.getCurrentUserId();
    if (!userId) return Object.freeze({ source: 'mock', reason: 'no-session' });
    const activeMission = await repositories.missions.getActiveCurrent()
      ?? await repositories.missions.getLatestCompletedAwaitingReview?.();
    return Object.freeze({
      source: 'supabase',
      repository: repositories.missions,
      providerRepository: repositories.providers,
      activeMission,
    });
  } catch (error) {
    return Object.freeze({ source: 'error', reason: 'repository-error', error });
  }
}

export async function restoreActiveCustomerMission(connection, {
  scheduleTask = globalThis.setTimeout,
  synchronizerFactory = createCustomerMissionSynchronizer,
} = {}) {
  if (connection?.source !== 'supabase' || !connection.activeMission
      || !resumableMissionStatuses.includes(connection.activeMission.status)) return null;
  const synchronizer = synchronizerFactory({
    missionRepository: connection.repository,
    providerRepository: connection.providerRepository,
    scheduleTask,
  });
  return Object.freeze({
    synchronizer,
    snapshot: await synchronizer.load(connection.activeMission.id),
  });
}

export async function listCustomerMatchingProviders({ connection, technicianRepository, location, serviceCategory }) {
  if (connection?.source === 'supabase') {
    if (!connection.providerRepository) throw new Error('Supabase provider repository unavailable');
    return connection.providerRepository.listMatchingCandidates({
      serviceCategory, latitude: location?.latitude, longitude: location?.longitude,
    });
  }
  if (connection?.reason === 'no-session') {
    const error = new Error('Customer Supabase session required');
    error.code = 'CUSTOMER_SESSION_REQUIRED';
    throw error;
  }
  return technicianRepository.list({ location, serviceCategory });
}

export function createCustomerMissionSynchronizer({
  missionRepository,
  providerRepository,
  scheduleTask = globalThis.setTimeout,
  clearTask = globalThis.clearTimeout,
  intervalMs = 3000,
}) {
  if (!missionRepository || !providerRepository) throw new TypeError('Supabase mission and provider repositories are required');
  let dispatchPromise;

  const load = async (missionId) => {
    const mission = await missionRepository.getById(missionId);
    if (!mission) throw new Error('Mission Supabase introuvable');
    const assigned = mission.providerId && getCustomerDispatchState({ mission }).phase === 'accepted';
    const loadAssignedProvider = () => {
      if (!assigned) return null;
      if (typeof providerRepository.getProfessionalProfile === 'function') return providerRepository.getProfessionalProfile(mission.providerId);
      return providerRepository.getById(mission.providerId);
    };
    const [provider, quotes, offers, providerLocation, review, invoice] = await Promise.all([
      loadAssignedProvider(),
      missionRepository.getQuoteHistory(mission.id),
      missionRepository.getOffers?.(mission.id) ?? [],
      missionRepository.getAssignedProviderLocation?.(mission) ?? null,
      missionRepository.getReview?.(mission.id) ?? null,
      missionRepository.getInvoice?.(mission.id) ?? null,
    ]);
    if (assigned && !provider) throw new Error('Prestataire assigné introuvable');
    return Object.freeze({ mission, provider, quotes, offers, providerLocation, review, invoice });
  };

  const create = (draft, { replaceMission = null } = {}) => {
    if (dispatchPromise) return dispatchPromise;
    dispatchPromise = (async () => {
      if (replaceMission) {
        if (!['requested', 'searching', 'offered'].includes(replaceMission.status)) {
          throw new Error('Une mission déjà attribuée ne peut pas être remplacée');
        }
        await missionRepository.cancelCurrent(replaceMission);
      }
      const mission = await missionRepository.createCurrent(draft);
      await missionRepository.createOffers(mission.id);
      return load(mission.id);
    })().finally(() => { dispatchPromise = undefined; });
    return dispatchPromise;
  };

  const createOrResume = async (draft, activeMission) => {
    if (!activeMission) return create(draft);
    if (!resumableMissionStatuses.includes(activeMission.status)) {
      throw new Error('Existing customer mission cannot be replaced');
    }
    if (dispatchPromise) return dispatchPromise;
    dispatchPromise = (async () => {
      if (['requested', 'searching', 'offered'].includes(activeMission.status)) {
        await missionRepository.createOffers(activeMission.id);
      }
      return load(activeMission.id);
    })().finally(() => { dispatchPromise = undefined; });
    return dispatchPromise;
  };

  const decideQuote = async (quoteId, decision) => {
    if (!['accepted', 'declined'].includes(decision)) throw new TypeError('Invalid customer quote decision');
    const quote = await missionRepository.decideCurrentQuote(quoteId, decision);
    return load(quote.missionId);
  };

  const completeExternalPayment = async (mission) => {
    if (mission.status !== 'completed_pending_payment') throw new Error('Mission is not awaiting external payment');
    const completedMission = await missionRepository.completeExternalPayment(mission);
    return load(completedMission.id);
  };

  const createReview = async (missionId, rating, comment = '') => {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new TypeError('Invalid review rating');
    await missionRepository.createReview(missionId, rating, String(comment).trim() || null);
    return load(missionId);
  };

  const cancelSearch = async (mission) => {
    if (!mission?.id || !['searching', 'offered'].includes(mission.status)) {
      return Object.freeze({ cancelled: false, snapshot: mission?.id ? await load(mission.id) : null });
    }
    try {
      const cancelledMission = await missionRepository.cancelCurrent(mission);
      return Object.freeze({ cancelled: true, snapshot: await load(cancelledMission.id) });
    } catch (error) {
      // An offer may have been accepted while the customer confirmed cancellation.
      // Always return the authoritative state rather than pretending locally that
      // the cancellation succeeded.
      const snapshot = await load(mission.id);
      if (!['searching', 'offered'].includes(snapshot.mission.status)) {
        return Object.freeze({ cancelled: false, snapshot });
      }
      throw error;
    }
  };

  const poll = (missionId, onState, onError) => {
    let stopped = false;
    let timer;
    const run = async () => {
      try {
        const state = await load(missionId);
        if (!stopped) onState(state);
      } catch (error) {
        if (!stopped) onError(error);
      } finally {
        if (!stopped) timer = scheduleTask(run, intervalMs);
      }
    };
    timer = scheduleTask(run, intervalMs);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTask(timer);
    };
  };

  const subscribe = (missionId, onState, onError) => {
    if (typeof missionRepository.subscribeMission !== 'function') return () => {};
    let active = true;
    const receive = async (event) => {
      try {
        const state = await load(missionId);
        if (active) onState(Object.freeze({ ...state, dispatchEvent: event }));
      } catch (error) {
        if (active) onError(error);
      }
    };
    const unsubscribe = missionRepository.subscribeMission(missionId, receive, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError(new Error(`Mission Realtime: ${status}`));
    });
    return () => { active = false; unsubscribe?.(); };
  };

  return Object.freeze({ load, create, createOrResume, decideQuote, completeExternalPayment, createReview, cancelSearch, poll, subscribe });
}
