import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('cache PWA Provider', () => {
  it('ne met jamais en cache les assets Client ou la configuration runtime', async () => {
    const source = await readFile(new URL('../provider-sw.js', import.meta.url), 'utf8');
    const assetBlock = source.match(/const OFFLINE_ASSETS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    assert.doesNotMatch(assetBlock, /runtime-config\.js/);
    assert.doesNotMatch(assetBlock, /src\/app\.js/);
    assert.match(source, /!offlinePaths\.has\(url\.pathname\)/);
  });

  it('versionne le cache par déploiement et supprime les anciens caches Provider', async () => {
    const source = await readFile(new URL('../provider-sw.js', import.meta.url), 'utf8');
    assert.match(source, /__HOME_AI_BUILD_ID__/);
    assert.match(source, /key\.startsWith\(CACHE_PREFIX\)/);
    assert.match(source, /self\.skipWaiting\(\)/);
    assert.match(source, /self\.clients\.claim\(\)/);
  });

  it('revalide le worker et cache-buste les entrées critiques du build', async () => {
    const [providerApp, build] = await Promise.all([
      readFile(new URL('../src/provider/provider-app.js', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'),
    ]);
    assert.match(providerApp, /updateViaCache:\s*'none'/);
    assert.match(build, /process\.env\.GITHUB_SHA/);
    assert.match(build, /runtime-config\.js\?v=/);
  });
});
