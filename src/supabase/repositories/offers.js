import { adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

export function createSupabaseOffersRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async getProviderDashboard() {
      return Object.freeze({ ...(unwrap(await client.rpc('get_current_provider_dashboard'), 'offers.getProviderDashboard') ?? {}) });
    },
    async acceptCurrentProviderOffer(offerId) {
      const result = await client.rpc('accept_current_provider_offer', { target_offer_id: offerId });
      return adaptMissionRow(unwrap(result, 'offers.acceptCurrentProviderOffer'));
    },
    async declineCurrentProviderOffer(offerId) {
      return unwrap(await client.rpc('decline_current_provider_offer', { target_offer_id: offerId }), 'offers.declineCurrentProviderOffer');
    },
    async setProviderAvailability({ online, available, latitude = null, longitude = null }) {
      return unwrap(await client.rpc('set_current_provider_availability', {
        new_online: online, new_available: available,
        new_latitude: latitude, new_longitude: longitude,
      }), 'offers.setProviderAvailability');
    },
  });
}
