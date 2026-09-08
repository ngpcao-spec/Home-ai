import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseHomePage } from '../src/app.js';

it('C08 cancellation restores the actual C04 DOM and allows a new Supabase request', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com/' });
  const root = dom.window.document.querySelector('#root');
  const tasks = [];
  const initial = { id: 'old', status: 'offered', version: 1, providerId: null, serviceCategory: 'electricity', problemDescription: 'Old request' };
  let current = initial;
  let created = 0;
  let stopped = 0;
  const repository = {
    getById: async () => current,
    getQuoteHistory: async () => [], getOffers: async () => current.status === 'offered' ? [{ id: 'offer', status: 'pending' }] : [],
    subscribeMission: () => () => { stopped++; },
    cancelCurrent: async () => (current = { ...current, status: 'cancelled', version: 2 }),
    createCurrent: async () => { created++; return (current = { ...initial, id: 'new', status: 'searching' }); },
    createOffers: async id => { assert.notEqual(current.status, 'cancelled'); assert.equal(id, current.id); },
  };
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    initialiseHomePage(root, undefined, { analyse: async () => ({ categoryId: 'electricity', summary: 'Sửa điện' }) }, undefined, fn => { tasks.push(fn); return tasks.length; }, undefined,
      () => ({ setClientLocation() {}, render() {} }), undefined, undefined, undefined,
      async () => ({ source: 'supabase', activeMission: initial, repository, providerRepository: {} }),
      { resume: async () => ({ authenticated: true, session: { user: { id: 'customer' } } }) });
    await tasks[0]();
    assert.equal(root.querySelector('[data-cancel-provider-search]').closest('[hidden]'), null,
      'A restored search must expose its cancellation button to the user');
    root.querySelector('.hero').hidden = true;
    root.querySelector('.services').style.display = 'none';
    root.querySelector('[name="address"]').value = 'Adresse conservée';
    const profile = root.querySelector('[data-app-view="profile"]');
    const history = root.querySelector('[data-app-view="history"]');
    root.querySelector('[data-cancel-provider-search]').click();
    await settle();
    assert.equal(current.status, 'cancelled');
    for (const selector of ['#home-title', '#service-request', '.services', '.category-grid']) {
      const node = root.querySelector(selector);
      assert.ok(node, selector);
      assert.equal(node.closest('[hidden]'), null, selector + ' must be visible');
    }
    assert.equal(stopped, 1);
    assert.equal(root.querySelector('.services').style.display, '');
    assert.equal(root.querySelector('[name="address"]').value, 'Adresse conservée');
    assert.equal(root.querySelector('[data-app-view="profile"]'), profile);
    assert.equal(root.querySelector('[data-app-view="history"]'), history);
    root.querySelector('#service-request').value = 'Sửa điện';
    root.querySelector('[data-request-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    root.querySelector('[data-find-technician]').click();
    await settle();
    assert.equal(created, 1);
    assert.equal(current.id, 'new');
  } finally { globalThis.confirm = originalConfirm; dom.window.close(); }
});
