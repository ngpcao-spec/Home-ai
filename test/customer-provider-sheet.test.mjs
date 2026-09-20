import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createTrackingStageMarkup } from '../src/tracking/tracking-sheet.js';
import { mountProviderMapResizeGesture } from '../src/provider/provider-map-resize.js';

function pointer(target, type, y, time) {
  const event = new target.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientY: { value: y }, timeStamp: { value: time } });
  target.dispatchEvent(event);
}

test('Client map handle sits between the map and the Provider card, with chat and call intact', () => {
  const markup = createTrackingStageMarkup({
    name: 'Provider Test Nha Trang', avatarUrl: 'https://example.test/avatar.jpg', rating: 4.4, reviewCount: 14,
    verified: true, distanceKm: 1.2, category: 'electricity', experienceYears: 5,
    introduction: 'Provider E2E HOME AI tại Nha Trang',
    chatMission: { id: 'm1', status: 'travelling' }, callMission: { id: 'm1', status: 'travelling' },
  });
  const dom = new JSDOM(markup);
  const shell = dom.window.document.querySelector('.tracking-shell');
  const mapCard = shell.querySelector('.tracking-map-card');
  const panel = shell.querySelector('.tracking-provider-panel');
  assert.deepEqual([...shell.children], [mapCard, panel]);
  assert.deepEqual([...mapCard.children].map(node => node.hasAttribute('data-tracking-map') ? 'map' : node.hasAttribute('data-provider-map-resize-handle') ? 'handle' : 'other'), ['map', 'handle']);
  assert.ok(panel.querySelector('[data-mission-chat-open]'));
  assert.ok(panel.querySelector('[data-mission-call-start]'));
  assert.equal(panel.querySelector('.tracking-contact-actions').hidden, true, 'no duplicate message action');
  assert.match(panel.textContent, /Thợ điện|Thợ ở gần|Đã xác minh|5 năm/);
  assert.doesNotMatch(panel.textContent, /Kéo|Số điện thoại/);
  assert.equal(dom.window.document.querySelectorAll('[data-tracking-map]').length, 1);
  dom.window.close();
  assert.doesNotMatch(createTrackingStageMarkup({ name: 'Provider' }, { missionStatus: 'arrived' }), /data-provider-map-resize-handle/);
});

test('accepted Client mission shows the same resizable map and Provider actions without a premature ETA', () => {
  const markup=createTrackingStageMarkup({name:'Provider',category:'electricity',
    chatMission:{id:'m1',status:'accepted'},callMission:{id:'m1',status:'accepted'}},
  {missionStatus:'accepted'});
  const dom=new JSDOM(markup);const stage=dom.window.document;
  assert.ok(stage.querySelector('[data-tracking-map]'));
  assert.ok(stage.querySelector('[data-provider-map-resize-handle]'));
  assert.ok(stage.querySelector('[data-provider-location-waiting]'));
  assert.match(stage.querySelector('[data-tracking-status]').textContent,/Thợ đang chuẩn bị/);
  assert.equal(stage.querySelector('[data-tracking-metrics]').hidden,true);
  assert.ok(stage.querySelector('[data-mission-chat-open]'));
  assert.ok(stage.querySelector('[data-mission-call-start]'));
  dom.window.close();
});

test('Client and Provider CSS share map heights and handle dimensions on iPhone', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const providerCss=readFileSync(new URL('../src/provider/provider-app.css',import.meta.url),'utf8');
  assert.match(css, /\.tracking-map-card \.tracking-map \{ height: 270px; min-height: 270px;/);
  assert.match(css, /@media \(max-width: 420px\) \{ \.tracking-map-card \.tracking-map \{ height: 238px; min-height: 238px; \} \}/);
  assert.match(providerCss,/\.mission-map-card \.provider-map\{height:270px;min-height:270px;/);
  assert.match(providerCss,/@media\(max-width:420px\)\{\.mission-map-card \.provider-map\.maplibregl-map,\.mission-map-card \.provider-map \.local-map\{height:238px;min-height:238px\}\}/);
  assert.match(css,/\.tracking-map-resize-handle::before \{ width: 40px; height: 4px;[^}]*background: #abcfc2;/);
  assert.match(providerCss,/\.provider-map-resize-handle::before\{[^}]*width:40px;height:4px;[^}]*background:#abcfc2/);
  assert.match(css, /\.tracking-map-card\.is-map-expanded \.tracking-map \{ height: 72vh; height: 72dvh;/);
  assert.match(css, /\.tracking-map-card\.is-map-expanded \.tracking-map-resize-handle \{[^}]*position: fixed;[^}]*safe-area-inset-bottom[^}]*z-index: 19;/);
  assert.match(css,/@media \(min-width: 760px\) \{ \.tracking-map-card\.is-map-expanded \.tracking-map-resize-handle \{ bottom: 100px; \} \}/);
  assert.match(css, /\.tracking-provider-panel \{ position: relative; width: 100%; margin: 10px auto 0;/);
  assert.match(css, /\.tracking-provider-panel \.assigned-provider-heading h3 \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.app-navigation \{[^}]*z-index: 20;/);
  assert.doesNotMatch(css, /tracking-bottom-sheet|tracking-sheet-handle|height: 46dvh|height: 42dvh/);
});

test('shared Provider gesture expands the same Client map downward and restores it upward', async () => {
  const dom = new JSDOM('<div class="tracking-map-card"><div class="tracking-map" data-tracking-map><i data-provider-marker></i></div><div data-provider-map-resize-handle></div></div><article class="tracking-provider-panel"></article>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const card = document.querySelector('.tracking-map-card');
  const mapElement = document.querySelector('[data-tracking-map]');
  const marker = document.querySelector('[data-provider-marker]');
  const handle = document.querySelector('[data-provider-map-resize-handle]');
  let resizeCount = 0;
  const navigation = { map: { resize() { resizeCount += 1; }, fitBounds() { throw Error('fitBounds during drag'); }, render() { throw Error('render during drag'); } } };
  const stop = mountProviderMapResizeGesture({ card, mapElement, navigation, view: dom.window });
  try {
    pointer(handle, 'pointerdown', 100, 1000);
    pointer(handle, 'pointermove', 500, 2000);
    assert.ok(Number.parseFloat(mapElement.style.height) > 270);
    pointer(handle, 'pointerup', 500, 2020);
    assert.equal(card.classList.contains('is-map-expanded'), true);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.ok(resizeCount > 0);
    marker.dataset.latitude = '12.246';
    pointer(handle, 'pointerdown', 500, 3000);
    pointer(handle, 'pointermove', 100, 4000);
    pointer(handle, 'pointerup', 100, 4020);
    assert.equal(card.classList.contains('is-map-expanded'), false);
    assert.equal(mapElement.style.height, '');
    assert.equal(document.querySelector('[data-tracking-map]'), mapElement);
    assert.equal(document.querySelector('[data-provider-marker]'), marker);
    assert.equal(marker.dataset.latitude, '12.246');
  } finally { stop(); dom.window.close(); }
});
