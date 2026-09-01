import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './config.js';

let cachedClient = null;
let cachedIdentity = '';

export function createSupabaseBrowserClient(runtimeConfig = globalThis.__HOME_AI_CONFIG__) {
  const config = readSupabaseConfig(runtimeConfig);
  if (!config) return null;

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: { headers: { 'X-Client-Info': 'home-ai-web' } },
  });
}

export function getSupabaseBrowserClient(runtimeConfig = globalThis.__HOME_AI_CONFIG__) {
  const config = readSupabaseConfig(runtimeConfig);
  if (!config) {
    cachedClient = null;
    cachedIdentity = '';
    return null;
  }

  const identity = `${config.url}\u0000${config.anonKey}`;
  if (!cachedClient || cachedIdentity !== identity) {
    cachedClient = createSupabaseBrowserClient(runtimeConfig);
    cachedIdentity = identity;
  }
  return cachedClient;
}
