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
      state.assignment = { id: offer.missionId, serviceCategory: offer.serviceCategory, request: offer.request, address: offer.approximateAddress, status: 'accepted', acceptedAt: new Date().toISOString() };
      state.offers = state.offers.filter(({ id }) => id === offerId).map((item) => ({ ...item, status: 'accepted' }));
      state.status = { ...state.status, available: false };
      return clone(state);
    },
    async decline(offerId) { state.offers = state.offers.filter(({ id }) => id !== offerId); return clone(state); },
  });
}

export async function createProgressiveProviderAppRepository(runtimeConfig = globalThis.__HOME_AI_CONFIG__, fallback = createMockProviderAppRepository()) {
  const repositories = createOptionalSupabaseRepositories(runtimeConfig);
  if (!repositories.enabled) return fallback;
  try {
    const { data } = await repositories.client.auth.getSession();
    if (!data?.session?.user) return fallback;
    const initial = await repositories.offers.getProviderDashboard();
    if (!initial?.provider?.id) return fallback;
    return Object.freeze({
      source: 'supabase', async load() { return repositories.offers.getProviderDashboard(); },
      async setAvailability(next) { await repositories.offers.setProviderAvailability(next); return repositories.offers.getProviderDashboard(); },
      async accept(id) { await repositories.offers.acceptCurrentProviderOffer(id); return repositories.offers.getProviderDashboard(); },
      async decline(id) { await repositories.offers.declineCurrentProviderOffer(id); return repositories.offers.getProviderDashboard(); },
    });
  } catch { return fallback; }
}
