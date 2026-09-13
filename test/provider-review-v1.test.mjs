import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createProviderReviewMarkup } from '../src/mission/completion-summary.js';
import { createCustomerMissionStateFromServer, createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';
import { formatProviderRating } from '../src/provider/provider-rating.js';

const provider = { name: 'Provider Test', avatarUrl: 'https://example.test/provider-avatars/photo.jpg', rating: 4.75, reviewCount: 4 };
const state = (extra = {}) => ({ completion: { finalAuthorizedAmount: 625000 }, rating: 0, reviewComment: '', ...extra });
const dom = (extra) => new JSDOM(createProviderReviewMarkup(provider, state(extra))).window.document;

test('review requires a deliberate rating; both boundary ratings enable submission', () => {
  for (const rating of [0, 6, null]) assert.equal(dom({ rating }).querySelector('[data-send-review]').disabled, true);
  for (const rating of [1, 5]) {
    const document = dom({ rating });
    assert.equal(document.querySelector('[data-send-review]').disabled, false);
    assert.equal(document.querySelector(`[data-rating="${rating}"]`).getAttribute('aria-pressed'), 'true');
  }
});

test('review uses real avatar and ratings with optional bounded escaped comment', () => {
  const document = dom({ reviewComment: '<script>private</script>' });
  assert.equal(document.querySelector('img').src, provider.avatarUrl);
  assert.match(document.body.textContent, /4.8 · 4 đánh giá/);
  const input = document.querySelector('textarea');
  assert.equal(input.maxLength, 500);
  assert.equal(input.required, false);
  assert.equal(input.placeholder, 'Chia sẻ thêm nếu bạn muốn');
  assert.equal(input.value, '<script>private</script>');
  assert.equal(document.querySelector('script'), null);
});

test('submission disables interaction and exposes a discreet real error', () => {
  const document = dom({ rating: 5, reviewSubmissionPending: true, reviewError: 'Không thể gửi đánh giá' });
  assert.equal([...document.querySelectorAll('button,textarea')].every(node => node.disabled), true);
  assert.equal(document.querySelector('[data-review-error]').hidden, false);
});

test('persisted review survives reload and never asks for a second submission', () => {
  const restored = createCustomerMissionStateFromServer({ mission: { id: 'm', status: 'completed', paymentStatus: 'paid_external' }, quotes: [], review: { rating: 5, comment: null } });
  assert.equal(restored.reviewSent, true);
  const document = dom(restored);
  assert.match(document.body.textContent, /Cảm ơn bạn đã đánh giá/);
  assert.equal(document.querySelector('[data-send-review]'), null);
  assert.equal(document.querySelector('textarea'), null);
  assert.ok(document.querySelector('[data-review-home]'));
  assert.ok(document.querySelector('[data-review-history]'));
});

test('only completed and externally paid mission enters rating stage', () => {
  for (const status of ['accepted', 'travelling', 'completed_pending_payment', 'cancelled', 'expired']) {
    assert.equal(createCustomerMissionStateFromServer({ mission: { status, paymentStatus: 'paid_external' }, quotes: [] }).reviewStage, 'hidden');
  }
  assert.equal(createCustomerMissionStateFromServer({ mission: { status: 'completed', paymentStatus: 'unpaid' }, quotes: [] }).reviewStage, 'hidden');
});

test('customer review forwards only mission, rating and optional comment to existing backend', async () => {
  const calls = [];
  const sync = createCustomerMissionSynchronizer({ missionRepository: {
    createReview: async (...args) => calls.push(args), getById: async () => ({ id: 'm', status: 'completed', paymentStatus: 'paid_external' }),
    getQuoteHistory: async () => [], getOffers: async () => [], getReview: async () => ({ rating: 1 }),
  }, providerRepository: {} });
  await sync.createReview('m', 1, '   ');
  assert.deepEqual(calls, [['m', 1, null]]);
  await assert.rejects(sync.createReview('m', 5, 'x'.repeat(501)));
  assert.equal(calls.length, 1);
});

test('display rounds backend average once without recalculating reviews', () => {
  assert.equal(formatProviderRating(4.75), '4.8');
  assert.equal(formatProviderRating(4.67), '4.7');
  assert.equal(provider.rating, 4.75);
  assert.equal(formatProviderRating(0), '0');
});
