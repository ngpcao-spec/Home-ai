import { adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

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
    async expireCurrentProviderOffer(offerId) {
      return unwrap(await client.rpc('expire_current_mission_offer_and_rematch', {
        target_offer_id: offerId,
      }), 'offers.expireCurrentProviderOffer');
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
    async setProviderAvailability({ online, available, latitude = null, longitude = null }) {
      return unwrap(await client.rpc('set_current_provider_availability', {
        new_online: online, new_available: available,
        new_latitude: latitude, new_longitude: longitude,
      }), 'offers.setProviderAvailability');
    },
    async updateProviderMissionProgress(missionId, status, { latitude, longitude }) {
      return unwrap(await client.rpc('update_current_provider_mission_progress', {
        target_mission_id: missionId, new_status: status,
        new_latitude: latitude, new_longitude: longitude,
      }), 'offers.updateProviderMissionProgress');
    },
    async createCurrentProviderQuote(missionId, draft) {
      const items = [
        { item_type: 'labor', description: draft.laborDescription, amount: Number(draft.laborAmount), position: 1 },
        { item_type: 'part', description: draft.partsDescription, amount: Number(draft.partsAmount), position: 2 },
      ];
      return unwrap(await client.rpc('create_current_provider_quote_version', {
        target_mission_id: missionId, new_diagnosis: draft.diagnosis,
        new_warranty_days: Number(draft.warrantyDays), new_items: items, target_parent_quote_id: null,
      }), 'offers.createCurrentProviderQuote');
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
    async getMissionHistory() {
      return Object.freeze([...(unwrap(await client.rpc('get_current_user_mission_history'), 'offers.getMissionHistory') ?? [])]);
    },
  });
}
