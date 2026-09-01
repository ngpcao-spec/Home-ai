import { readSupabaseConfig } from '../supabase/config.js';

const defaultRepositoryLoader = async (runtimeConfig) => {
  const { createOptionalSupabaseRepositories } = await import('../supabase/repositories/index.js');
  return createOptionalSupabaseRepositories(runtimeConfig);
};

export function createCustomerMissionDraft({ diagnosis, problemDescription, serviceCategory, address, location, scheduledFor = null }) {
  return Object.freeze({
    serviceCategory,
    problemDescription: String(problemDescription ?? diagnosis.summary).trim(),
    diagnosticSummary: diagnosis.summary,
    addressId: null,
    address: String(address).trim(),
    clientLocation: Object.freeze({ latitude: location.latitude, longitude: location.longitude }),
    scheduledFor,
  });
}

export async function connectSupabaseCustomerMissions({
  runtimeConfig = globalThis.__HOME_AI_CONFIG__, repositoryLoader = defaultRepositoryLoader,
} = {}) {
  try {
    if (!readSupabaseConfig(runtimeConfig)) return Object.freeze({ source: 'mock', reason: 'not-configured' });
    const repositories = await repositoryLoader(runtimeConfig);
    const userId = await repositories.profiles.getCurrentUserId();
    if (!userId) return Object.freeze({ source: 'mock', reason: 'no-session' });
    return Object.freeze({
      source: 'supabase',
      repository: repositories.missions,
      activeMission: await repositories.missions.getActiveCurrent(),
    });
  } catch (error) {
    return Object.freeze({ source: 'error', reason: 'repository-error', error });
  }
}
