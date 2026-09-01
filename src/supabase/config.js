const trim = (value) => String(value ?? '').trim();

const decodeJwtPayload = (token) => {
  const encoded = token.split('.')[1];
  if (!encoded) return null;
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export function readSupabaseConfig(runtimeConfig = globalThis.__HOME_AI_CONFIG__) {
  const url = trim(runtimeConfig?.SUPABASE_URL);
  const anonKey = trim(runtimeConfig?.SUPABASE_ANON_KEY);

  if (!url && !anonKey) return null;
  if (!url || !anonKey) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL is invalid');
  }
  if (parsedUrl.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS');

  const jwtRole = decodeJwtPayload(anonKey)?.role;
  if (anonKey.startsWith('sb_secret_') || jwtRole === 'service_role') {
    throw new Error('A service_role key must never be used in the browser');
  }

  return Object.freeze({ url: parsedUrl.toString().replace(/\/$/, ''), anonKey });
}

export const isSupabaseConfigured = (runtimeConfig) => readSupabaseConfig(runtimeConfig) !== null;
