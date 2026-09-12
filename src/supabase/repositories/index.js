import { getSupabaseBrowserClient } from '../client.js';
import { createSupabaseMissionsRepository } from './missions.js';
import { createSupabaseProfilesRepository } from './profiles.js';
import { createSupabaseProvidersRepository } from './providers.js';
import { createSupabaseCustomerAddressesRepository } from './customer-addresses.js';
import { createSupabaseOffersRepository } from './offers.js';
import { createMissionCallRepository, createStringeeTokenProvider } from '../../calls/mission-call-repository.js';

export function createOptionalSupabaseRepositories(runtimeConfig = globalThis.__HOME_AI_CONFIG__) {
  const client = getSupabaseBrowserClient(runtimeConfig);
  if (!client) {
    return Object.freeze({ enabled: false, client: null, profiles: null, addresses: null, missions: null, providers: null, offers: null, missionCalls: null, stringeeTokens: null });
  }

  return Object.freeze({
    enabled: true,
    client,
    profiles: createSupabaseProfilesRepository(client),
    addresses: createSupabaseCustomerAddressesRepository(client),
    missions: createSupabaseMissionsRepository(client),
    providers: createSupabaseProvidersRepository(client),
    offers: createSupabaseOffersRepository(client),
    missionCalls: createMissionCallRepository(client),
    stringeeTokens: createStringeeTokenProvider(client),
  });
}
