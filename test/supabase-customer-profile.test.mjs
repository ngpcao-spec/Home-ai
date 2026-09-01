import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCustomerProfile } from '../src/customer/profile.js';
import { loadSupabaseCustomerProfile } from '../src/customer/supabase-profile.js';

const configuredRuntime = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-browser-key',
};

describe('lecture optionnelle du profil client Supabase', () => {
  it('ne charge aucun SDK et conserve exactement le mock sans configuration', async () => {
    const fallbackProfile = createCustomerProfile();
    let repositoryLoaded = false;
    const result = await loadSupabaseCustomerProfile({
      fallbackProfile,
      runtimeConfig: {},
      repositoryLoader: async () => { repositoryLoaded = true; },
    });
    assert.equal(repositoryLoaded, false);
    assert.equal(result.profile, fallbackProfile);
    assert.equal(result.source, 'mock');
    assert.equal(result.reason, 'not-configured');
  });

  it('conserve le mock quand aucune session ou ligne profile n’existe', async () => {
    const fallbackProfile = createCustomerProfile();
    const result = await loadSupabaseCustomerProfile({
      fallbackProfile,
      runtimeConfig: configuredRuntime,
      repositoryLoader: async () => ({
        enabled: true,
        profiles: { getCurrent: async () => null },
      }),
    });
    assert.equal(result.profile, fallbackProfile);
    assert.equal(result.reason, 'no-session-or-profile');
  });

  it('lit le repository préparé et fusionne le profil du customer authentifié', async () => {
    const fallbackProfile = createCustomerProfile();
    const calls = [];
    const result = await loadSupabaseCustomerProfile({
      fallbackProfile,
      runtimeConfig: configuredRuntime,
      repositoryLoader: async () => ({
        enabled: true,
        profiles: {
          getCurrent: async () => {
            calls.push('getCurrent');
            return { id: 'real-1', role: 'customer', name: 'Lê Mai', avatarUrl: null };
          },
          getPhone: async (id) => { calls.push(['getPhone', id]); return '+84987654321'; },
        },
      }),
    });
    assert.deepEqual(calls, ['getCurrent', ['getPhone', 'real-1']]);
    assert.equal(result.source, 'supabase');
    assert.equal(result.profile.name, 'Lê Mai');
    assert.equal(result.profile.phone, '+84987654321');
  });

  it('gère une erreur de lecture par un fallback sans la propager', async () => {
    const fallbackProfile = createCustomerProfile();
    const result = await loadSupabaseCustomerProfile({
      fallbackProfile,
      runtimeConfig: configuredRuntime,
      repositoryLoader: async () => ({
        enabled: true,
        profiles: { getCurrent: async () => { throw new Error('network unavailable'); } },
      }),
    });
    assert.equal(result.profile, fallbackProfile);
    assert.equal(result.source, 'mock');
    assert.equal(result.reason, 'error');
    assert.match(result.error.message, /network unavailable/);
  });
});
