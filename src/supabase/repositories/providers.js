import { adaptMatchingProviderRow, adaptProviderRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const providerColumns = `
  provider_id, kyc_status, specialty, experience_years, service_radius_km,
  rating_average, review_count, completed_jobs, reliability_score, description,
  languages, active,
  profiles!provider_profiles_provider_id_fkey(display_name, avatar_url)
`;

export function createSupabaseProvidersRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async getById(providerId) {
      const result = await client.from('provider_profiles')
        .select(providerColumns)
        .eq('provider_id', providerId)
        .maybeSingle();
      return adaptProviderRow(unwrap(result, 'providers.getById'));
    },
    async listVerified() {
      const result = await client.from('provider_profiles')
        .select(providerColumns)
        .eq('active', true)
        .eq('kyc_status', 'verified')
        .order('rating_average', { ascending: false });
      return Object.freeze((unwrap(result, 'providers.listVerified') ?? []).map(adaptProviderRow));
    },
    async listServices(providerId) {
      const result = await client.from('provider_services')
        .select('id, provider_id, service_category, base_price, currency, enabled')
        .eq('provider_id', providerId)
        .eq('enabled', true);
      return Object.freeze([...(unwrap(result, 'providers.listServices') ?? [])]);
    },
    async listMatchingCandidates({ serviceCategory, latitude, longitude, limit = 20 }) {
      const result = await client.rpc('get_matching_provider_candidates', {
        requested_service_category: serviceCategory,
        customer_latitude: latitude,
        customer_longitude: longitude,
        candidate_limit: limit,
      });
      return Object.freeze((unwrap(result, 'providers.listMatchingCandidates') ?? []).map(adaptMatchingProviderRow));
    },
  });
}
