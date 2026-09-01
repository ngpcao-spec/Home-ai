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
) {
  const repositories = createOptionalSupabaseRepositories(runtimeConfig);
  return Object.freeze({
    async list({ location = defaultMvpLocation, serviceCategory } = {}) {
      if (!repositories.enabled || !serviceCategory
          || !Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
        return fallback.list({ location });
      }
      try {
        return await repositories.providers.listMatchingCandidates({
          serviceCategory,
          latitude: location.latitude,
          longitude: location.longitude,
        });
      } catch {
        return fallback.list({ location });
      }
    },
  });
}
