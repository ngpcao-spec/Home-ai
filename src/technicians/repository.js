import { mockTechnicians } from './mock-technicians.js';
import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';

export const defaultMvpLocation = { city: 'Nha Trang', province: 'Khánh Hòa' };

// Même contrat pour la future géolocalisation, adresse utilisateur ou API cartographique.
export function createMockTechnicianRepository(data = mockTechnicians) {
  return {
    async list({ location = defaultMvpLocation } = {}) {
      void location;
      return data.map((technician) => ({
        ...technician,
        kycVerified: technician.verified === true,
        reliabilityScore: technician.reliabilityScore ?? Math.min(99, 90 + Math.floor(technician.rating)),
        indicativePrice: technician.indicativePrice ?? technician.priceFrom,
        categoryLabel: ({ electricity: 'điện', plumbing: 'nước', 'air-conditioning': 'điều hòa', appliances: 'sửa điện gia dụng' })[technician.category],
      }));
    },
  };
}

export function createProgressiveTechnicianRepository(
  runtimeConfig = globalThis.__HOME_AI_CONFIG__,
  fallback = createMockTechnicianRepository(),
  repositoryFactory = createOptionalSupabaseRepositories,
) {
  const repositories = repositoryFactory(runtimeConfig);
  return Object.freeze({
    async list({ location = defaultMvpLocation, serviceCategory } = {}) {
      if (!repositories.enabled) {
        return fallback.list({ location });
      }
      const { data, error } = await repositories.client.auth.getUser();
      if (error) throw error;
      if (!data?.user) {
        return fallback.list({ location });
      }
      if (!serviceCategory || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
        throw new Error('Authenticated matching requires service and coordinates');
      }
      return repositories.providers.listMatchingCandidates({
        serviceCategory,
        latitude: location.latitude,
        longitude: location.longitude,
      });
    },
  });
}
