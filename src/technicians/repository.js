import { mockTechnicians } from './mock-technicians.js';

export const defaultMvpLocation = { city: 'Nha Trang', province: 'Khánh Hòa' };

// Même contrat pour la future géolocalisation, adresse utilisateur ou API cartographique.
export function createMockTechnicianRepository(data = mockTechnicians) {
  return {
    async list({ location = defaultMvpLocation } = {}) {
      void location;
      return data.map((technician) => ({ ...technician }));
    },
  };
}

