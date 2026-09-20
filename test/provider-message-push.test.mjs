import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isProviderMessagePushDeliverable, providerMessagePushPayload, shouldSendProviderPush } from '../supabase/functions/_shared/provider-push-message.js';
import { createProviderPushManager } from '../src/provider/provider-push.js';

const messageId = '62100000-0000-0000-0000-000000000020';
const missionId = '62100000-0000-0000-0000-000000000010';
const clientId = '62100000-0000-0000-0000-000000000003';
const providerId = '62100000-0000-0000-0000-000000000001';
const outbox = { message_id: messageId, provider_id: providerId };
const message = { id: messageId, mission_id: missionId, sender_user_id: clientId, body: 'Private message +84910000203' };
const mission = { id: missionId, client_id: clientId, provider_id: providerId, status: 'accepted' };

test('only a Client message to the assigned Provider on an active mission is deliverable', () => {
  assert.equal(isProviderMessagePushDeliverable(outbox, message, mission), true);
  for (const changed of [
    { message: { ...message, sender_user_id: providerId } },
    { mission: { ...mission, provider_id: 'other-provider' } },
    { mission: { ...mission, status: 'completed' } },
    { mission: { ...mission, status: 'cancelled' } },
    { mission: { ...mission, status: 'searching' } },
    { message: { ...message, mission_id: 'other-mission' } },
    { outbox: { ...outbox, message_id: 'other-message' } },
  ]) assert.equal(isProviderMessagePushDeliverable(changed.outbox ?? outbox, changed.message ?? message, changed.mission ?? mission), false);
});

test('message Push uses an opaque reference and contains no body or private identity', () => {
  const payload = JSON.stringify(providerMessagePushPayload(message.id));
  assert.deepEqual(JSON.parse(payload), {
    type: 'mission_message', messageRef: message.id,
    title: 'HOME AI', body: 'Tin nhắn mới từ khách hàng',
  });
  assert.doesNotMatch(payload, /Private message|\+849|sender_user_id|client_id|phone|address|latitude|longitude/i);
});

function workerFixture() {
  const handlers = new Map(); const notifications = []; const posted = []; const opened = [];
  let visible = false; let hasClient = true;
  const client = { url: 'https://example.test/Home-ai/provider/', get visibilityState() { return visible ? 'visible' : 'hidden'; }, focus: async () => {}, postMessage: value => posted.push(value) };
  const self = {
    location: { origin: 'https://example.test' },
    registration: { scope: 'https://example.test/Home-ai/provider/', showNotification: async (title, options) => { notifications.push({ title, options }); } },
    clients: { matchAll: async () => hasClient ? [client] : [], openWindow: async url => { opened.push(url); } },
    addEventListener: (name, listener) => handlers.set(name, listener),
  };
  runInNewContext(readFileSync(new URL('../provider/provider-sw.js', import.meta.url), 'utf8'), { self, URL });
  const dispatch = async (name, value) => { let waiting; handlers.get(name)({ ...value, waitUntil: promise => { waiting = promise; } }); await waiting; };
  return { notifications, posted, opened, setVisible: value => { visible = value; }, setClient: value => { hasClient = value; }, dispatch };
}

test('the existing Provider foreground lease suppresses delivery while the app is visible', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  assert.equal(shouldSendProviderPush({ foreground_until: new Date(now + 45000).toISOString() }, now), false);
  assert.equal(shouldSendProviderPush({ foreground_until: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(shouldSendProviderPush({ foreground_until: null }, now), true);
});

test('a delivered message Push always displays a notification, including with a visible client', async () => {
  const worker = workerFixture(); worker.setVisible(true);
  await worker.dispatch('push', { data: { json: () => providerMessagePushPayload(messageId) } });
  assert.equal(worker.notifications.length, 1);
});

test('Provider Service Worker shows a system notification for a delivered background message Push', async () => {
  const worker = workerFixture(); const data = providerMessagePushPayload(messageId);
  worker.setVisible(false); await worker.dispatch('push', { data: { json: () => data } });
  assert.equal(worker.notifications.length, 1);
  assert.equal(worker.notifications[0].title, 'HOME AI');
  assert.equal(worker.notifications[0].options.body, 'Tin nhắn mới từ khách hàng');
  assert.equal(worker.notifications[0].options.tag, `home-ai-message-${messageId}`);
});

test('message notification tap focuses Provider mission or opens the PWA with its opaque reference', async () => {
  const worker = workerFixture(); const data = { type: 'mission_message', messageRef: messageId };
  await worker.dispatch('notificationclick', { notification: { data, close() {} } });
  assert.equal(worker.posted.length, 1);
  assert.equal(worker.posted[0].type, 'mission_message_push');
  assert.equal(worker.posted[0].messageRef, messageId);
  worker.setClient(false);
  await worker.dispatch('notificationclick', { notification: { data, close() {} } });
  assert.equal(worker.opened[0], `https://example.test/Home-ai/provider/?push_message=${messageId}`);
});

test('existing offer notification remains available through the same Service Worker', async () => {
  const worker = workerFixture(); const offerRef = '62100000-0000-0000-0000-000000000030';
  await worker.dispatch('push', { data: { json: () => ({ type: 'mission_offer', offerRef, title: 'HOME AI — Nhiệm vụ mới', body: 'Có nhiệm vụ mới gần bạn.' }) } });
  assert.equal(worker.notifications[0].options.tag, `home-ai-offer-${offerRef}`);
  await worker.dispatch('notificationclick', { notification: { data: { type: 'mission_offer', offerRef }, close() {} } });
  assert.equal(worker.posted[0].type, 'mission_offer_push');
  assert.equal(worker.posted[0].offerRef, offerRef);
});

test('Provider app resolves a message reference through its authenticated backend repository', async () => {
  let resolved; let replaced;
  const environment = {
    location: { href: `https://example.test/Home-ai/provider/?push_message=${messageId}` },
    history: { replaceState: (_state, _title, url) => { replaced = String(url); } },
  };
  const manager = createProviderPushManager({ environment, repository: { resolvePushMessage: async ref => { resolved = ref; return missionId; } } });
  assert.equal(await manager.resolveMessageLaunch(), missionId);
  assert.equal(resolved, messageId);
  assert.doesNotMatch(replaced, /push_message/);
});
