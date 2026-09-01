import { getSupabaseBrowserClient } from '../client.js';
import { createSupabaseMissionsRepository } from './missions.js';
import { createSupabaseProfilesRepository } from './profiles.js';
import { createSupabaseProvidersRepository } from './providers.js';

export function createOptionalSupabaseRepositories(runtimeConfig = globalThis.__HOME_AI_CONFIG__) {
  const client = getSupabaseBrowserClient(runtimeConfig);
  if (!client) {
    return Object.freeze({ enabled: false, client: null, profiles: null, missions: null, providers: null });
  }

  return Object.freeze({
    enabled: true,
    client,
    profiles: createSupabaseProfilesRepository(client),
    missions: createSupabaseMissionsRepository(client),
    providers: createSupabaseProvidersRepository(client),
  });
}
