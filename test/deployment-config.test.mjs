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

  it('limite le mode arrivée GitHub Pages au seul provider de test autorisé',async()=>{
    const [workflow,build,verify,runtime,providerApp]=await Promise.all([
      readFile(new URL('../.github/workflows/deploy-pages.yml',import.meta.url),'utf8'),
      readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8'),
      readFile(new URL('../scripts/verify-runtime-config.mjs',import.meta.url),'utf8'),
      readFile(new URL('../src/runtime-config.js',import.meta.url),'utf8'),
      readFile(new URL('../src/provider/provider-app.js',import.meta.url),'utf8'),
    ]);
    assert.match(workflow,/PROVIDER_TEST_MODE: 'true'/);
    assert.match(workflow,/PROVIDER_TEST_PROVIDER_ID: '2040840f-10c6-4acf-a800-1640e1520f4b'/);
    assert.match(workflow,/TODO\(PILOT-BLOCKER\)/);
    assert.match(build,/PROVIDER_TEST_MODE requires the exact authorized test provider/);
    assert.match(build,/PROVIDER_TEST_PROVIDER_ID: \$\{JSON\.stringify/);
    assert.match(build,/providerAppSource\.replace/);
    assert.match(verify,/Provider test mode is not restricted to the authorized test provider/);
    assert.match(runtime,/PROVIDER_TEST_MODE: false/);
    assert.match(runtime,/PROVIDER_TEST_PROVIDER_ID: ''/);
    assert.match(providerApp,/TODO\(PILOT-BLOCKER\)/);
    assert.match(providerApp,/provider\?\.id===TEST_ARRIVAL_PROVIDER_ID/);
    assert.match(providerApp,/provider\?\.name===TEST_ARRIVAL_PROVIDER_NAME/);
  });
});
