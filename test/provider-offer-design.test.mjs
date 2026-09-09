import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createIncomingOfferLayer, renderIncomingOffer, updateDispatchCountdown } from '../src/provider/provider-dispatch.js';

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

it('remplace brièvement l’offre par la confirmation de mission acceptée',()=>{
  const dom=new JSDOM('<div id="root"></div>');
  const layer=createIncomingOfferLayer(dom.window.document.querySelector('#root'));
  layer.sync({id:'o1',serviceCategory:'electricity',request:'Test',approximateAddress:'Nha Trang',expiresAt:new Date(Date.now()+60000).toISOString()});
  layer.confirm();
  assert.equal(dom.window.document.querySelector('.dispatch-offer'),null);
  assert.equal(dom.window.document.querySelector('.mission-accepted-check').textContent,'✓');
  assert.match(layer.host.textContent,/Đã nhận nhiệm vụ!.*Đang mở chi tiết nhiệm vụ/s);
  layer.stop();dom.window.close();
});
