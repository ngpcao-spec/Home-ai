import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderIncomingOffer, updateDispatchCountdown } from '../src/provider/provider-dispatch.js';

it('renders the alert hierarchy with real data and updates only the circular countdown text',()=>{
  const offer={id:'real-offer',serviceCategory:'electricity',request:'Sửa điện',approximateAddress:'Nha Trang',distanceKm:.1,etaMinutes:2,expiresAt:new Date(30000).toISOString()};
  const dom=new JSDOM(renderIncomingOffer(offer,0));
  const doc=dom.window.document;
  assert.equal(doc.querySelector('h1').textContent,'Có nhiệm vụ mới!');
  assert.equal(doc.querySelectorAll('.dispatch-beacon i').length,3);
  assert.equal(doc.querySelector('.dispatch-price'),null);
  assert.equal(doc.querySelector('[data-accept]').dataset.accept,offer.id);
  assert.equal(doc.querySelector('[data-decline]').dataset.decline,offer.id);
  assert.ok(doc.querySelector('.dispatch-footer [data-enable-offer-audio]'));
  const overlay=doc.querySelector('.dispatch-offer');
  assert.equal(updateDispatchCountdown(doc,10000),20);
  assert.equal(doc.querySelector('[data-dispatch-countdown]').textContent,'00:20');
  assert.equal(doc.querySelector('.dispatch-offer'),overlay);
  assert.match(renderIncomingOffer({...offer,indicativeAmount:300000},0),/300\.000đ/);
  dom.window.close();
});
