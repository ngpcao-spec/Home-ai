import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';
import { mockProviderDashboard } from './mock-provider-data.js';

const clone = (value) => structuredClone(value);
export function createMockProviderAppRepository(seed = mockProviderDashboard) {
  let state = clone(seed);
  return Object.freeze({
    source: 'mock', async load() { return clone(state); },
    async setAvailability(next) { state.status = { ...state.status, ...next }; return clone(state); },
    async accept(offerId) {
      const offer = state.offers.find(({ id }) => id === offerId);
      if (!offer) throw new Error('Offer unavailable');
      state.assignment = { id: offer.missionId, serviceCategory: offer.serviceCategory, request: offer.request, address: offer.address ?? offer.approximateAddress, clientLocation: offer.clientLocation ?? { latitude: 12.2315, longitude: 109.1902 }, providerLocation: { latitude: 12.2388, longitude: 109.1967 }, status: 'accepted', acceptedAt: new Date().toISOString() };
      state.offers = state.offers.filter(({ id }) => id === offerId).map((item) => ({ ...item, status: 'accepted' }));
      state.status = { ...state.status, available: false };
      return clone(state);
    },
    async decline(offerId) { state.offers = state.offers.filter(({ id }) => id !== offerId); return clone(state); },
    async updateMissionProgress(missionId, status, location) {
      if (state.assignment?.id !== missionId) throw new Error('Mission unavailable');
      const allowed = state.assignment.status === 'accepted' && status === 'travelling'
        || state.assignment.status === 'travelling' && status === 'arrived';
      if (!allowed) throw new Error('Invalid mission transition');
      state.assignment = { ...state.assignment, status, providerLocation: location ?? state.assignment.providerLocation };
      state.status = { ...state.status, lastLocationAt: new Date().toISOString() };
      return clone(state);
    },
    async createQuote(missionId, draft) {
      if (state.assignment?.id !== missionId || state.assignment.status !== 'arrived' || state.assignment.quote?.status === 'accepted') throw new Error('Mission is not ready for diagnosis');
      const laborAmount = Number(draft.laborAmount); const partsAmount = Number(draft.partsAmount);
      if (!draft.diagnosis?.trim() || laborAmount < 0 || partsAmount < 0) throw new Error('Invalid quote');
      const version = (state.assignment.quote?.version ?? 0) + 1;
      const quote = { id: `quote-demo-v${version}`, version, status: 'pending', diagnosis: draft.diagnosis.trim(), warrantyDays: Number(draft.warrantyDays) || 0, totalAmount: laborAmount + partsAmount, items: [
        { itemType: 'labor', description: draft.laborDescription || 'Công kiểm tra và sửa chữa', amount: laborAmount },
        { itemType: 'part', description: draft.partsDescription || 'Linh kiện dự kiến', amount: partsAmount },
      ] };
      state.assignment = { ...state.assignment, status: 'quote_pending', quote };
      return clone(state);
    },
    async startIntervention(missionId) { if (state.assignment?.id !== missionId || state.assignment.quote?.status !== 'accepted') throw new Error('Accepted quote required'); state.assignment.status='in_progress'; return clone(state); },
    async finishIntervention(missionId) { if (state.assignment?.id !== missionId || state.assignment.status !== 'in_progress') throw new Error('Mission is not in progress'); state.assignment.status='completed_pending_payment'; return clone(state); },
    async getHistory() { return clone(state.history ?? []); },
  });
}

export async function createProgressiveProviderAppRepository(runtimeConfig = globalThis.__HOME_AI_CONFIG__, fallback = createMockProviderAppRepository(), repositoryFactory = createOptionalSupabaseRepositories) {
  const repositories = repositoryFactory(runtimeConfig);
  if (!repositories.enabled) return fallback;
  const { data, error } = await repositories.client.auth.getUser();
  if (error) throw error;
  if (!data?.user) return fallback;
  const initial = await repositories.offers.getProviderDashboard();
  if (!initial?.provider?.id) throw new Error('Authenticated provider is not provisioned');
  const loadDashboard = async () => {
    const dashboard = await repositories.offers.getProviderDashboard();
    if (!dashboard.assignment) return dashboard;
    const quote = await repositories.offers.getCurrentProviderQuoteState();
    return { ...dashboard, assignment: { ...dashboard.assignment, quote } };
  };
  return Object.freeze({
    source: 'supabase', load: loadDashboard,
    async setAvailability(next) { await repositories.offers.setProviderAvailability(next); return loadDashboard(); },
    async accept(id) { await repositories.offers.acceptCurrentProviderOffer(id); return loadDashboard(); },
    async decline(id) { await repositories.offers.declineCurrentProviderOffer(id); return loadDashboard(); },
    async updateMissionProgress(id, status, location) { await repositories.offers.updateProviderMissionProgress(id, status, location); return loadDashboard(); },
    async createQuote(id, draft) { await repositories.offers.createCurrentProviderQuote(id, draft); return loadDashboard(); },
    async startIntervention(id) { const current=await loadDashboard(); await repositories.offers.startIntervention(id,current.assignment.version); return loadDashboard(); },
    async finishIntervention(id) { const current=await loadDashboard(); await repositories.offers.finishIntervention(id,current.assignment.version); return loadDashboard(); },
    async getHistory() { return repositories.offers.getMissionHistory(); },
  });
}
