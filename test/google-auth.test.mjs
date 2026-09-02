import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGoogleCustomerAuth, googleOAuthRedirectTo } from '../src/customer/google-auth.js';
import { createLoginMarkup } from '../src/onboarding/flow.js';
import {
  createMockCustomerSession,
  googleOAuthAttemptStorageKey,
  markGoogleOAuthAttempt,
  resolveCustomerStartupSession,
  saveCustomerSession,
} from '../src/customer/session.js';

const runtime = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

describe('C03 Google Auth Supabase', () => {
  const createStorage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  it('affiche Google sans supprimer le téléphone et OTP mock', () => {
    const markup = createLoginMarkup();
    assert.match(markup, /Continuer avec Google/);
    assert.match(markup, /data-google-login/);
    assert.match(markup, /data-login-phone-form/);
    assert.match(markup, /123456/);
  });

  it('démarre OAuth Google avec le redirect GitHub Pages exact', async () => {
    const calls = [];
    const auth = createGoogleCustomerAuth(runtime, () => ({
      enabled: true,
      client: { auth: { signInWithOAuth: async (input) => { calls.push(input); return { data: { url: 'google' }, error: null }; } } },
      profiles: {},
    }));
    await auth.signIn();
    assert.equal(googleOAuthRedirectTo, 'https://ngpcao-spec.github.io/Home-ai/');
    assert.deepEqual(calls, [{ provider: 'google', options: { redirectTo: googleOAuthRedirectTo } }]);
  });

  it('reprend une session OAuth et crée automatiquement le profil customer manquant', async () => {
    const saved = [];
    const user = { id: 'u1', email: 'mai@example.com', user_metadata: { full_name: 'Lê Mai', avatar_url: 'https://example.com/avatar.png' } };
    const auth = createGoogleCustomerAuth(runtime, () => ({
      enabled: true,
      client: { auth: { getSession: async () => ({ data: { session: { user } }, error: null }) } },
      profiles: {
        getById: async () => null,
        saveCurrent: async (profile) => { saved.push(profile); return { id: 'u1', role: 'customer', name: profile.name }; },
      },
    }));
    const resumed = await auth.resume();
    assert.equal(resumed.authenticated, true);
    assert.equal(resumed.profile.role, 'customer');
    assert.deepEqual(saved, [{ name: 'Lê Mai', phone: null, avatarUrl: 'https://example.com/avatar.png' }]);
  });

  it('charge un profil customer existant sans le remplacer', async () => {
    let saves = 0;
    const user = { id: 'u1', email: 'mai@example.com', user_metadata: {} };
    const profile = { id: 'u1', role: 'customer', name: 'Lê Mai' };
    const auth = createGoogleCustomerAuth(runtime, () => ({
      enabled: true,
      client: { auth: { getSession: async () => ({ data: { session: { user } }, error: null }) } },
      profiles: { getById: async () => profile, saveCurrent: async () => { saves += 1; } },
    }));
    assert.equal((await auth.resume()).profile, profile);
    assert.equal(saves, 0);
  });

  it('déconnecte la session Supabase réelle', async () => {
    let signedOut = 0;
    const auth = createGoogleCustomerAuth(runtime, () => ({
      enabled: true,
      client: { auth: { signOut: async () => { signedOut += 1; return { error: null }; } } },
      profiles: {},
    }));
    await auth.signOut();
    assert.equal(signedOut, 1);
  });

  it('reste sans réseau ni SDK lorsque Supabase est désactivé', async () => {
    const auth = createGoogleCustomerAuth({}, () => ({ enabled: false, client: null }));
    assert.equal(auth.enabled, false);
    assert.equal(await auth.resume(), null);
    await auth.signOut();
  });

  it('n’ouvre jamais C04 après un retour Google sans vraie session Supabase', () => {
    const storage = createStorage();
    saveCustomerSession(storage, createMockCustomerSession('+84901234567'));
    markGoogleOAuthAttempt(storage);

    const startup = resolveCustomerStartupSession(storage, false);

    assert.deepEqual(startup, { authenticated: false, kind: null, oauthFailed: true });
    assert.equal(storage.getItem(googleOAuthAttemptStorageKey), null);
    assert.equal(storage.getItem('customerSession'), null);
  });

  it('ouvre C04 après le retour Google uniquement avec une session Supabase réelle', () => {
    const storage = createStorage();
    markGoogleOAuthAttempt(storage);

    const startup = resolveCustomerStartupSession(storage, true);

    assert.deepEqual(startup, { authenticated: true, kind: 'supabase-google', oauthFailed: false });
    assert.equal(storage.getItem(googleOAuthAttemptStorageKey), null);
  });
});
