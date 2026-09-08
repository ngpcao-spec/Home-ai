import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

describe('isolation des Service Workers Client et Provider', () => {
  it('retire le worker racine historique et uniquement ses anciens caches', async () => {
    const source = await read('../provider-sw.js');
    assert.match(source, /home-ai-provider-/);
    assert.match(source, /self\.registration\.unregister\(\)/);
    assert.doesNotMatch(source, /addEventListener\('fetch'/);
  });

  it('limite la nouvelle PWA au répertoire Provider', async () => {
    const [source, app, manifest] = await Promise.all([
      read('../provider/provider-sw.js'), read('../src/provider/provider-app.js'),
      read('../provider/provider-manifest.webmanifest'),
    ]);
    assert.match(source, /home-ai-pwa-provider-/);
    assert.doesNotMatch(source, /runtime-config\.js|src\/app\.js/);
    assert.match(app, /register\('\.\/provider-sw\.js',\{scope:'\.\/'/);
    assert.equal(JSON.parse(manifest).scope, './');
    assert.equal(JSON.parse(manifest).start_url, './');
  });

  it('migre automatiquement le Client Safari sans toucher aux sessions ni boucler', async () => {
    const html = await read('../index.html');
    const cleanup = html.match(/__HOME_AI_CLIENT_CACHE_READY__[\s\S]*?<\/script>/)?.[0] ?? '';
    assert.match(cleanup, /registration\.scope === base\.href/);
    assert.match(cleanup, /endsWith\('\/provider-sw\.js'\)/);
    assert.match(cleanup, /key\.startsWith\('home-ai-provider-'\)/);
    assert.match(cleanup, /home-ai-client-cache-reset-/);
    assert.match(cleanup, /sessionStorage\.getItem\(reloadKey\) !== 'done'/);
    assert.doesNotMatch(cleanup, /localStorage\.(clear|removeItem)|signOut|supabase/i);
  });

  it('versionne les entrées et le worker Provider scoped au build', async () => {
    const build = await read('../scripts/build.mjs');
    assert.match(build, /process\.env\.GITHUB_SHA/);
    assert.match(build, /provider\/provider-sw\.js/);
    assert.match(build, /provider\/index\.html/);
    assert.match(build, /\?v=\$\{buildId\}/);
  });
});
