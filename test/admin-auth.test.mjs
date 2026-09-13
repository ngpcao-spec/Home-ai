import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { adminSessionStorageKey, adminOAuthRedirectTo, createAdminAuth } from '../src/admin/admin-auth.js';
import { initialiseAdminApp } from '../src/admin/admin-app.js';

const config = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key' };
function harness({ user = { id: 'admin-uuid' }, verifiedUser = user, access = { data: { authorized: true, userId: user?.id }, error: null } } = {}) {
  const calls = [];
  const auth = createAdminAuth(config, (url, key, options) => {
    calls.push({ url, key, options });
    return {
      auth: {
        getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
        getUser: async () => ({ data: { user: verifiedUser }, error: null }),
        signInWithOAuth: async (args) => { calls.push(args); return { error: null }; },
        signOut: async (args) => { calls.push(args); return { error: null }; },
      },
      rpc: async (name, args) => { calls.push({ name, args }); return access; },
    };
  });
  return { auth, calls };
}

test('Admin uses isolated Supabase PKCE session and Google, without shared session logout', async () => {
  const { auth, calls } = harness();
  assert.equal(calls[0].options.auth.storageKey, adminSessionStorageKey);
  assert.equal(calls[0].options.auth.flowType, 'pkce');
  assert.equal(calls[0].options.auth.autoRefreshToken, true);
  assert.equal(calls[0].options.auth.persistSession, true);
  await auth.signIn();
  assert.deepEqual(calls[1], { provider: 'google', options: { redirectTo: adminOAuthRedirectTo, queryParams: { prompt: 'select_account' } } });
  await auth.signOut();
  assert.deepEqual(calls[2], { scope: 'local' });
});

test('Admin UUID is authorized by backend on every reload, never by email or metadata', async () => {
  const { auth, calls } = harness({ user: { id: 'admin-uuid', email: 'unrelated@test.invalid' } });
  for (let reload = 0; reload < 2; reload += 1) assert.deepEqual(await auth.resume(), { state: 'authorized', userId: 'admin-uuid' });
  assert.equal(calls.filter(({ name }) => name === 'require_current_admin').length, 2);
  assert.equal(calls.some(({ name }) => name?.includes('profile')), false);
  const denied = harness({ user: { id: 'foreign', email: 'polytradingia@gmail.com', user_metadata: { role: 'admin' } }, access: { error: { code: '42501' } } });
  assert.deepEqual(await denied.auth.resume(), { state: 'denied' });
});

test('Customer, Provider, unprovisioned Google account and anon cannot access Admin', async () => {
  for (const role of ['customer', 'provider', 'unprovisioned']) {
    const { auth } = harness({ user: { id: role }, access: { error: { code: '42501' } } });
    assert.deepEqual(await auth.resume(), { state: 'denied' });
  }
  const { auth, calls } = harness({ user: null });
  assert.deepEqual(await auth.resume(), { state: 'login' });
  assert.equal(calls.length, 1);
  assert.deepEqual(await harness({ verifiedUser: { id: 'different' } }).auth.resume(), { state: 'denied' });
  assert.deepEqual(await harness({ access: { data: { authorized: true, userId: 'different' } } }).auth.resume(), { state: 'denied' });
  await assert.rejects(harness({ access: { error: { code: 'NETWORK' } } }).auth.resume(), /vérifier les droits/);
  assert.throws(() => createAdminAuth({}), /Configuration Supabase/);
});

test('direct Admin entry restores access, denied entry and logout without business UI', async () => {
  for (const state of ['authorized', 'denied', 'login']) {
    const dom = new JSDOM('<main id="admin-root"></main>');
    const root = dom.window.document.getElementById('admin-root');
    let loggedOut = false;
    const app = await initialiseAdminApp(root, () => ({ resume: async () => ({ state }), signIn: async () => {}, signOut: async () => { loggedOut = true; } }));
    assert.equal(root.querySelector('section').dataset.adminState, state);
    assert.equal(root.querySelector('[data-admin-login]') !== null, state === 'login');
    if (state !== 'login') {
      root.querySelector('[data-admin-logout]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(loggedOut, true);
      assert.equal(root.querySelector('section').dataset.adminState, 'login');
    }
    assert.doesNotMatch(root.textContent, /KYC|missions|dashboard/);
    app.stop(); dom.window.close();
  }
});

test('Admin handles errors and retry without exposing backend messages', async () => {
  const dom = new JSDOM('<main id="admin-root"></main>');
  let fail = true;
  const root = dom.window.document.getElementById('admin-root');
  const app = await initialiseAdminApp(root, () => ({ resume: async () => { if (fail) throw new Error('sensitive backend details'); return { state: 'denied' }; } }));
  assert.equal(root.querySelector('section').dataset.adminState, 'error');
  assert.doesNotMatch(root.textContent, /sensitive/);
  fail = false; root.querySelector('[data-admin-retry]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(root.querySelector('section').dataset.adminState, 'denied');
  app.stop(); dom.window.close();
});

test('Admin entry is packaged for Pages with versioned critical assets and no frontend promotion', async () => {
  const build = await readFile('scripts/build.mjs', 'utf8');
  const html = await readFile('admin/index.html', 'utf8');
  const auth = await readFile('src/admin/admin-auth.js', 'utf8');
  const sql = await readFile('supabase/migrations/20260913120000_admin_access.sql', 'utf8');
  assert.match(build, /cp\('admin', 'dist\/admin'/);
  assert.match(build, /'admin\/index.html'/);
  assert.match(html, /admin-app.js/);
  assert.doesNotMatch(auth, /polytradingia|service_role|\.from\(|upsert|insert|update/);
  assert.match(sql, /private\.is_admin\(\)/);
  assert.match(sql, /errcode='42501'/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.doesNotMatch(sql, /polytradingia|insert into|update public/);
});
