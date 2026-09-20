import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createTrackingStageMarkup } from '../src/tracking/tracking-sheet.js';
import { mountTrackingProviderSheet } from '../src/tracking/provider-sheet-gesture.js';

function pointer(target, type, y, time) {
  const event = new target.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientY: { value: y }, timeStamp: { value: time } });
  target.dispatchEvent(event);
}

test('travelling Provider card has one compact sheet, two actions and no phone', () => {
  const markup = createTrackingStageMarkup({
    name: 'Provider Test Nha Trang', avatarUrl: 'https://example.test/avatar.jpg', rating: 4.4, reviewCount: 14,
    verified: true, distanceKm: 1.2, category: 'electricity', experienceYears: 5,
    introduction: 'Provider E2E HOME AI tại Nha Trang',
    chatMission: { id: 'm1', status: 'travelling' }, callMission: { id: 'm1', status: 'travelling' },
  });
  const dom = new JSDOM(markup);
  const sheet = dom.window.document.querySelector('.tracking-bottom-sheet');
  assert.ok(sheet.querySelector('[data-tracking-sheet-handle]'));
  assert.equal(sheet.classList.contains('is-expanded'), false);
  assert.equal(sheet.querySelector('[data-tracking-sheet-handle]').getAttribute('aria-expanded'), 'false');
  assert.ok(sheet.querySelector('[data-mission-chat-open]'));
  assert.ok(sheet.querySelector('[data-mission-call-start]'));
  assert.equal(sheet.querySelector('.tracking-contact-actions').hidden, true, 'no duplicate message action');
  assert.match(sheet.textContent, /Thợ điện|Thợ ở gần|Đã xác minh|5 năm/);
  assert.doesNotMatch(sheet.textContent, /Kéo|Số điện thoại/);
  assert.equal(dom.window.document.querySelectorAll('[data-tracking-map]').length, 1);
  dom.window.close();
});

test('compact sheet CSS limits its height, clamps the name and leaves the bottom navigation above it', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.tracking-bottom-sheet \.assigned-provider-heading h3 \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.tracking-shell\[data-tracking-mission-status="travelling"\] \.tracking-bottom-sheet \{[^}]*height: 46dvh;/);
  assert.match(css, /\.tracking-shell\[data-tracking-mission-status="travelling"\] \.tracking-bottom-sheet\.is-expanded \{[^}]*height: 72dvh;/);
  assert.match(css, /\.tracking-bottom-sheet:not\(\.is-expanded\) \.mission-contact-actions \{[^}]*position: sticky; bottom: 0;/);
  assert.match(css, /\.app-navigation \{[^}]*z-index: 20;/);
  assert.match(css, /\.tracking-shell\[data-tracking-mission-status="travelling"\] \{[^}]*safe-area-inset-bottom/);
  assert.match(css, /\.mission-tracker:has\(\.tracking-shell\[data-tracking-mission-status="travelling"\]\) > \.mission-timeline \{ display: none; \}/);
  assert.match(css, /max-height: 700px[^}]*height: 42dvh;/);
  assert.doesNotMatch(css.match(/\.tracking-sheet-handle[^}]+\}/g)?.join('') ?? '', /Kéo/);
});

test('handle-only drag expands upward and returns downward without touching the map', () => {
  const dom = new JSDOM('<div class="tracking-shell"><div class="tracking-map"><div data-map></div></div><article class="tracking-bottom-sheet"><button data-tracking-sheet-handle aria-expanded="false"></button></article></div>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const sheet = document.querySelector('.tracking-bottom-sheet');
  const handle = document.querySelector('[data-tracking-sheet-handle]');
  const map = document.querySelector('[data-map]');
  let mapCreates = 1;
  let fitBounds = 0;
  let markerMoves = 0;
  const stop = mountTrackingProviderSheet(sheet);
  try {
    pointer(handle, 'pointerdown', 500, 1000);
    pointer(handle, 'pointermove', 200, 2000);
    assert.ok(Number.parseFloat(sheet.style.height) > dom.window.innerHeight * .46);
    pointer(handle, 'pointerup', 200, 2020);
    assert.equal(sheet.classList.contains('is-expanded'), true);
    assert.equal(handle.getAttribute('aria-expanded'), 'true');
    markerMoves += 1;
    pointer(handle, 'pointerdown', 200, 3000);
    pointer(handle, 'pointermove', 500, 4000);
    pointer(handle, 'pointerup', 500, 4020);
    assert.equal(sheet.classList.contains('is-expanded'), false);
    assert.equal(handle.getAttribute('aria-expanded'), 'false');
    assert.equal(sheet.style.height, '');
    assert.equal(document.querySelector('[data-map]'), map);
    assert.equal(mapCreates, 1);
    assert.equal(fitBounds, 0);
    assert.equal(markerMoves, 1);
  } finally { stop(); dom.window.close(); }
});
