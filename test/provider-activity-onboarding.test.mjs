import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { adaptProviderActivityProposal, analyzeProviderActivity } from '../src/provider/provider-activity-ai.js';
import { readProviderActivityEdit, readProviderActivityPricing, renderProviderActivities } from '../src/provider/provider-activities.js';
import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';

const proposal = Object.freeze({ serviceCategory: 'electricity', activityName: 'Thợ điện',
  description: 'Sửa chữa và lắp đặt điện dân dụng.', pricingModel: 'hourly' });
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Provider activity onboarding', () => {
  it('renders the validated four-screen hierarchy and leaves unknown reference pricing empty', () => {
    const list = renderProviderActivities([{ ...proposal, enabled: true, hourlyRate: 300000 }]);
    assert.match(list, /Hoạt động của tôi/);
    assert.match(list, /Thợ điện/);
    assert.match(list, /300\.000đ\/giờ/);
    assert.match(list, /data-add-activity/);
    const choice = renderProviderActivities([], { step: 'choose' });
    assert.match(choice, /Cho biết nghề nghiệp của tôi/);
    assert.match(choice, /Mô tả công việc tôi làm/);
    assert.equal((choice.match(/data-activity-mode=/g) ?? []).length, 2);
    const understood = renderProviderActivities([], { step: 'proposal', proposal,
      reference: { medianHourlyRate: 300000, providerCount: 8, radiusKm: 5 } });
    for (const text of ['Đề xuất của HOME AI', 'Đây là những gì tôi hiểu', 'Theo giờ',
      'Tarif médian HOME AI : 300.000đ/giờ', 'Basé sur 8 providers']) assert.match(understood, new RegExp(text));
    assert.doesNotMatch(understood, /5 km|radius_km|hourly_rates/);
    const noReference = renderProviderActivities([], { step: 'rate', proposal,
      reference: { medianHourlyRate: null, providerCount: 0, radiusKm: null } });
    const dom = new JSDOM(noReference);
    assert.equal(dom.window.document.querySelector('[data-activity-hourly-rate]').value, '');
    assert.equal(dom.window.document.querySelector('[data-activity-minimum-charge]').value, '0');
    assert.equal(dom.window.document.querySelector('[data-activity-minimum-charge]').required, true);
    dom.window.document.querySelector('[data-activity-hourly-rate]').value = '300000';
    assert.equal(readProviderActivityPricing(dom.window.document).valid, true);
    dom.window.document.querySelector('[data-activity-minimum-charge]').value = '';
    assert.equal(readProviderActivityPricing(dom.window.document).valid, false);
    assert.doesNotMatch(noReference, /Tarif conseillé par HOME AI/);
  });

  it('shows user-facing Vietnamese activity names and never technical category ids', () => {
    const markup = renderProviderActivities([
      { id: 'e', serviceCategory: 'electricity', pricingModel: 'hourly', hourlyRate: 1, enabled: true },
      { id: 'p', serviceCategory: 'plumbing', pricingModel: 'hourly', hourlyRate: 1, enabled: true },
      { id: 'a', serviceCategory: 'air-conditioning', pricingModel: 'hourly', hourlyRate: 1, enabled: true },
      { id: 'h', serviceCategory: 'appliances', pricingModel: 'hourly', hourlyRate: 1, enabled: true },
      { id: 'x', serviceCategory: 'future-technical-id', pricingModel: 'hourly', hourlyRate: 1, enabled: true },
    ]);
    for (const label of ['Thợ điện', 'Thợ sửa ống nước', 'Điều hòa', 'Điện gia dụng', 'Dịch vụ HOME AI']) {
      assert.match(markup, new RegExp(label));
    }
    assert.doesNotMatch(markup, />electricity<|>plumbing<|>air-conditioning<|>appliances<|future-technical-id/);
  });

  it('runs list → profession → AI proposal → rate → create without extra selection steps', async () => {
    const dom = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual: true });
    const root = dom.window.document.querySelector('#provider-root');
    const repository = createMockProviderAppRepository({
      provider: { id: 'p1', name: 'Provider Test' }, status: { online: true, available: true },
      offers: [], assignment: null, services: [],
    });
    const app = await initialiseProviderApp(root, async () => repository, async () => null,
      { enabled: false, getSession: async () => null }, () => ({ sync() {}, stop() {} }));
    try {
      root.querySelector('[data-provider-view="activities"]').click();
      await tick(); await tick();
      assert.match(root.textContent, /Hoạt động của tôi/);
      root.querySelector('[data-add-activity]').click(); await tick();
      assert.equal(root.querySelectorAll('[data-activity-mode]').length, 2);
      root.querySelector('[data-activity-mode="profession"]').click(); await tick();
      root.querySelector('[data-activity-input]').value = 'Électricien';
      root.querySelector('[data-analyze-activity]').click();
      await tick(); await tick(); await tick();
      assert.match(root.textContent, /Thợ điện/);
      assert.match(root.textContent, /300\.000đ\/giờ/);
      root.querySelector('[data-activity-continue]').click(); await tick();
      assert.equal(root.querySelector('[data-activity-hourly-rate]').value, '300000');
      root.querySelector('[data-activity-hourly-rate]').value = '350000';
      root.querySelector('[data-activity-minimum-charge]').value = '125000';
      assert.equal(readProviderActivityPricing(root).valid, true);
      root.querySelector('[data-create-activity]').click();
      await tick(); await tick(); await tick();
      assert.match(root.textContent, /Đã thêm hoạt động/);
      assert.match(root.textContent, /Thợ điện/);
      assert.match(root.textContent, /350\.000đ\/giờ/);
    } finally { app.stop(); dom.window.close(); }
  });

  it('opens an existing activity with editable pricing and activation', () => {
    const service = { id:'s1', ...proposal, hourlyRate:300000, minimumCharge:400000, enabled:true };
    const edit = renderProviderActivities([service], { step:'edit', service });
    const dom = new JSDOM(edit);
    const document = dom.window.document;
    assert.match(document.body.textContent, /Chỉnh sửa hoạt động/);
    assert.match(document.body.textContent, /Lưu thay đổi/);
    assert.equal(document.querySelector('[data-activity-hourly-rate]').required, true);
    assert.equal(document.querySelector('[data-activity-minimum-charge]').required, true);
    assert.equal(document.querySelector('[data-activity-enabled]').checked, true);
    document.querySelector('[data-activity-hourly-rate]').value='350000';
    document.querySelector('[data-activity-minimum-charge]').value='0';
    document.querySelector('[data-activity-enabled]').checked=false;
    assert.deepEqual(readProviderActivityEdit(document), {valid:true,hourlyRate:350000,minimumCharge:0,enabled:false});
    assert.doesNotMatch(edit, /Supprimer|Xóa/);
    dom.window.close();
  });

  it('runs activity card → edit → save and refreshes the activity list', async () => {
    const dom = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual:true });
    const root=dom.window.document.querySelector('#provider-root');
    const repository=createMockProviderAppRepository({provider:{id:'p1',name:'Provider Test'},status:{online:true,available:true},offers:[],assignment:null,
      services:[{id:'s1',...proposal,hourlyRate:300000,minimumCharge:400000,enabled:true}]});
    const app=await initialiseProviderApp(root,async()=>repository,async()=>null,
      {enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}));
    try {
      root.querySelector('[data-provider-view="activities"]').click();await tick();await tick();
      root.querySelector('[data-provider-activity="s1"]').click();await tick();
      assert.match(root.textContent,/Chỉnh sửa hoạt động/);
      root.querySelector('[data-activity-hourly-rate]').value='375000';
      root.querySelector('[data-activity-minimum-charge]').value='0';
      root.querySelector('[data-activity-enabled]').checked=false;
      root.querySelector('[data-save-activity]').click();await tick();await tick();await tick();
      assert.match(root.textContent,/Đã lưu thay đổi/);
      assert.match(root.textContent,/375\.000đ\/giờ/);
      assert.match(root.textContent,/Đã tắt/);
    } finally { app.stop();dom.window.close(); }
  });

  it('uses only the authenticated Edge Function and aggregate RPC from the browser', async () => {
    const calls = [];
    const client = {
      from() { return {}; },
      functions: { invoke: async (name, options) => { calls.push(['function', name, options]); return { data: proposal, error: null }; } },
      rpc: async (name, args) => {
        calls.push(['rpc', name, args]);
        if (name === 'get_current_provider_hourly_rate_reference') return { data: { median_hourly_rate: 300000, provider_count: 8, radius_km: 5 }, error: null };
        return { data: { id: 's1', provider_id: 'p1', service_category: 'electricity', activity_name: 'Thợ điện',
          activity_description: proposal.description, pricing_model: 'hourly', hourly_rate: 300000,
          minimum_charge: 400000, currency: 'VND', enabled: true }, error: null };
      },
    };
    assert.deepEqual(await analyzeProviderActivity(client, { inputMode: 'profession', text: 'Électricien' }), proposal);
    const repository = createSupabaseOffersRepository(client);
    assert.deepEqual(await repository.getCurrentProviderHourlyRateReference('electricity'),
      { medianHourlyRate: 300000, providerCount: 8, radiusKm: 5 });
    await repository.createCurrentProviderActivity(proposal, { hourlyRate: 300000, minimumCharge: 400000 });
    await repository.updateCurrentProviderActivity('s1', { hourlyRate: 350000, minimumCharge: 0, enabled: false });
    assert.deepEqual(calls[0], ['function', 'classify-provider-activity',
      { body: { inputMode: 'profession', text: 'Électricien' } }]);
    assert.equal(calls.some(([, , args]) => args && ('provider_id' in args || 'service_role' in args)), false);
    assert.deepEqual(calls.at(-1), ['rpc', 'update_current_provider_activity', {
      target_provider_service_id:'s1', new_hourly_rate:350000, new_minimum_charge:0, new_enabled:false,
    }]);
  });

  it('strictly validates the AI contract', () => {
    assert.deepEqual(adaptProviderActivityProposal(proposal), proposal);
    assert.throws(() => adaptProviderActivityProposal({ ...proposal, hourlyRate: 300000 }), /AI_INVALID_RESPONSE/);
    assert.throws(() => adaptProviderActivityProposal({ ...proposal, pricingModel: 'unknown' }), /AI_INVALID_RESPONSE/);
  });

  it('secures AI authentication and sends no peer pricing or personal data to OpenAI', async () => {
    const [edge, contract, instructions, config] = await Promise.all([
      readFile(new URL('../supabase/functions/classify-provider-activity/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/functions/_shared/provider-activity-contract.ts', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/functions/_shared/provider-activity-instructions.js', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
    ]);
    assert.match(config, /\[functions\.classify-provider-activity\][\s\S]*verify_jwt = true/);
    assert.equal((config.match(/\[functions\.classify-provider-activity\]/g) ?? []).length, 1);
    assert.match(edge, /auth\.getUser\(token\)/);
    assert.match(edge, /profile\?\.role !== 'provider'/);
    assert.match(edge, /Deno\.env\.get\('OPENAI_API_KEY'\)/);
    assert.doesNotMatch(edge, /service|provider_status|mission_invoices|hourly_rate|median_hourly_rate/);
    assert.match(instructions, /Do not return price advice/);
    assert.match(contract, /'hourly', 'daily', 'fixed', 'per_unit', 'rental_daily', 'quote'/);
  });

  it('keeps median, provider deduplication and 5/10/20 km expansion in PostgreSQL', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20260911000100_historical_hourly_rate_reference.sql', import.meta.url), 'utf8');
    assert.match(sql, /m\.status='completed'/);
    assert.match(sql, /m\.provider_id<>uid/);
    assert.match(sql, /join public\.mission_invoices mi on mi\.mission_id=m\.id/);
    assert.match(sql, /select distinct on \(cm\.provider_id\)/);
    assert.match(sql, /values \(5::double precision,1\),\(10::double precision,2\),\(20::double precision,3\)/);
    assert.match(sql, /order by r\.priority limit 1/);
    assert.match(sql, /order by lm\.completed_at desc,lm\.mission_id desc/);
    assert.match(sql, /percentile_cont\(0\.5\) within group\(order by hourly_rate\)/);
    assert.doesNotMatch(sql, /mi\.worked_minutes|mi\.labor_amount|mi\.material_amount|mi\.total_amount/);
    assert.doesNotMatch(sql, /join public\.provider_services/);
    assert.match(sql, /jsonb_build_object\([\s\S]*'median_hourly_rate',median_rate,[\s\S]*'provider_count',[\s\S]*'radius_km'/);
  });

  it('binds activity creation to auth.uid and preserves existing RLS', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20260910001600_provider_activity_onboarding.sql', import.meta.url), 'utf8');
    assert.match(sql, /uid uuid := \(select auth\.uid\(\)\)/);
    assert.match(sql, /private\.profile_has_role\(uid,'provider'\)/);
    assert.match(sql, /values\(\s*uid,normalized_category,null,'VND',true,'hourly'/);
    assert.match(sql, /revoke all on function public\.create_current_provider_activity[\s\S]*from public,anon/);
    assert.doesNotMatch(sql, /disable row level security|drop policy|create policy/);
  });

  it('binds activity edits to auth.uid and preserves immutable historical pricing', async () => {
    const [sql, historical, dispatch] = await Promise.all([
      readFile(new URL('../supabase/migrations/20260911000227_edit_provider_activity.sql', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/migrations/20260911000100_historical_hourly_rate_reference.sql', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/migrations/20260903001000_realtime_provider_dispatch.sql', import.meta.url), 'utf8'),
    ]);
    assert.match(sql, /where id = target_provider_service_id and provider_id = uid/);
    assert.match(sql, /minimum_charge = new_minimum_charge/);
    assert.match(sql, /enabled = new_enabled/);
    assert.doesNotMatch(sql, /update public\.missions|update public\.mission_invoices|disable row level security|create policy|drop policy/);
    assert.match(historical, /join public\.mission_invoices mi/);
    assert.doesNotMatch(historical, /join public\.provider_services/);
    assert.match(dispatch, /svc\.service_category=mission_row\.service_category and svc\.enabled/);
    assert.match(dispatch, /service_row\.id is null or not service_row\.enabled/);
  });
});
