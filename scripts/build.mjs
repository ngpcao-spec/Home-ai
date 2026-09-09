import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { force: true, recursive: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('provider.html', 'dist/provider.html');
await cp('provider', 'dist/provider', { recursive: true });
await cp('provider-icon.svg', 'dist/provider-icon.svg');
await cp('src', 'dist/src', { recursive: true });
// Amazon Location browser API keys are public identifiers, but must be restricted
// by HTTP referrer and allowed actions. Never print the value or inject server secrets.
const mapsKey = process.env.AMAZON_LOCATION_API_KEY ?? '';
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? '';
const supabaseRequired = process.env.REQUIRE_SUPABASE_CONFIG === 'true';
const providerTestModeRequested = process.env.PROVIDER_TEST_MODE === 'true';
if (providerTestModeRequested && (process.env.CI || supabaseRequired)) {
  throw new Error('PROVIDER_TEST_MODE is forbidden in production builds');
}
const providerTestMode = providerTestModeRequested && !process.env.CI && !supabaseRequired;
const buildId = (process.env.GITHUB_SHA ?? 'local').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'local';
if (process.env.CI && !mapsKey.trim()) throw new Error('AMAZON_LOCATION_API_KEY is required for the production build');
if (Boolean(supabaseUrl.trim()) !== Boolean(supabaseAnonKey.trim())) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured together');
}
if (supabaseRequired && (!supabaseUrl.trim() || !supabaseAnonKey.trim())) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for the production build');
}
await writeFile('dist/src/runtime-config.js', `globalThis.__HOME_AI_CONFIG__ = Object.freeze({
  AMAZON_LOCATION_API_KEY: ${JSON.stringify(mapsKey)},
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)},
  SUPABASE_REQUIRED: ${supabaseRequired},
  PROVIDER_TEST_MODE: ${providerTestMode},
  BUILD_ID: ${JSON.stringify(buildId)},
});\n`);
if (!providerTestMode) {
  const providerAppPath='dist/src/provider/provider-app.js';
  const providerAppSource=await readFile(providerAppPath,'utf8');
  await writeFile(providerAppPath,providerAppSource.replace(/\/\* PROVIDER_TEST_UI_START \*\/[\s\S]*?\/\* PROVIDER_TEST_UI_END \*\//,
    "const testArrivalMarkup='';"));
}

await cp('provider-sw.js', 'dist/provider-sw.js');
const serviceWorkerSource = await readFile('provider/provider-sw.js', 'utf8');
await writeFile('dist/provider/provider-sw.js', serviceWorkerSource.replace('__HOME_AI_BUILD_ID__', buildId));
for (const file of ['index.html', 'provider/index.html']) {
  const path = `dist/${file}`;
  const html = await readFile(path, 'utf8');
  const isClient = file === 'index.html';
  const entry = isClient ? './src/app.js' : '../src/provider/provider-app.js';
  const runtimeConfig = isClient ? './src/runtime-config.js' : '../src/runtime-config.js';
  await writeFile(path, html
    .replace('__HOME_AI_BUILD_ID__', buildId)
    .replace(runtimeConfig, `${runtimeConfig}?v=${buildId}`)
    .replace(entry, `${entry}?v=${buildId}`));
}

console.log(`Build terminé dans dist/ (Amazon Location: ${mapsKey.trim() ? 'configured' : 'not configured'}; Supabase: ${supabaseUrl.trim() ? 'configured' : 'mock fallback'}).`);
