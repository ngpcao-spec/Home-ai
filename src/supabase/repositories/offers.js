import { adaptInvoiceRow, adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';
import { analyzeProviderActivity } from '../../provider/provider-activity-ai.js';

const adaptProviderService = (row) => Object.freeze({
  id: row.id, providerId: row.provider_id, serviceCategory: row.service_category,
  activityName: row.activity_name ?? null, activityDescription: row.activity_description ?? null,
  legacyBasePrice: row.base_price == null ? null : Number(row.base_price),
  pricingModel: row.pricing_model, hourlyRate: row.hourly_rate == null ? null : Number(row.hourly_rate),
  minimumCharge: row.minimum_charge == null ? null : Number(row.minimum_charge), currency: row.currency, enabled: row.enabled,
});

export function createSupabaseOffersRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async getProviderDashboard() {
      return Object.freeze({ ...(unwrap(await client.rpc('get_current_provider_dashboard'), 'offers.getProviderDashboard') ?? {}) });
    },
    async getCurrentProviderQuoteState() {
      return unwrap(await client.rpc('get_current_provider_quote_state'), 'offers.getCurrentProviderQuoteState');
    },
    async acceptCurrentProviderOffer(offerId) {
      const result = await client.rpc('accept_current_provider_offer', { target_offer_id: offerId });
      return adaptMissionRow(unwrap(result, 'offers.acceptCurrentProviderOffer'));
    },
    async declineCurrentProviderOffer(offerId) {
      return unwrap(await client.rpc('decline_current_provider_offer', { target_offer_id: offerId }), 'offers.declineCurrentProviderOffer');
    },
    subscribeProviderDispatch(providerId, onChange, onStatus = () => {}) {
      const channel = client.channel(`provider-dispatch:${providerId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'mission_offers',
          filter: `provider_id=eq.${providerId}`,
        }, onChange)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'missions',
        }, onChange)
        .subscribe(onStatus);
      return () => client.removeChannel(channel);
    },
    async setProviderAvailability({ online }) {
      return unwrap(await client.rpc('set_current_provider_availability', {
        new_online: online, new_available: online,
      }), 'offers.setProviderAvailability');
    },
    async getCurrentProviderBillingState(missionId) {
      return Object.freeze({ ...(unwrap(await client.rpc('get_current_provider_billing_state', {
        target_mission_id: missionId,
      }), 'offers.getCurrentProviderBillingState') ?? {}) });
    },
    async listCurrentProviderServices(providerId) {
      const rows = unwrap(await client.from('provider_services')
        .select('id,provider_id,service_category,activity_name,activity_description,base_price,pricing_model,hourly_rate,minimum_charge,currency,enabled')
        .eq('provider_id', providerId)
        .order('service_category'), 'offers.listCurrentProviderServices') ?? [];
      return Object.freeze(rows.map(adaptProviderService));
    },
    async setCurrentProviderServicePricing(serviceCategory, { hourlyRate, minimumCharge }) {
      const row = unwrap(await client.rpc('set_current_provider_service_hourly_pricing', {
        target_service_category: serviceCategory,
        new_hourly_rate: Number(hourlyRate),
        new_minimum_charge: Number(minimumCharge),
      }), 'offers.setCurrentProviderServicePricing');
      return adaptProviderService(row);
    },
    async analyzeCurrentProviderActivity(input) {
      return analyzeProviderActivity(client, input);
    },
    async getCurrentProviderHourlyRateReference(serviceCategory) {
      const value = unwrap(await client.rpc('get_current_provider_hourly_rate_reference', {
        target_service_category: serviceCategory,
      }), 'offers.getCurrentProviderHourlyRateReference') ?? {};
      return Object.freeze({
        medianHourlyRate: value.median_hourly_rate == null ? null : Number(value.median_hourly_rate),
        providerCount: Number(value.provider_count) || 0,
      });
    },
    async createCurrentProviderActivity(proposal, pricing) {
      const row = unwrap(await client.rpc('create_current_provider_activity', {
        target_service_category: proposal.serviceCategory,
        new_activity_name: proposal.activityName,
        new_activity_description: proposal.description,
        new_pricing_model: proposal.pricingModel,
        new_hourly_rate: Number(pricing.hourlyRate),
        new_minimum_charge: Number(pricing.minimumCharge),
      }), 'offers.createCurrentProviderActivity');
      return adaptProviderService(row);
    },
    async updateProviderLocation({ latitude, longitude }) {
      return unwrap(await client.rpc('update_current_provider_location', {
        new_latitude: latitude, new_longitude: longitude,
      }), 'offers.updateProviderLocation');
    },
    async updateProviderMissionProgress(missionId, status, { latitude, longitude }) {
      return unwrap(await client.rpc('update_current_provider_mission_progress', {
        target_mission_id: missionId, new_status: status,
        new_latitude: latitude, new_longitude: longitude,
      }), 'offers.updateProviderMissionProgress');
    },
    async createCurrentProviderQuote(missionId, draft) {
      const diagnosis = draft.diagnosis?.trim() || 'Không cung cấp chẩn đoán';
      const items = [
        { item_type: 'labor', description: draft.laborDescription, amount: Number(draft.laborAmount), position: 1 },
        { item_type: 'part', description: draft.partsDescription, amount: Number(draft.partsAmount), position: 2 },
      ];
      return unwrap(await client.rpc('create_current_provider_quote_version', {
        target_mission_id: missionId, new_diagnosis: diagnosis,
        new_warranty_days: Number(draft.warrantyDays || 0), new_items: items, target_parent_quote_id: null,
      }), 'offers.createCurrentProviderQuote');
    },
    async createCurrentProviderSupplement(missionId, parent, discovery) {
      if (parent?.status !== 'accepted') throw new Error('Accepted parent required');
      return unwrap(await client.rpc('create_current_provider_quote_version', {
        target_mission_id: missionId, target_parent_quote_id: parent.id,
        new_diagnosis: discovery.finding, new_warranty_days: discovery.warrantyDays ?? parent.warrantyDays,
        new_items: [
          { item_type: 'service', description: `Công việc đã chấp nhận V${parent.version}`, amount: Number(parent.totalAmount) },
          { item_type: 'part', description: discovery.finding, amount: discovery.additionalPartsAmount },
          { item_type: 'labor', description: 'Công bổ sung', amount: discovery.additionalLaborAmount },
        ],
      }), 'offers.createCurrentProviderSupplement');
    },
    async startIntervention(missionId, version) {
      return adaptMissionRow(unwrap(await client.rpc('start_current_provider_intervention', {
        target_mission_id: missionId, expected_version: version,
      }), 'offers.startIntervention'));
    },
    async finishIntervention(missionId, version) {
      return adaptMissionRow(unwrap(await client.rpc('finish_current_provider_intervention', {
        target_mission_id: missionId, expected_version: version,
      }), 'offers.finishIntervention'));
    },
    async submitHourlyInvoice(missionId, version, invoice) {
      return adaptInvoiceRow(unwrap(await client.rpc('submit_current_provider_hourly_invoice', {
        target_mission_id: missionId, expected_version: version,
        new_worked_hours: invoice.hours, new_worked_minutes: invoice.minutes,
        new_material_amount: invoice.materialAmount,
      }), 'offers.submitHourlyInvoice'));
    },
    async getMissionHistory() {
      return Object.freeze([...(unwrap(await client.rpc('get_current_user_mission_history'), 'offers.getMissionHistory') ?? [])]);
    },
  });
}
