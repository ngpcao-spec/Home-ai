import assert from 'node:assert/strict';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { createProviderGpsDiagnostics } from '../src/provider/provider-gps-diagnostics.js';

it('shows local GPS counters and rejection reasons without logging or persistence', () => {
  const dom=new JSDOM('<body></body>');let mapPosition={latitude:12.245,longitude:109.19};
  const panel=createProviderGpsDiagnostics(dom.window.document,{enabled:true,isTravelling:()=>true,getMapPosition:()=>mapPosition,getMarkerState:()=>({position:mapPosition,updatedAt:103,moves:2,markerCount:1,instanceId:4,mapInstanceId:2,attached:true})});
  panel.record({outcome:'watch-started',watchId:9});
  panel.record({stage:'provider',outcome:'callback',receivedAt:100,position:{coords:{latitude:12.246,longitude:109.191,accuracy:7},timestamp:101}});
  panel.record({stage:'provider',outcome:'position-accepted'});
  panel.record({stage:'provider',outcome:'rejected',reason:'stale-or-equal-timestamp'});
  panel.record({stage:'backend',outcome:'accepted',position:{latitude:12.246,longitude:109.191},sentAt:102});
  mapPosition={latitude:12.246,longitude:109.191};panel.sync();
  const host=dom.window.document.querySelector('[data-provider-gps-diagnostics]');
  assert.match(host.textContent,/ACTIF/);assert.match(host.textContent,/Callbacks: 1 \| Accepted: 1 \| Rejected: 1/);
  assert.match(host.textContent,/stale-or-equal-timestamp/);assert.match(host.textContent,/12.246 \/ 109.191/);
  assert.match(host.textContent,/Position carte: 12.246 \/ 109.191/);
  assert.match(host.textContent,/Position marker: 12.246 \/ 109.191/);
  assert.match(host.textContent,/Déplacements marker: 2/);assert.match(host.textContent,/Markers Provider présents: 1/);assert.match(host.textContent,/#4 \/ #2 · attaché/);
  panel.stop();assert.equal(dom.window.document.querySelector('[data-provider-gps-diagnostics]'),null);
});
