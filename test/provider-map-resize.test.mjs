import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { mountProviderMapResizeGesture } from '../src/provider/provider-map-resize.js';
import { initialiseProviderApp, renderActiveProviderMission } from '../src/provider/provider-app.js';

function pointer(target, type, { id = 1, y = 0, time = 0 } = {}) {
  const event = new target.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: id }, pointerType: { value: 'touch' }, clientY: { value: y }, timeStamp: { value: time },
  });
  target.dispatchEvent(event);
  return event;
}

const mission = { id: 'm1', serviceCategory: 'electricity', request: 'Test', address: 'Nha Trang', status: 'travelling' };
const location = { latitude: 12.245, longitude: 109.19 };
const navigation = map => ({ map, route: { distanceKm: 1, durationMinutes: 4, points: [] }, providerLocation: location, destination: { latitude: 12.25, longitude: 109.2 } });

it('keeps the expanded handle above the iPhone bottom navigation without moving it in normal mode', () => {
  const css = readFileSync(new URL('../src/provider/provider-app.css', import.meta.url), 'utf8');
  assert.match(css, /\.provider-map-resize-handle\{[^}]*height:32px;[^}]*touch-action:none/);
  assert.match(css, /\.mission-map-card\.is-map-expanded \.provider-map-resize-handle\{[^}]*position:fixed;[^}]*left:50%;[^}]*bottom:calc\(80px \+ env\(safe-area-inset-bottom\)\);[^}]*z-index:3;[^}]*height:44px;[^}]*background:transparent/);
  assert.match(css, /\.mission-map-card\.is-map-expanded \.provider-map-resize-handle::before\{[^}]*box-shadow:/);
  assert.match(css, /\.mission-map-card\.is-map-expanded \.provider-map\{height:72vh;min-height:0;height:72dvh\}/);
});

it('shows a visual-only handle only with an active mission map', () => {
  const map = { resize() {} };
  const visible = renderActiveProviderMission(mission, { navigation: navigation(map) });
  assert.match(visible, /data-provider-map-resize-handle/);
  assert.doesNotMatch(visible, /Kéo|Glisser|Drag/);
  const dom = new JSDOM(visible);
  assert.deepEqual([...dom.window.document.querySelector('.mission-map-card').children].map(child =>
    child.hasAttribute('data-provider-map') ? 'map' : child.hasAttribute('data-provider-map-resize-handle') ? 'handle' : child.className
  ), ['map', 'handle', 'map-metrics']);
  dom.window.close();
  assert.doesNotMatch(renderActiveProviderMission({ ...mission, status: 'arrived' }), /data-provider-map-resize-handle/);
  assert.doesNotMatch(renderActiveProviderMission(mission), /data-provider-map-resize-handle/);
});

it('drags the bottom handle down to expand and up to collapse without recreating the map', async () => {
  const dom = new JSDOM('<body><section class="mission-map-card"><div class="provider-map" data-provider-map></div><div data-provider-map-resize-handle></div><div class="map-metrics"></div></section></body>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const card = document.querySelector('.mission-map-card');
  const mapElement = document.querySelector('[data-provider-map]');
  const handle = document.querySelector('[data-provider-map-resize-handle]');
  const events = [];
  const map = { resize() { events.push('resize'); }, fitBounds() { throw Error('fitBounds during resize'); }, render() { throw Error('render during resize'); } };
  const sameElement = mapElement;
  const sameMap = map;
  const stop = mountProviderMapResizeGesture({ card, mapElement, navigation: { map }, view: dom.window });
  try {
    assert.equal(document.body.style.overflow, '');
    pointer(handle, 'pointerdown', { y: 100, time: 0 });
    assert.equal(document.body.style.overflow, 'hidden');
    pointer(handle, 'pointermove', { y: 500, time: 2000 });
    assert.ok(Number.parseFloat(mapElement.style.height) > 270);
    pointer(handle, 'pointerup', { y: 500, time: 2020 });
    assert.equal(card.classList.contains('is-map-expanded'), true);
    assert.equal(card.querySelector('[data-provider-map-resize-handle]'), handle, 'expanded state keeps the same handle');
    assert.equal(handle.isConnected, true);
    assert.equal(document.body.style.overflow, '');
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.ok(events.length >= 1);
    assert.equal(document.querySelector('[data-provider-map]'), sameElement);
    assert.equal(map, sameMap);
    pointer(handle, 'pointerdown', { y: 500, time: 3000 });
    pointer(handle, 'pointermove', { y: 100, time: 5000 });
    pointer(handle, 'pointerup', { y: 100, time: 5020 });
    assert.equal(card.classList.contains('is-map-expanded'), false);
    assert.equal(card.querySelector('[data-provider-map-resize-handle]'), handle, 'upward drag keeps the handle mounted');
    assert.equal(mapElement.style.height, '');
    const transition = new dom.window.Event('transitionend');
    Object.defineProperty(transition, 'propertyName', { value: 'height' });
    mapElement.dispatchEvent(transition);
    assert.ok(events.length >= 2);
    pointer(handle, 'pointerdown', { y: 100, time: 6000 });
    pointer(handle, 'pointermove', { y: 130, time: 6020 });
    pointer(handle, 'pointerup', { y: 130, time: 6030 });
    assert.equal(card.classList.contains('is-map-expanded'), true, 'fast downward drag expands below midpoint');
    pointer(handle, 'pointerdown', { y: 130, time: 7000 });
    pointer(handle, 'pointermove', { y: 100, time: 7020 });
    pointer(handle, 'pointerup', { y: 100, time: 7030 });
    assert.equal(card.classList.contains('is-map-expanded'), false, 'fast upward drag collapses above midpoint');
  } finally { stop(); dom.window.close(); }
});

it('keeps one navigation and marker through GPS refresh while expanded', async () => {
  let state = { provider: { id: 'p1', name: 'Provider' }, status: { online: true, available: false }, offers: [], assignment: { ...mission, clientLocation: { latitude: 12.25, longitude: 109.2 } } };
  let notifyDispatch;
  let heartbeatOptions;
  let renderCount = 0;
  let marker;
  const map = {
    setClientLocation() {}, resize() {},
    async render(container) { renderCount += 1; marker = container.ownerDocument.createElement('span'); marker.dataset.providerMarker = ''; container.append(marker); },
    moveProvider(_id, position) { if (marker?.isConnected) marker.dataset.latitude = String(position.latitude); },
  };
  const activeNavigation = navigation(map);
  const repository = { source: 'supabase', load: async () => structuredClone(state), updateLocation: async () => structuredClone(state), subscribeDispatch(handler) { notifyDispatch = handler; return () => {}; } };
  const dom = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual: true });
  const root = dom.window.document.querySelector('#provider-root');
  const app = await initialiseProviderApp(root, async () => repository, async () => activeNavigation, { enabled: false, getSession: async () => null }, options => { heartbeatOptions = options; return { sync() {}, stop() {} }; }, { getState: async () => 'granted', request: async () => location, geolocation: {} });
  try {
    for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve));
    const mapElement = root.querySelector('[data-provider-map]');
    const handle = root.querySelector('[data-provider-map-resize-handle]');
    const originalMarker = root.querySelector('[data-provider-marker]');
    pointer(handle, 'pointerdown', { y: 100, time: 0 });
    pointer(handle, 'pointermove', { y: 500, time: 100 });
    pointer(handle, 'pointerup', { y: 500, time: 120 });
    assert.equal(mapElement.closest('.mission-map-card').classList.contains('is-map-expanded'), true);
    heartbeatOptions.onPosition({ latitude: 12.246, longitude: 109.191 });
    state = { ...state, status: { ...state.status, lastLocationAt: '2026-09-13T01:00:01Z' } };
    await notifyDispatch({ table: 'provider_status' });
    for (let i = 0; i < 2; i += 1) await new Promise(resolve => setImmediate(resolve));
    heartbeatOptions.onPosition({ latitude: 12.247, longitude: 109.192 });
    assert.equal(root.querySelector('[data-provider-map]'), mapElement);
    assert.equal(root.querySelector('[data-provider-marker]'), originalMarker);
    assert.equal(originalMarker.dataset.latitude, '12.247');
    assert.equal(mapElement.closest('.mission-map-card').classList.contains('is-map-expanded'), true);
    assert.equal(renderCount, 1);
    assert.equal(activeNavigation.map, map);
  } finally { app.stop(); dom.window.close(); }
});

it('keeps the Provider map and camera through accepted to travelling', async () => {
  let state={provider:{id:'p1',name:'Provider'},status:{online:true,available:false},offers:[],
    assignment:{...mission,status:'accepted',clientLocation:{latitude:12.25,longitude:109.2}}};
  const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#provider-root');
  let marker;let renderCount=0;let routeUpdates=0;let discardedMapRenders=0;
  const map={setClientLocation(){},resize(){},async render(container){renderCount+=1;
    marker=container.ownerDocument.createElement('span');marker.dataset.providerMarker='';container.append(marker);},
    moveProvider(_id,position){if(marker?.isConnected)marker.dataset.latitude=String(position.latitude);},
    setRoute(_points,options){routeUpdates+=1;assert.deepEqual(options,{fit:false});},
    fitBounds(){throw Error('camera reset during status transition');}};
  let navigationLoads=0;let heartbeatOptions;
  const navigationLoader=async()=>{
    navigationLoads+=1;
    return navigation(navigationLoads===1?map:{render(){discardedMapRenders+=1;}});
  };
  const repository={source:'supabase',load:async()=>structuredClone(state),
    updateLocation:async()=>structuredClone(state),
    updateMissionProgress:async(_id,status)=>{state={...state,assignment:{...state.assignment,status}};return structuredClone(state);},
    subscribeDispatch(){return()=>{};}};
  const app=await initialiseProviderApp(root,async()=>repository,navigationLoader,
    {enabled:false,getSession:async()=>null},options=>{heartbeatOptions=options;return{sync(){},stop(){}};},
    {getState:async()=> 'granted',request:async()=>location,geolocation:{}});
  try{
    for(let i=0;i<5;i+=1)await new Promise(resolve=>setImmediate(resolve));
    const mapElement=root.querySelector('[data-provider-map]');const originalMarker=marker;
    assert.ok(mapElement);assert.equal(renderCount,1);
    const handle=root.querySelector('[data-provider-map-resize-handle]');
    handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert.equal(mapElement.closest('.mission-map-card').classList.contains('is-map-expanded'),true);
    root.querySelector('[data-start-travel]').click();
    for(let i=0;i<8;i+=1)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.getState().assignment.status,'travelling');
    assert.equal(root.querySelector('[data-provider-map]'),mapElement);
    assert.equal(root.querySelector('[data-provider-marker]'),originalMarker);
    assert.equal(mapElement.closest('.mission-map-card').classList.contains('is-map-expanded'),true);
    assert.equal(renderCount,1);assert.equal(discardedMapRenders,0);assert.equal(routeUpdates,1);
    assert.equal(root.querySelector('[data-start-travel]'),null);
    assert.ok(root.querySelector('[data-mark-arrived]'));
    heartbeatOptions.onPosition({latitude:12.247,longitude:109.192});
    assert.equal(originalMarker.dataset.latitude,'12.247');
    assert.equal(root.querySelector('[data-provider-map]'),mapElement);
  }finally{app.stop();dom.window.close();}
});
