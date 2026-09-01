import { mergeCustomerProfile } from './profile.js';
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
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-configured' });
    }

    const repositories = await repositoryLoader(runtimeConfig);
    if (!repositories?.enabled || !repositories.profiles) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-configured' });
    }

    const remoteProfile = await repositories.profiles.getCurrent();
    if (!remoteProfile) {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'no-session-or-profile' });
    }
    if (remoteProfile.role !== 'customer') {
      return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'not-customer' });
    }

    let phone;
    try {
      phone = await repositories.profiles.getPhone(remoteProfile.id);
    } catch {
      // The safe profile row is still useful if the optional phone RPC is unavailable.
    }
    return Object.freeze({
      profile: mergeCustomerProfile(fallbackProfile, remoteProfile, phone),
      source: 'supabase',
      reason: null,
    });
  } catch (error) {
    return Object.freeze({ profile: fallbackProfile, source: 'mock', reason: 'error', error });
  }
}
