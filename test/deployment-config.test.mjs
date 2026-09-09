import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('configuration du déploiement GitHub Pages', () => {
  it('rend les deux valeurs Supabase obligatoires sans les afficher', async () => {
    const workflow = await read('.github/workflows/deploy-pages.yml');
    assert.match(workflow, /test -n "\$SUPABASE_URL"/);
    assert.match(workflow, /test -n "\$SUPABASE_ANON_KEY"/);
    assert.match(workflow, /REQUIRE_SUPABASE_CONFIG: 'true'/);
    assert.doesNotMatch(workflow, /echo "\$SUPABASE_(?:URL|ANON_KEY)"/);
  });

  it('fait échouer build et vérification si la configuration production est vide', async () => {
    const [build, verify] = await Promise.all([
      read('scripts/build.mjs'),
      read('scripts/verify-runtime-config.mjs'),
    ]);
    assert.match(build, /SUPABASE_URL and SUPABASE_ANON_KEY are required for the production build/);
    assert.match(build, /SUPABASE_REQUIRED: \$\{supabaseRequired\}/);
    assert.match(verify, /Supabase production runtime configuration is missing/);
    assert.match(verify, /values redacted/);
  });

  it('interdit le mode test Provider dans tout build de production',async()=>{
    const [build,verify,runtime]=await Promise.all([
      readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8'),
      readFile(new URL('../scripts/verify-runtime-config.mjs',import.meta.url),'utf8'),
      readFile(new URL('../src/runtime-config.js',import.meta.url),'utf8'),
    ]);
    assert.match(build,/providerTestModeRequested && \(process\.env\.CI \|\| supabaseRequired\)/);
    assert.match(build,/PROVIDER_TEST_MODE is forbidden in production builds/);
    assert.match(build,/providerAppSource\.replace/);
    assert.match(verify,/Provider test mode must be disabled in production/);
    assert.match(runtime,/PROVIDER_TEST_MODE: false/);
  });
});
