import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { calculateHourlyInvoice } from '../src/billing/hourly-pricing.js';
import { createCompletionSummaryMarkup, getCompletedMissionPricePresentation } from '../src/mission/completion-summary.js';
import { createCustomerMissionStateFromServer, createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';
import { initialiseProviderApp, renderProviderDashboard } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';
import { readHourlyInvoiceForm, updateHourlyInvoiceForm } from '../src/provider/hourly-invoice-form.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';

const pricing = Object.freeze({ pricingModel: 'hourly', hourlyRate: 300000, minimumCharge: 400000, currency: 'VND' });
const calculate = (hours, minutes, materialAmount = 0, overrides = {}) => calculateHourlyInvoice({
  ...pricing, ...overrides, hours, minutes, materialAmount,
});

describe('Provider hourly billing V1', () => {
  it('applies a free minimum below one hour and at exactly one hour', () => {
    assert.deepEqual(calculate(0, 30), {
      pricingModel: 'hourly', hourlyRate: 300000, minimumCharge: 400000,
      hours: 0, minutes: 30, workedMinutes: 30, laborAmount: 400000,
      materialAmount: 0, totalAmount: 400000, currency: 'VND',
    });
    assert.equal(calculate(1, 0).laborAmount, 400000);
    assert.equal(calculate(0, 30, 0, { minimumCharge: 50000 }).laborAmount, 150000);
  });

  it('calculates 1h35, several hours, materials and deterministic VND rounding', () => {
    const example = calculate(1, 35, 150000);
    assert.equal(example.workedMinutes, 95);
    assert.equal(example.laborAmount, 475000);
    assert.equal(example.totalAmount, 625000);
    assert.equal(calculate(3, 0).laborAmount, 900000);
    assert.equal(calculate(1, 35, 0).materialAmount, 0);
    assert.equal(calculate(0, 1, 0, { hourlyRate: 100000, minimumCharge: 0 }).laborAmount, 1667);
  });

  it('keeps the editable form mounted and calculates the visible summary before send', () => {
    const dom = new JSDOM(`<main>${renderProviderDashboard({
      provider: { name: 'Provider Test' }, status: { online: true }, offers: [],
      assignment: { id: 'm1', serviceCategory: 'electricity', request: 'Sửa điện', address: 'Nha Trang',
        status: 'in_progress', pricing, quote: { id: 'q1', version: 1, status: 'accepted', diagnosis: 'Sửa', totalAmount: 200000 } },
    }, { source: 'supabase', billing: true })}</main>`);
    const root = dom.window.document;
    root.querySelector('[data-invoice-hours]').value = '1';
    root.querySelector('[data-invoice-minutes]').value = '35';
    root.querySelector('[data-invoice-material]').value = '150000';
    const hoursNode = root.querySelector('[data-invoice-hours]');
    updateHourlyInvoiceForm(root, pricing, true, false);
    assert.equal(root.querySelector('[data-invoice-hours]'), hoursNode);
    assert.match(root.querySelector('[data-invoice-labor]').textContent, /475\.000đ/);
    assert.match(root.querySelector('[data-invoice-total]').textContent, /625\.000đ/);
    assert.equal(root.querySelector('[data-send-invoice]').disabled, false);
    assert.equal(readHourlyInvoiceForm(root, pricing).invoice.totalAmount, 625000);
  });

  it('runs hourly arrival → no fixed quote → intervention → 1h35 invoice → payment wait', async () => {
    const dom = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual: true });
    const root = dom.window.document.querySelector('#provider-root');
    const repository = createMockProviderAppRepository({
      provider: { id: 'p1', name: 'Provider Test' }, status: { online: true, available: false }, offers: [],
      services: [{ id: 's1', providerId: 'p1', serviceCategory: 'electricity', ...pricing, enabled: true }],
      assignment: { id: 'm1', serviceCategory: 'electricity', request: 'Sửa điện', address: 'Nha Trang',
        status: 'arrived', pricing, quote: null },
    });
    const app = await initialiseProviderApp(root, async () => repository, async () => null,
      { enabled: false, getSession: async () => null }, () => ({ sync() {}, stop() {} }));
    try {
      assert.ok(root.querySelector('[data-hourly-intervention-ready]'));
      assert.equal(root.querySelector('[data-quote-labor]'), null);
      assert.equal(root.querySelector('[data-quote-parts]'), null);
      assert.equal(root.querySelector('[data-send-quote]'), null);
      root.querySelector('[data-start-intervention]').click();
      for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(app.getState().assignment.status, 'in_progress');
      assert.ok(root.querySelector('[data-hourly-intervention-progress]'));
      root.querySelector('[data-finish-intervention]').click();
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(root.querySelector('[data-hourly-invoice-form]'));
      root.querySelector('[data-invoice-hours]').value = '1';
      root.querySelector('[data-invoice-minutes]').value = '35';
      root.querySelector('[data-invoice-material]').value = '150000';
      root.querySelector('[data-invoice-material]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      root.querySelector('[data-send-invoice]').click();
      for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(app.getState().assignment.status, 'completed_pending_payment');
      assert.equal(app.getState().assignment.invoice.totalAmount, 625000);
      assert.ok(root.querySelector('[data-provider-completion-waiting]'));
      assert.equal(root.querySelector('[data-hourly-invoice-form]'), null);

      const invoice = app.getState().assignment.invoice;
      const customerState = createCustomerMissionStateFromServer({
        mission: { id: 'm1', status: 'completed_pending_payment', paymentStatus: 'pending',
          completedAt: null, finalAuthorizedAmount: 625000, currency: 'VND' },
        quotes: [], invoice,
      });
      assert.equal(getCompletedMissionPricePresentation(customerState.quoteHistory,
        customerState.completion?.finalAuthorizedAmount).amount, 625000);
      const customerMarkup = createCompletionSummaryMarkup(customerState.completion, customerState.quoteHistory);
      for (const text of ['HÓA ĐƠN', '1 giờ 35 phút', '300.000đ/giờ', '400.000đ', '475.000đ', '150.000đ', '625.000đ']) {
        assert.match(customerMarkup, new RegExp(text));
      }
      assert.doesNotMatch(customerMarkup, /Đang cập nhật|Báo giá cuối cùng đã chấp nhận/);
    } finally { app.stop(); dom.window.close(); }
  });

  it('submits only duration and material to the server-owned calculation RPC', async () => {
    const calls = [];
    const client = { from() { throw new Error('not used'); }, rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: { id: 'i1', mission_id: 'm1', provider_id: 'p1', client_id: 'c1', provider_service_id: 's1',
        pricing_model: 'hourly', worked_minutes: 95, hourly_rate: 300000, minimum_charge: 400000,
        labor_amount: 475000, material_amount: 150000, total_amount: 625000, currency: 'VND', submitted_at: '2026-09-10T00:00:00Z' }, error: null };
    } };
    const result = await createSupabaseOffersRepository(client).submitHourlyInvoice('m1', 8, calculate(1, 35, 150000));
    assert.equal(result.totalAmount, 625000);
    assert.deepEqual(calls[0], ['submit_current_provider_hourly_invoice', {
      target_mission_id: 'm1', expected_version: 8, new_worked_hours: 1,
      new_worked_minutes: 35, new_material_amount: 150000,
    }]);
    assert.equal('labor_amount' in calls[0][1], false);
    assert.equal('total_amount' in calls[0][1], false);
  });

  it('reloads the persisted hourly invoice through realtime and polling after provider submission', async () => {
    let mission = { id: 'm1', providerId: 'p1', status: 'in_progress', version: 6,
      finalAuthorizedAmount: null, currency: 'VND' };
    let invoice = null;
    let realtime;
    let poll;
    const received = [];
    const synchronizer = createCustomerMissionSynchronizer({
      missionRepository: {
        getById: async () => mission,
        getQuoteHistory: async () => [],
        getOffers: async () => [],
        getReview: async () => null,
        getInvoice: async () => invoice,
        subscribeMission(id, callback) { assert.equal(id, 'm1'); realtime = callback; return () => {}; },
      },
      providerRepository: { getById: async () => ({ id: 'p1', name: 'Provider Test Nha Trang' }) },
      scheduleTask(callback) { poll = callback; return 1; },
      clearTask() {},
    });
    const stopRealtime = synchronizer.subscribe('m1', snapshot => received.push(snapshot), assert.fail);
    const stopPolling = synchronizer.poll('m1', snapshot => received.push(snapshot), assert.fail);
    mission = { ...mission, status: 'completed_pending_payment', version: 7, finalAuthorizedAmount: 625000 };
    invoice = { id: 'i1', missionId: 'm1', pricingModel: 'hourly', workedMinutes: 95,
      hourlyRate: 300000, minimumCharge: 400000, laborAmount: 475000,
      materialAmount: 150000, totalAmount: 625000, currency: 'VND' };
    await realtime({ new: { event_type: 'mission.invoice.submitted' } });
    await poll();
    assert.equal(received.length, 2);
    for (const snapshot of received) {
      assert.equal(snapshot.invoice.id, 'i1');
      const state = createCustomerMissionStateFromServer(snapshot);
      assert.equal(state.completion.invoice.totalAmount, 625000);
      assert.equal(state.completion.finalAuthorizedAmount, 625000);
    }
    stopRealtime();
    stopPolling();
  });

  it('keeps an already submitted invoice unchanged after a future service-rate edit and handles a retry idempotently', async () => {
    const repository = createMockProviderAppRepository({
      provider: { id: 'p1', name: 'Provider Test' }, status: { online: true, available: false }, offers: [],
      services: [{ id: 's1', providerId: 'p1', serviceCategory: 'electricity', ...pricing, enabled: true }],
      assignment: { id: 'm1', serviceCategory: 'electricity', status: 'in_progress', pricing,
        quote: { id: 'q1', version: 1, status: 'accepted' } },
    });
    const invoice = calculate(1, 35, 150000);
    await repository.submitHourlyInvoice('m1', invoice);
    await repository.setServicePricing('electricity', { hourlyRate: 500000, minimumCharge: 600000 });
    const retry = await repository.submitHourlyInvoice('m1', invoice);
    assert.equal(retry.assignment.invoice.hourlyRate, 300000);
    assert.equal(retry.assignment.invoice.minimumCharge, 400000);
    assert.equal(retry.assignment.invoice.totalAmount, 625000);
    await assert.rejects(() => repository.submitHourlyInvoice('m1', calculate(2, 0)), /already submitted/);
  });

  it('shows the immutable server invoice to the customer without recalculation', () => {
    const invoice = { ...calculate(1, 35, 150000), id: 'i1' };
    const markup = createCompletionSummaryMarkup({ completedWork: ['Sửa điện'], finalAuthorizedAmount: 625000,
      warrantyDays: 30, invoice }, [{ version: 1, status: 'accepted', totalAmount: 200000 }]);
    for (const value of ['HÓA ĐƠN', '1 giờ 35 phút', '300.000đ/giờ', '400.000đ', '475.000đ', '150.000đ', '625.000đ']) {
      assert.match(markup, new RegExp(value));
    }
  });

  it('enforces participant security, snapshots, immutability, idempotence and lifecycle in SQL', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20260910001300_provider_hourly_billing.sql', import.meta.url), 'utf8');
    for (const model of ['hourly', 'daily', 'fixed', 'per_unit', 'rental_daily', 'quote']) assert.match(sql, new RegExp(`'${model}'`));
    assert.match(sql, /create table public\.mission_invoices/);
    assert.match(sql, /add column pricing_model text not null default 'quote'/);
    assert.match(sql, /add column hourly_rate bigint,\s+add column minimum_charge bigint,/);
    assert.doesNotMatch(sql, /set pricing_model='hourly', hourly_rate=base_price/);
    assert.match(sql, /pricing_model <> 'hourly' and hourly_rate is null and minimum_charge is null/);
    assert.match(sql, /p\.display_name='Provider Test Nha Trang'[\s\S]*ps\.service_category='electricity'/);
    assert.match(sql, /set pricing_model='hourly', hourly_rate=300000, minimum_charge=400000/);
    assert.match(sql, /if configured_rows <> 1 then/);
    assert.match(sql, /unique references public\.missions/);
    assert.match(sql, /mission_invoices_append_only[\s\S]*prevent_append_only_mutation/);
    assert.match(sql, /mission_row\.provider_id is distinct from uid[\s\S]*42501/);
    assert.match(sql, /client_id=\(select auth\.uid\(\)\) or provider_id=\(select auth\.uid\(\)\)/);
    assert.match(sql, /existing_invoice\.worked_minutes=total_worked_minutes[\s\S]*return existing_invoice/);
    assert.match(sql, /Mission invoice was already submitted/);
    assert.match(sql, /hourly_rate,minimum_charge,labor_amount,material_amount,total_amount/);
    assert.match(sql, /calculated_labor:=greatest\(service_row\.minimum_charge/);
    assert.match(sql, /final_authorized_amount=result\.total_amount,status='completed_pending_payment'/);
    assert.match(sql, /revoke all on function public\.finish_current_provider_intervention\(uuid,integer\) from public,anon,authenticated/);
    assert.match(sql, /where \(user_role='customer' and m\.client_id=uid\) or \(user_role='provider' and m\.provider_id=uid\)/);
  });

  it('branches server intervention by pricing model and invoices hourly work without a fixed quote', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20260910001500_hourly_intervention_without_quote.sql', import.meta.url), 'utf8');
    assert.match(sql, /if service_row\.pricing_model='hourly' then[\s\S]*mission_row\.status<>'arrived'/);
    assert.match(sql, /else[\s\S]*accepted_quote[\s\S]*mission_row\.status<>'quote_pending'/);
    assert.match(sql, /accepted_quote\.id is null or accepted_quote\.type<>'initial'/);
    assert.match(sql, /mission_row\.status<>'in_progress'/);
    assert.doesNotMatch(sql, /submit_current_provider_hourly_invoice[\s\S]*accepted_quote/);
    assert.match(sql, /calculated_labor:=greatest\(service_row\.minimum_charge,[\s\S]*service_row\.hourly_rate\*total_worked_minutes\+30/);
    assert.match(sql, /final_authorized_amount=result\.total_amount,status='completed_pending_payment'/);
  });

  it('keeps legacy base prices separate until hourly pricing is explicitly configured', async () => {
    const rows = [{ id: 's1', provider_id: 'p1', service_category: 'electricity', base_price: 150000,
      pricing_model: 'quote', hourly_rate: null, minimum_charge: null, currency: 'VND', enabled: true }];
    const client = { from(table) {
      assert.equal(table, 'provider_services');
      return { select() { return this; }, eq() { return this; }, order: async () => ({ data: rows, error: null }) };
    }, rpc() { throw new Error('not used'); } };
    const [service] = await createSupabaseOffersRepository(client).listCurrentProviderServices('p1');
    assert.equal(service.pricingModel, 'quote');
    assert.equal(service.legacyBasePrice, 150000);
    assert.equal(service.hourlyRate, null);
    assert.equal(service.minimumCharge, null);
  });
});
