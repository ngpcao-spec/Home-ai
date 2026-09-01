import { mergeCustomerProfile, replaceCustomerAddresses } from './profile.js';
import { readSupabaseConfig } from '../supabase/config.js';

const defaultRepositoryLoader = async (runtimeConfig) => {
  const { createOptionalSupabaseRepositories } = await import('../supabase/repositories/index.js');
  return createOptionalSupabaseRepositories(runtimeConfig);
};

export async function loadSupabaseCustomerProfile({
  fallbackProfile,
  runtimeConfig = globalThis.__HOME_AI_CONFIG__,
  repositoryLoader = defaultRepositoryLoader,
} = {}) {
  try {
    if (!readSupabaseConfig(runtimeConfig)) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-configured', persistence: null });
    }

    const repositories = await repositoryLoader(runtimeConfig);
    if (!repositories?.enabled || !repositories.profiles) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-configured', persistence: null });
    }

    const currentUserId = await repositories.profiles.getCurrentUserId();
    if (!currentUserId) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'no-session', persistence: null });
    }
    const remoteProfile = await repositories.profiles.getById(currentUserId);
    if (!remoteProfile) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'no-profile', persistence: repositories });
    }
    if (remoteProfile.role !== 'customer') {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-customer', persistence: null });
    }

    let phone;
    try {
      phone = await repositories.profiles.getPhone(remoteProfile.id);
    } catch {
      // The safe profile row is still useful if the optional phone RPC is unavailable.
    }
    const addresses = repositories.addresses ? await repositories.addresses.listCurrent() : null;
    const merged = mergeCustomerProfile(fallbackProfile, remoteProfile, phone);
    return Object.freeze({
      profile: addresses ? replaceCustomerAddresses(merged, addresses) : merged,
      source: 'supabase',
      reason: null,
      persistence: repositories,
    });
  } catch (error) {
    return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'error', error, persistence: null });
  }
}
