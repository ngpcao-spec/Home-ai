import { adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

export function createSupabaseOffersRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async acceptCurrentProviderOffer(offerId) {
      const result = await client.rpc('accept_current_provider_offer', { target_offer_id: offerId });
      return adaptMissionRow(unwrap(result, 'offers.acceptCurrentProviderOffer'));
    },
  });
}
