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
});
