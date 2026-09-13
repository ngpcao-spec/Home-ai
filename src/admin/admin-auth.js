import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from '../supabase/config.js';
import { createAdminRepository } from './admin-repository.js';

export const adminSessionStorageKey = 'home-ai-admin-auth-v1';
export const adminOAuthRedirectTo = 'https://ngpcao-spec.github.io/Home-ai/admin/';

export function createAdminAuth(runtimeConfig = globalThis.__HOME_AI_CONFIG__, clientFactory = createClient) {
  const config = readSupabaseConfig(runtimeConfig);
  if (!config) throw new Error('Configuration Supabase Admin manquante.');
  const client = clientFactory(config.url, config.anonKey, {
    auth: { storageKey: adminSessionStorageKey, persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: true, flowType: 'pkce' },
    global: { headers: { 'X-Client-Info': 'home-ai-admin-web' } },
  });
  return Object.freeze({
    createRepository: () => createAdminRepository(client, config.url),
    async resume() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error('Impossible de restaurer la session Admin.');
      if (!data?.session?.user?.id) return Object.freeze({ state: 'login' });
      const result = await client.auth.getUser();
      if (result.error || !result.data?.user || result.data.user.id !== data.session.user.id) {
        return Object.freeze({ state: 'denied' });
      }
      const access = await client.rpc('require_current_admin');
      if (access.error?.code === '42501') return Object.freeze({ state: 'denied' });
      if (access.error) throw new Error('Impossible de vérifier les droits Admin.');
      if (access.data?.authorized !== true || access.data.userId !== result.data.user.id) {
        return Object.freeze({ state: 'denied' });
      }
      return Object.freeze({ state: 'authorized', userId: access.data.userId });
    },
    async signIn() {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google',
        options: { redirectTo: adminOAuthRedirectTo, queryParams: { prompt: 'select_account' } } });
      if (error) throw new Error('Connexion Google indisponible.');
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new Error('Déconnexion impossible. Veuillez réessayer.');
    },
  });
}
