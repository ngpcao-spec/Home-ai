import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';
import { mockProviderDashboard } from './mock-provider-data.js';

const clone = (value) => structuredClone(value);
export function createMockProviderAppRepository(seed = mockProviderDashboard) {
  let state = clone(seed);
  let services = clone(seed.services ?? [{
    id: 'provider-service-demo', providerId: seed.provider?.id ?? 'provider-demo',
    serviceCategory: 'electricity', pricingModel: 'hourly', hourlyRate: 300000,
    minimumCharge: 400000, currency: 'VND', enabled: true,
  }]);
  return Object.freeze({
    source: 'mock', async load() { return clone(state); },
    async setAvailability(next) { state.status = { ...state.status, ...next }; return clone(state); },
    async updateLocation(position) { state.status = { ...state.status, ...position, lastLocationAt: new Date().toISOString() }; return clone(state); },
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
    async startIntervention(missionId) {
      const pricing=state.assignment?.pricing??services.find(({serviceCategory})=>serviceCategory===state.assignment?.serviceCategory)??services[0];
      const hourlyReady=pricing?.pricingModel==='hourly'&&state.assignment?.status==='arrived';
      const quoteReady=state.assignment?.quote?.status==='accepted';
      if(state.assignment?.id!==missionId||(!hourlyReady&&!quoteReady))throw new Error('Mission is not ready to start');
      state.assignment={...state.assignment,status:'in_progress',pricing};return clone(state);
    },
    async submitHourlyInvoice(missionId, invoice) {
      if (state.assignment?.id !== missionId) throw new Error('Mission is not in progress');
      if (state.assignment.invoice) {
        if (state.assignment.invoice.workedMinutes === invoice.workedMinutes && state.assignment.invoice.materialAmount === invoice.materialAmount) return clone(state);
        throw new Error('Mission invoice was already submitted');
      }
      if (state.assignment.status !== 'in_progress') throw new Error('Mission is not in progress');
      state.assignment = { ...state.assignment, status: 'completed_pending_payment',
        finalAuthorizedAmount: invoice.totalAmount, invoice: { ...invoice, id: 'invoice-demo', missionId } };
      return clone(state);
    },
    async createSupplement(id, discovery) {
      const parent = state.assignment?.quote;
      if(state.assignment?.id !== id || state.assignment.status !== 'in_progress' || parent?.status !== 'accepted') throw new Error('Accepted intervention required');
      state.assignment = { ...state.assignment, status: 'supplement_pending', quote: {
        id: `quote-demo-v${parent.version + 1}`, parentQuoteId: parent.id,
        version: parent.version + 1, status: 'supplement_pending', diagnosis: discovery.finding,
        totalAmount: parent.totalAmount + discovery.additionalPartsAmount + discovery.additionalLaborAmount,
      } };
      return clone(state);
    },
    async getHistory() { return clone(state.history ?? []); },
    async getServices() { return clone(services); },
    async setServicePricing(serviceCategory, pricing) {
      const index = services.findIndex((service) => service.serviceCategory === serviceCategory);
      if (index < 0) throw new Error('Provider service not found');
      services[index] = { ...services[index], pricingModel: 'hourly', ...pricing };
      return clone(services[index]);
    },
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
    const [quote, billing] = await Promise.all([
      repositories.offers.getCurrentProviderQuoteState(),
      repositories.offers.getCurrentProviderBillingState(dashboard.assignment.id),
    ]);
    return { ...dashboard, assignment: { ...dashboard.assignment, quote,
      pricing: billing.pricing ?? null, invoice: billing.invoice ?? null } };
  };
  return Object.freeze({
    source: 'supabase', load: loadDashboard,
    subscribeDispatch(onChange, onStatus) {
      return repositories.offers.subscribeProviderDispatch(initial.provider.id, onChange, onStatus);
    },
    async setAvailability(next) { await repositories.offers.setProviderAvailability(next); return loadDashboard(); },
    async updateLocation(position) { await repositories.offers.updateProviderLocation(position); return loadDashboard(); },
    async accept(id) { await repositories.offers.acceptCurrentProviderOffer(id); return loadDashboard(); },
    async decline(id) { await repositories.offers.declineCurrentProviderOffer(id); return loadDashboard(); },
    async updateMissionProgress(id, status, location) { await repositories.offers.updateProviderMissionProgress(id, status, location); return loadDashboard(); },
    async createQuote(id, draft) { await repositories.offers.createCurrentProviderQuote(id, draft); return loadDashboard(); },
    async startIntervention(id) { const current=await loadDashboard(); await repositories.offers.startIntervention(id,current.assignment.version); return loadDashboard(); },
    async submitHourlyInvoice(id, invoice) { const current=await loadDashboard(); await repositories.offers.submitHourlyInvoice(id,current.assignment.version,invoice); return loadDashboard(); },
    async createSupplement(id, discovery) {
      const current = await loadDashboard();
      if(current.assignment?.id !== id || current.assignment.status !== 'in_progress') throw new Error('Intervention required');
      if(current.assignment.quote?.id !== discovery.parentQuoteId) throw new Error('Accepted quote changed during editing');
      await repositories.offers.createCurrentProviderSupplement(id, current.assignment.quote, discovery);
      return loadDashboard();
    },
    async getHistory() {
      const history = await repositories.offers.getMissionHistory();
      const clientIds = [...new Set(history.map(({ clientId }) => clientId).filter(Boolean))];
      const clients = await Promise.all(clientIds.map(async (clientId) => [clientId, await repositories.profiles.getById(clientId)]));
      const names = new Map(clients.map(([clientId, profile]) => [clientId, profile?.name]));
      return history.map((mission) => ({ ...mission, clientName: names.get(mission.clientId) ?? null }));
    },
    async getServices() { return repositories.offers.listCurrentProviderServices(initial.provider.id); },
    async setServicePricing(serviceCategory, pricing) {
      return repositories.offers.setCurrentProviderServicePricing(serviceCategory, pricing);
    },
  });
}
