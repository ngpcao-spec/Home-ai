import { readFile } from 'node:fs/promises';
import { VAPID_PUBLIC_KEY } from '../supabase/functions/_shared/provider-push-config.js';

const runtimeConfigPath = 'dist/src/runtime-config.js';

let source;
try {
  source = await readFile(runtimeConfigPath, 'utf8');
} catch {
  throw new Error('Production runtime configuration file is missing');
}

const readRuntimeString = (name) => {
  const assignment = source.match(new RegExp(`${name}\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  try {
    return assignment ? JSON.parse(assignment[1]).trim() : '';
  } catch {
    throw new Error('Production runtime configuration is invalid');
  }
};
const readRuntimeBoolean = (name) => source.match(new RegExp(`${name}\\s*:\\s*(true|false)`))?.[1] === 'true';

const runtimeKey = readRuntimeString('AMAZON_LOCATION_API_KEY');
const runtimeSupabaseUrl = readRuntimeString('SUPABASE_URL');
const runtimeSupabaseAnonKey = readRuntimeString('SUPABASE_ANON_KEY');
const runtimeSupabaseRequired = readRuntimeBoolean('SUPABASE_REQUIRED');
const runtimeProviderTestMode = readRuntimeBoolean('PROVIDER_TEST_MODE');
const runtimeProviderTestProviderId = readRuntimeString('PROVIDER_TEST_PROVIDER_ID');
const runtimeVapidPublicKey = readRuntimeString('VAPID_PUBLIC_KEY');

const expectedKey = process.env.AMAZON_LOCATION_API_KEY?.trim() ?? '';
if (!expectedKey) throw new Error('AMAZON_LOCATION_API_KEY is not configured');
if (!runtimeKey) throw new Error('Production runtime configuration is empty');
if (runtimeKey !== expectedKey) throw new Error('Production runtime configuration does not match the build environment');

const expectedSupabaseUrl = process.env.SUPABASE_URL?.trim() ?? '';
const expectedSupabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? '';
const supabaseRequired = process.env.REQUIRE_SUPABASE_CONFIG === 'true';
if (supabaseRequired && (!expectedSupabaseUrl || !expectedSupabaseAnonKey)) {
  throw new Error('Supabase production build configuration is missing');
}
if (supabaseRequired && (!runtimeSupabaseUrl || !runtimeSupabaseAnonKey || !runtimeSupabaseRequired)) {
  throw new Error('Supabase production runtime configuration is missing');
}
if (Boolean(expectedSupabaseUrl) !== Boolean(expectedSupabaseAnonKey)) {
  throw new Error('Supabase build configuration must contain both public values');
}
if (Boolean(runtimeSupabaseUrl) !== Boolean(runtimeSupabaseAnonKey)) {
  throw new Error('Supabase runtime configuration is incomplete');
}
if (runtimeSupabaseUrl !== expectedSupabaseUrl || runtimeSupabaseAnonKey !== expectedSupabaseAnonKey) {
  throw new Error('Supabase runtime configuration does not match the build environment');
}
const expectedProviderTestMode = process.env.PROVIDER_TEST_MODE === 'true';
const expectedProviderTestProviderId = process.env.PROVIDER_TEST_PROVIDER_ID?.trim() ?? '';
const allowedProviderTestId = '2040840f-10c6-4acf-a800-1640e1520f4b';
if (runtimeProviderTestMode !== expectedProviderTestMode
  || (runtimeProviderTestMode && (runtimeProviderTestProviderId !== allowedProviderTestId
    || expectedProviderTestProviderId !== allowedProviderTestId))) {
  throw new Error('Provider test mode is not restricted to the authorized test provider');
}
const requestedVapidPublicKey=process.env.VAPID_PUBLIC_KEY?.trim()??'';
if(requestedVapidPublicKey&&requestedVapidPublicKey!==VAPID_PUBLIC_KEY)throw new Error('VAPID public key does not match the canonical HOME AI key');
if(runtimeVapidPublicKey!==VAPID_PUBLIC_KEY)throw new Error('VAPID public key is missing or does not match the canonical HOME AI key');

console.log(`Runtime configuration verified (values redacted; Supabase: ${runtimeSupabaseUrl ? 'configured' : 'local fallback only'}).`);
