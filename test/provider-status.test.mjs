import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { initialiseProviderApp, renderProviderDashboard } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';

async function mount(repository) {
  const listeners = {};
  const root = { innerHTML: '', querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const app = await initialiseProviderApp(root, async () => repository, async () => null,
    { enabled: false, getSession: async () => null }, () => ({ sync() {}, stop() {} }));
  return { app, root, click: (selector, dataset = {}) => listeners.click({ target: { closest: name => name === selector ? { dataset } : null } }) };
}

it('offers one labelled status button and no availability checkbox', () => {
  for (const online of [true, false]) {
    const html = renderProviderDashboard({ status: { online, available: online } }, { busy: true });
    assert.doesNotMatch(html, /Sẵn sàng nhận việc|data-toggle-available|type="checkbox"/);
    assert.match(html, new RegExp(`data-toggle-online aria-label="Đang trực tuyến" aria-pressed="${online}" disabled`));
  }
});

it('switches OFF to false/false and back ON to true/true', async () => {
  const view = await mount(createMockProviderAppRepository());
  try {
    await view.click('[data-toggle-online]');
    assert.equal(view.app.getState().status.online, false);
    assert.equal(view.app.getState().status.available, false);
    await view.click('[data-toggle-online]');
    assert.equal(view.app.getState().status.online, true);
    assert.equal(view.app.getState().status.available, true);
  } finally { view.app.stop(); }
});

it('acceptance makes a provider busy and OFF/ON cannot make that mission available', async () => {
  const view = await mount(createMockProviderAppRepository());
  try {
    await view.click('[data-accept]', { accept: 'offer-demo-1' });
    assert.equal(view.app.getState().status.available, false);
    await view.click('[data-toggle-online]');
    assert.equal(view.app.getState().status.online, false);
    await view.click('[data-toggle-online]');
    assert.equal(view.app.getState().status.online, true);
    assert.equal(view.app.getState().status.available, false);
    assert.equal(view.app.getState().assignment.id, 'mission-demo-1');
  } finally { view.app.stop(); }
});

it('serializes repeated status clicks and retains state when the server rejects a concurrent assignment', async () => {
  let calls = 0;
  let reject;
  const view = await mount({ source: 'mock', load: async () => ({ status: { online: false, available: false }, offers: [] }),
    setAvailability: () => { calls++; return new Promise((resolve, fail) => { reject = fail; }); } });
  try {
    const pending = view.click('[data-toggle-online]');
    await Promise.resolve();
    await view.click('[data-toggle-online]');
    assert.equal(calls, 1);
    reject(new Error('Provider status cannot become available during a mission.'));
    await pending;
    assert.equal(view.app.getState().status.available, false);
    assert.match(view.root.innerHTML, /Không thể cập nhật/);
  } finally { view.app.stop(); }
});

it('retains server release on completion, pre-assignment cancellation and busy matching guards', async () => {
  const read = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  const [completion, cancellation, matching, dispatch] = await Promise.all([
    read('20260902000900_mission_completion_history_reviews'),
    read('20260901000400_customer_mission_persistence'),
    read('20260901000500_provider_matching_and_offers'),
    read('20260903001000_realtime_provider_dispatch'),
  ]);
  assert.match(completion, /current_mission_id=null,available=online[\s\S]*where provider_id=mission_row.provider_id and current_mission_id=mission_row.id/);
  assert.match(cancellation, /status = 'cancelled'[\s\S]*version = expected_version and status in \('requested', 'searching', 'offered'\)/);
  assert.match(matching, /pst.online\s+and pst.available\s+and pst.current_mission_id is null/);
  assert.match(dispatch, /pst.online and pst.available and pst.current_mission_id is null/);
  assert.match(dispatch, /set available=false,current_mission_id=mission_row.id/);
});

it('separates GPS heartbeats from atomic server-controlled availability', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260907001100_provider_location_heartbeat.sql', import.meta.url), 'utf8');
  const locationFunction = migration.match(/create or replace function public\.update_current_provider_location[\s\S]*?end \$\$;/)?.[0] ?? '';
  assert.match(locationFunction, /set last_latitude = new_latitude,[\s\S]*last_longitude = new_longitude,[\s\S]*last_location_at = statement_timestamp\(\)/);
  assert.doesNotMatch(locationFunction, /\b(?:online|available|current_mission_id)\s*=/);
  assert.match(migration, /available = new_online and current_mission_id is null/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.update_current_provider_location[\s\S]*from public, anon/);
});
