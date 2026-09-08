import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { calculateProviderIncome, prepareProviderHistory, renderProviderIncome, renderProviderMissionHistory } from '../src/provider/provider-history.js';
import { createProgressiveProviderAppRepository } from '../src/provider/provider-repository.js';
import { initialiseProviderApp } from '../src/provider/provider-app.js';

const completed = {
  id: 'e2e-mission', providerId: 'provider-nha-trang', clientId: 'customer-1', status: 'completed',
  serviceCategory: 'electricity', problemDescription: 'Sửa điện trong nhà', finalAuthorizedAmount: 300000,
  currency: 'VND', paymentStatus: 'paid_external', completedAt: '2026-09-08T07:04:19Z',
  review: { rating: 5, comment: 'Dịch vụ tốt' }, clientName: 'Khách hàng E2E',
};

describe('Provider history and income', () => {
  it('keeps only completed missions owned by the authenticated provider and sorts newest first', () => {
    const history = prepareProviderHistory([
      { ...completed, id: 'older', completedAt: '2026-09-01T00:00:00Z' },
      { ...completed, id: 'other-provider', providerId: 'other-provider' },
      { ...completed, id: 'active', status: 'in_progress' },
      completed,
    ], 'provider-nha-trang');
    assert.deepEqual(history.map(({ id }) => id), ['e2e-mission', 'older']);
    assert.equal(history[0].finalAmount, 300000);
  });

  it('renders the real final amount, customer and five-star review in list and detail', () => {
    const history = prepareProviderHistory([completed], 'provider-nha-trang');
    const list = renderProviderMissionHistory(history);
    const detail = renderProviderMissionHistory(history, { selectedMissionId: 'e2e-mission' });
    for (const value of ['300.000đ', 'Khách hàng E2E', '★★★★★']) assert.match(list, new RegExp(value));
    for (const value of ['Tổng tiền cuối cùng', '300.000đ', 'Dịch vụ tốt', 'Trực tiếp cho thợ']) assert.match(detail, new RegExp(value));
  });

  it('calculates income only from completed missions with confirmed external payment', () => {
    const history = prepareProviderHistory([
      completed,
      { ...completed, id: 'unpaid', finalAuthorizedAmount: 900000, paymentStatus: 'unpaid' },
    ], 'provider-nha-trang');
    assert.deepEqual(calculateProviderIncome(history), { missionCount: 1, total: 300000, currency: 'VND' });
    const html = renderProviderIncome(history);
    assert.match(html, /300\.000đ/);
    assert.doesNotMatch(html, /1\.200\.000đ/);
    assert.match(html, /Ứng dụng không xử lý thanh toán/);
  });

  it('loads Supabase history and resolves only participating client profiles', async () => {
    const profileReads = [];
    const repository = await createProgressiveProviderAppRepository({}, undefined, () => ({
      enabled: true,
      client: { auth: { getUser: async () => ({ data: { user: { id: 'provider-nha-trang' } }, error: null }) } },
      profiles: { getById: async (id) => { profileReads.push(id); return { name: 'Khách hàng E2E' }; } },
      offers: {
        getProviderDashboard: async () => ({ provider: { id: 'provider-nha-trang' }, status: {}, offers: [], assignment: null }),
        getMissionHistory: async () => [completed],
      },
    }));
    assert.equal(repository.source, 'supabase');
    assert.deepEqual(profileReads, []);
    const history = await repository.getHistory();
    assert.deepEqual(profileReads, ['customer-1']);
    assert.equal(history[0].clientName, 'Khách hàng E2E');
  });

  it('ships touch-friendly responsive styles and real Provider navigation targets', async () => {
    const [css, app] = await Promise.all([
      readFile(new URL('../src/provider/provider-history.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/provider/provider-app.js', import.meta.url), 'utf8'),
    ]);
    assert.match(css, /@media\(max-width:380px\)/);
    assert.match(app, /data-provider-view="missions"/);
    assert.match(app, /data-provider-view="income"/);
  });

  it('does not rebuild history for an unchanged GPS heartbeat', async () => {
    const listeners = {}; let html=''; let renders=0; let heartbeatCallbacks;
    const state={provider:{id:'provider-nha-trang',name:'Provider Test Nha Trang'},status:{online:true,available:true},offers:[],assignment:null};
    const root={get innerHTML(){return html;},set innerHTML(value){html=value;renders+=1;},querySelector(){return null;},addEventListener(name,callback){listeners[name]=callback;}};
    const repository={source:'supabase',load:async()=>structuredClone(state),getHistory:async()=>[completed],updateLocation:async()=>structuredClone(state),subscribeDispatch(){return()=>{};}};
    const app=await initialiseProviderApp(root,async()=>repository,async()=>null,{enabled:false,getSession:async()=>null},callbacks=>{heartbeatCallbacks=callbacks;return{sync(){},stop(){}};},{getState:async()=>'granted',request:async()=>({latitude:12,longitude:109})});
    try{
      await listeners.click({target:{closest:selector=>selector==='[data-provider-view]'?{dataset:{providerView:'missions'}}:null}});
      const stableRenders=renders;
      await heartbeatCallbacks.onState(structuredClone(state));
      await heartbeatCallbacks.onError(new Error('GPS unavailable'));
      assert.equal(renders,stableRenders);
      assert.match(html,/Lịch sử công việc/);
    }finally{app.stop();}
  });
});
