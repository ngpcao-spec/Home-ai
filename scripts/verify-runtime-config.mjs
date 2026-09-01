import { readFile } from 'node:fs/promises';

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

const runtimeKey = readRuntimeString('AMAZON_LOCATION_API_KEY');
const runtimeSupabaseUrl = readRuntimeString('SUPABASE_URL');
const runtimeSupabaseAnonKey = readRuntimeString('SUPABASE_ANON_KEY');

const expectedKey = process.env.AMAZON_LOCATION_API_KEY?.trim() ?? '';
if (!expectedKey) throw new Error('AMAZON_LOCATION_API_KEY is not configured');
if (!runtimeKey) throw new Error('Production runtime configuration is empty');
if (runtimeKey !== expectedKey) throw new Error('Production runtime configuration does not match the build environment');

const expectedSupabaseUrl = process.env.SUPABASE_URL?.trim() ?? '';
const expectedSupabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? '';
if (Boolean(expectedSupabaseUrl) !== Boolean(expectedSupabaseAnonKey)) {
  throw new Error('Supabase build configuration must contain both public values');
}
if (Boolean(runtimeSupabaseUrl) !== Boolean(runtimeSupabaseAnonKey)) {
  throw new Error('Supabase runtime configuration is incomplete');
}
if (runtimeSupabaseUrl !== expectedSupabaseUrl || runtimeSupabaseAnonKey !== expectedSupabaseAnonKey) {
  throw new Error('Supabase runtime configuration does not match the build environment');
}

console.log(`Runtime configuration verified (values redacted; Supabase: ${runtimeSupabaseUrl ? 'configured' : 'mock fallback'}).`);
