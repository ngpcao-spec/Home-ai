import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { force: true, recursive: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
// Amazon Location browser API keys are public identifiers, but must be restricted
// by HTTP referrer and allowed actions. Never print the value or inject server secrets.
const mapsKey = process.env.AMAZON_LOCATION_API_KEY ?? '';
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? '';
if (process.env.CI && !mapsKey.trim()) throw new Error('AMAZON_LOCATION_API_KEY is required for the production build');
if (Boolean(supabaseUrl.trim()) !== Boolean(supabaseAnonKey.trim())) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured together');
}
await writeFile('dist/src/runtime-config.js', `globalThis.__HOME_AI_CONFIG__ = Object.freeze({
  AMAZON_LOCATION_API_KEY: ${JSON.stringify(mapsKey)},
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)},
});\n`);

console.log(`Build terminé dans dist/ (Amazon Location: ${mapsKey.trim() ? 'configured' : 'not configured'}; Supabase: ${supabaseUrl.trim() ? 'configured' : 'mock fallback'}).`);
