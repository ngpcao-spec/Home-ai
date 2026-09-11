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
  const adaptProfessionalProfile = (value = {}) => Object.freeze({
    id: value.providerId,
    providerId: value.providerId,
    name: value.name ?? '',
    avatarUrl: value.avatarPath
      ? client.storage.from('provider-avatars').getPublicUrl(value.avatarPath).data.publicUrl
      : null,
    verified: value.verified === true,
    rating: Number(value.ratingAverage) || 0,
    reviewCount: Number(value.reviewCount) || 0,
    experienceYears: value.experienceYears == null ? null : Number(value.experienceYears),
    introduction: value.introduction ?? '',
    phone: value.phone ?? null,
    activities: Object.freeze([...(value.activities ?? [])].map(activity => Object.freeze({ ...activity }))),
    reviews: Object.freeze([]),
    professional: true,
  });
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
    async getProfessionalProfile(providerId, missionId = null) {
      const result = await client.rpc('get_provider_professional_profile', {
        target_provider_id: providerId,
        target_mission_id: missionId,
      });
      return adaptProfessionalProfile(unwrap(result, 'providers.getProfessionalProfile'));
    },
    async getAssignedContact(providerId) {
      const result = await client.rpc('get_profile_phone', { target_user_id: providerId });
      return Object.freeze({ phone: unwrap(result, 'providers.getAssignedContact') ?? null });
    },
  });
}
