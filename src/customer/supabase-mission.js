import { readSupabaseConfig } from '../supabase/config.js';
import { createMissionState, missionStatuses } from '../mission/tracker.js';

const defaultRepositoryLoader = async (runtimeConfig) => {
  const { createOptionalSupabaseRepositories } = await import('../supabase/repositories/index.js');
  return createOptionalSupabaseRepositories(runtimeConfig);
};

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
  if (!provider || !mission?.providerId || provider.id !== mission.providerId) return null;
  const name = provider.name || 'Đối tác HOME AI';
  return Object.freeze({
    ...provider,
    initials: name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase(),
    category: mission.serviceCategory,
    categoryLabel: provider.specialty,
    shortDescription: provider.description || provider.specialty,
    verified: provider.verified === true,
    availability: 'Đã nhận nhiệm vụ',
    estimatedArrivalMinutes: null,
    distanceKm: null,
  });
}

export function createCustomerMissionStateFromServer({ mission, quotes }) {
  const state = createMissionState();
  const statusForTimeline = ['requested', 'searching', 'offered'].includes(mission.status) ? 'accepted' : mission.status;
  const timelineStatus = ['quote_pending', 'supplement_pending'].includes(statusForTimeline) ? 'in_progress' : statusForTimeline;
  const statusIndex = missionStatuses.findIndex(({ id }) => id === timelineStatus);
  const quoteHistory = Object.freeze([...(quotes ?? [])]);
  const quote = quoteHistory.at(-1) ?? null;
  const interventionPhase = !quote ? 'idle'
    : quote.status === 'pending' ? 'quote_pending'
      : quote.status === 'declined' ? 'quote_declined'
        : mission.status === 'quote_pending' ? 'quote_accepted'
          : quote.status === 'accepted' ? 'repairing' : 'idle';
  return {
    ...state,
    statusIndex: Math.max(0, statusIndex),
    missionStatus: mission.status,
    paymentStatus: mission.paymentStatus,
    interventionPhase,
    quote,
    quoteHistory,
  };
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
    return Object.freeze({
      source: 'supabase',
      repository: repositories.missions,
      providerRepository: repositories.providers,
      activeMission: await repositories.missions.getActiveCurrent(),
    });
  } catch (error) {
    return Object.freeze({ source: 'error', reason: 'repository-error', error });
  }
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
    const [provider, quotes, offers] = await Promise.all([
      mission.providerId ? providerRepository.getById(mission.providerId) : null,
      missionRepository.getQuoteHistory(mission.id),
      missionRepository.getOffers?.(mission.id) ?? [],
    ]);
    if (mission.providerId && !provider) throw new Error('Prestataire assigné introuvable');
    return Object.freeze({ mission, provider, quotes, offers });
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

  const createOrResume = async (draft, activeMission, { now = Date.now(), reuseWindowMs = 300000 } = {}) => {
    const requestedAt = new Date(activeMission?.requestedAt ?? '').getTime();
    const reusable = activeMission && ['requested', 'searching', 'offered'].includes(activeMission.status)
      && Number.isFinite(requestedAt) && now - requestedAt >= 0 && now - requestedAt <= reuseWindowMs;
    if (!reusable) return create(draft, { replaceMission: activeMission });
    if (dispatchPromise) return dispatchPromise;
    dispatchPromise = (async () => {
      await missionRepository.createOffers(activeMission.id);
      return load(activeMission.id);
    })().finally(() => { dispatchPromise = undefined; });
    return dispatchPromise;
  };

  const decideQuote = async (quoteId, decision) => {
    if (!['accepted', 'declined'].includes(decision)) throw new TypeError('Invalid customer quote decision');
    const quote = await missionRepository.decideCurrentQuote(quoteId, decision);
    return load(quote.missionId);
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

  return Object.freeze({ load, create, createOrResume, decideQuote, poll, subscribe });
}
