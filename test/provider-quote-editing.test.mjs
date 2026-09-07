import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseProviderApp } from '../src/provider/provider-app.js';

async function mountEditor() {
  const listeners = {};
  let fields = {};
  let html = '';
  let renders = 0;
  let heartbeat;
  let refresh;
  let state = { status: { online: true, available: false }, offers: [],
    assignment: { id: 'm1', status: 'arrived' } };
  const sent = [];
  let fail = false;
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; renders++;
      fields = value.includes('data-quote-diagnosis') ? Object.fromEntries([
        ['[data-quote-diagnosis]', { value: '' }],
        ['[data-quote-labor]', { value: '150000' }],
        ['[data-quote-parts]', { value: '50000' }],
        ['[data-quote-warranty]', { value: '30' }],
        ['[data-send-quote]', { disabled: false }],
        ['.app-message', { textContent: '' }],
      ]) : {};
    },
    querySelector: key => fields[key] ?? null,
    addEventListener: (event, callback) => { listeners[event] = callback; },
  };
  const repository = {
    source: 'supabase', load: async () => structuredClone(state),
    updateLocation: async () => structuredClone(state),
    subscribeDispatch: callback => { refresh = callback; return () => {}; },
    createQuote: async (id, draft) => {
      sent.push({ id, draft });
      if (fail) throw new Error('Network failure');
      state.assignment = { ...state.assignment, quote: { status: 'pending', version: 1, ...draft } };
      return structuredClone(state);
    },
  };
  const app = await initialiseProviderApp(root, async () => repository, async () => null,
    { enabled: false, getSession: async () => null },
    options => { heartbeat = options; return { sync() {}, stop() {} }; },
    { getState: async () => 'granted', request: async () => ({ latitude: 12, longitude: 109 }) });
  const click = selector => listeners.click({ target: { closest: key => key === selector ? {} : null } });
  await click('[data-start-diagnosis]');
  return { root, app, click, sent, refresh: () => refresh(),
    gps: () => heartbeat.onState(structuredClone(state)),
    error: () => heartbeat.onError(),
    fields: () => fields, renders: () => renders,
    setState: next => { state = next; }, fail: value => { fail = value; } };
}

it('keeps all four input nodes and values across repeated dispatch/GPS refreshes and errors', async () => {
  const view = await mountEditor();
  try {
    const fields = view.fields();
    const count = view.renders();
    const values = ['Điện bị chập khi bật máy', '275000', '83000', '90'];
    const keys = ['diagnosis', 'labor', 'parts', 'warranty'];
    keys.forEach((key, i) => { fields['[data-quote-' + key + ']'].value = values[i]; });
    for (let i = 0; i < 3; i++) { await view.refresh(); await view.gps(); await view.error(); }
    assert.equal(view.renders(), count);
    assert.equal(view.fields(), fields);
    keys.forEach((key, i) => assert.equal(fields['[data-quote-' + key + ']'].value, values[i]));
    view.fail(true);
    await view.click('[data-send-quote]');
    assert.equal(view.fields(), fields);
    assert.equal(fields['[data-send-quote]'].disabled, false);
    view.fail(false);
    await view.click('[data-send-quote]');
    assert.deepEqual(view.sent[1], { id: 'm1', draft: {
      diagnosis: values[0], laborAmount: values[1], partsAmount: values[2], warrantyDays: values[3],
      laborDescription: 'Công kiểm tra và sửa chữa', partsDescription: 'Linh kiện dự kiến',
    } });
    assert.ok(view.root.innerHTML.includes('BÁO GIÁ V1'));
  } finally { view.app.stop(); }
});

it('retains the draft but blocks submission when a refresh changes the mission', async () => {
  const view = await mountEditor();
  try {
    const fields = view.fields();
    fields['[data-quote-diagnosis]'].value = 'Draft for m1';
    view.setState({ status: { online: true }, offers: [], assignment: { id: 'm2', status: 'arrived' } });
    await view.refresh();
    assert.equal(view.fields(), fields);
    assert.equal(fields['[data-send-quote]'].disabled, true);
    await view.click('[data-send-quote]');
    assert.equal(view.sent.length, 0);
    assert.equal(fields['[data-quote-diagnosis]'].value, 'Draft for m1');
  } finally { view.app.stop(); }
});
