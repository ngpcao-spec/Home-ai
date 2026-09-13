import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createAdminRepository } from '../src/admin/admin-repository.js';
import { adminActiveStatuses, initialiseAdminSupervision, renderAdminMissionDetail, renderAdminMissionList, renderAdminProvider } from '../src/admin/admin-supervision.js';

const id = '59510000-0000-0000-0000-000000000011';
const mission = { id, serviceCategory: 'electricity', status: 'completed', clientName: 'Khách hàng thật', providerName: 'Thợ thật', address: 'Nha Trang', problem: 'Thay ổ cắm', finalAmount: 625000, currency: 'VND', paymentStatus: 'paid_external', createdAt: '2026-09-13T01:00:00Z',
  dates: { completed: '2026-09-13T02:00:00Z' },
  invoice: { hourlyRate: 300000, minimumCharge: 400000, workedMinutes: 95, laborAmount: 475000, materialAmount: 150000, totalAmount: 625000 },
  events: [{ type: 'mission.created', createdAt: '2026-09-13T01:00:00Z' }, { type: 'mission.invoice.submitted', createdAt: '2026-09-13T01:59:00Z' }, { type: 'mission.completed.external_payment', createdAt: '2026-09-13T02:00:00Z' }],
  review: { rating: 5, comment: 'Tốt', createdAt: '2026-09-13T02:01:00Z' }, phone: 'PRIVATE_PHONE', identity_number: 'PRIVATE_KYC', roomName: 'PRIVATE_ROOM' };
const provider = { id: 'provider', name: 'Thợ thật', online: true, verified: true, ratingAverage: 5, reviewCount: 1, completedJobs: 1, activities: [{ serviceCategory: 'electricity', name: 'electricity' }], introduction: 'Giới thiệu', experienceYears: 2 };
const text = html => { const dom = new JSDOM(html); const value = dom.window.document.body.textContent; dom.window.close(); return value; };
const wait = () => new Promise(resolve => setTimeout(resolve, 220));

test('Admin lists real mission data with Vietnamese statuses/filters, without UUID or private fields in visible UI', () => {
  const content = text(renderAdminMissionList({ items: [mission, { ...mission, id: 'unassigned', status: 'searching', providerName: null }] }, 'all'));
  for (const label of ['Thợ điện', 'Hoàn thành', 'Tất cả', 'Đang hoạt động', 'Đã hủy', '625.000đ', 'Khách hàng thật', 'Chưa được phân công', 'Xem chi tiết']) assert.ok(content.includes(label));
  assert.doesNotMatch(content, /electricity|completed|searching|59510000|PRIVATE/);
  assert.ok(adminActiveStatuses.includes('quote_pending'));
  assert.ok(adminActiveStatuses.includes('completed_pending_payment'));
  assert.ok(!adminActiveStatuses.includes('completed'));
  assert.ok(!adminActiveStatuses.includes('expired'));
});

test('Admin detail displays persisted invoice, payment, review and actual events only', () => {
  const content = text(renderAdminMissionDetail(mission));
  for (const label of ['1 giờ 35 phút', '300.000đ/giờ', '400.000đ', '475.000đ', '150.000đ', '625.000đ', 'Đã xác nhận thanh toán trực tiếp', '5/5', 'Tốt', 'Xác nhận thanh toán']) assert.ok(content.includes(label));
  assert.ok(!content.includes('Đã đến'));
  assert.doesNotMatch(content, /PRIVATE|59510000|electricity|paid_external/);
  const legacy = text(renderAdminMissionDetail({ ...mission, invoice: null, review: null, acceptedQuote: { version: 2, totalAmount: 300000, warrantyDays: 30 }, finalAmount: 300000, events: [] }));
  assert.match(legacy, /Báo giá V2 đã chấp nhận/);
  assert.match(legacy, /300\.000đ/);
  assert.doesNotMatch(legacy, /300\.000đ\/giờ/);
});

test('Admin Provider view uses profile presentation only, keeps phone/KYC out and has no edit controls', () => {
  const content = text(renderAdminProvider({ ...provider, phone: 'PRIVATE_PHONE' }, { avatar: () => null }, true));
  assert.match(content, /Thợ điện/);
  assert.match(content, /2 năm kinh nghiệm/);
  assert.doesNotMatch(content, /electricity|PRIVATE|Lưu|Chỉnh sửa/);
});

test('Admin repository uses only admin-gated read RPCs and the existing business event stream', async () => {
  const calls = []; let callback; let removed = false;
  const channel = { on(type, options, fn) { calls.push({ type, options }); callback = fn; return this; }, subscribe() { return this; } };
  const repo = createAdminRepository({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { items: [] }, error: null }; }, channel: () => channel, removeChannel: async () => { removed = true; } }, 'https://example.supabase.co');
  await repo.missions('active', 50); await repo.mission(id); await repo.providers(0); await repo.provider('provider');
  assert.deepEqual(calls.map(x => x.name), ['get_admin_missions', 'get_admin_mission_detail', 'get_admin_providers', 'get_admin_provider_profile']);
  let invalidations = 0; const stop = repo.subscribe(() => { invalidations += 1; });
  callback({ new: { payload: 'NOT_RETAINED' } }); assert.equal(invalidations, 1);
  assert.equal(calls.at(-1).options.table, 'mission_events');
  stop(); assert.equal(removed, true);
  assert.equal(repo.avatar('provider/kyc/front/test.jpg'), null);
  const path = '59500000-0000-0000-0000-000000000003/avatar/59500000-0000-0000-0000-000000000099.jpg';
  assert.match(repo.avatar(path), /\/public\/provider-avatars\//);
  const bad = createAdminRepository({ rpc: async () => ({ error: { code: '42501', message: 'PRIVATE' } }) });
  await assert.rejects(bad.missions('all', 0), error => error.code === '42501' && !error.message.includes('PRIVATE'));
});

test('Admin navigation, filtering, detail, Providers and realtime updates stay read-only and stable on unchanged events', async () => {
  const dom = new JSDOM('<main id="root"></main>'); const root = dom.window.document.getElementById('root');
  let row = { ...mission, status: 'travelling' }; let invalidate; let unsubscribed = false; const filters = [];
  const repo = { missions: async (filter) => { filters.push(filter); return { items: [structuredClone(row)] }; }, mission: async () => structuredClone(row),
    providers: async () => ({ items: [provider] }), provider: async () => provider, avatar: () => null,
    subscribe: callback => { invalidate = callback; return () => { unsubscribed = true; }; } };
  const app = await initialiseAdminSupervision(root, repo);
  assert.match(root.textContent, /Đang di chuyển/);
  const card = root.querySelector('article'); invalidate(); invalidate(); await wait();
  assert.equal(root.querySelector('article'), card);
  row = { ...row, status: 'arrived' }; invalidate(); await wait(); assert.match(root.textContent, /Thợ đã đến/);
  root.querySelector('[data-admin-filter="completed"]').click(); await wait(); assert.equal(filters.at(-1), 'completed');
  root.querySelector('[data-admin-mission]').click(); await wait(); assert.match(root.textContent, /Thay ổ cắm/);
  root.querySelector('[data-admin-nav="providers"]').click(); await wait(); assert.match(root.textContent, /1 nhiệm vụ hoàn thành/);
  root.querySelector('[data-admin-provider]').click(); await wait(); assert.match(root.textContent, /Giới thiệu/);
  assert.equal(root.querySelectorAll('[data-admin-logout]').length, 1);
  app.stop(); assert.equal(unsubscribed, true); dom.window.close();
});

test('Admin rejects late stale responses after navigation and erases content when access is revoked', async () => {
  const dom = new JSDOM('<main id="root"></main>'); const root = dom.window.document.getElementById('root');
  let resolveDetail; let revoke = false; let invalidate;
  const repo = { missions: async () => ({ items: [mission] }), mission: () => new Promise(resolve => { resolveDetail = resolve; }),
    providers: async () => { if (revoke) throw Object.assign(new Error('denied'), { code: '42501' }); return { items: [provider] }; },
    avatar: () => null, subscribe: fn => { invalidate = fn; return () => {}; } };
  const app = await initialiseAdminSupervision(root, repo);
  root.querySelector('[data-admin-mission]').click();
  root.querySelector('[data-admin-nav="providers"]').click(); await wait(); resolveDetail(mission); await wait();
  assert.match(root.textContent, /Xem hồ sơ/); assert.doesNotMatch(root.textContent, /Thay ổ cắm/);
  revoke = true; invalidate(); await wait(); assert.match(root.textContent, /Accès refusé/); assert.doesNotMatch(root.textContent, /Thợ thật/);
  app.stop(); dom.window.close();
});
