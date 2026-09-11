import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { readProviderProfessionalProfile, renderProviderActivitiesSummary, renderProviderProfessionalProfile } from '../src/provider/provider-professional-profile.js';
import { createMockProviderAppRepository, createProgressiveProviderAppRepository } from '../src/provider/provider-repository.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { createSupabaseProvidersRepository } from '../src/supabase/repositories/providers.js';
import { createProviderProfile } from '../src/technicians/provider-profile.js';
import { createProviderProfileMarkup } from '../src/technicians/provider-profile-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Provider professional profile V1', () => {
  it('uses Vietnamese activity labels in the profile summary when activity_name is absent', () => {
    const markup = renderProviderActivitiesSummary([
      { serviceCategory: 'electricity' }, { serviceCategory: 'plumbing' },
      { serviceCategory: 'air-conditioning' }, { serviceCategory: 'appliances' },
    ]);
    for (const label of ['Thợ điện', 'Thợ sửa ống nước', 'Điều hòa', 'Điện gia dụng']) assert.match(markup, new RegExp(label));
    assert.doesNotMatch(markup, />electricity<|>plumbing<|>air-conditioning<|>appliances</);
  });

  it('renders and validates one phone, optional experience and a 300-character introduction', () => {
    const dom = new JSDOM(renderProviderProfessionalProfile({
      name: 'Provider Test', phone: '+84912345678', experienceYears: null, introduction: '',
    }));
    const form = dom.window.document.querySelector('[data-professional-profile-form]');
    assert.equal(form.querySelectorAll('[name="phone"]').length, 1);
    form.elements.phone.value = '0912 345 678';
    form.elements.experienceYears.value = '0';
    form.elements.introduction.value = 'x'.repeat(300);
    assert.deepEqual(readProviderProfessionalProfile(form), {
      valid: true, name: 'Provider Test', phone: '+84912345678', experienceYears: 0,
      introduction: 'x'.repeat(300), photoFile: null,
    });
    form.elements.experienceYears.value = '-1';
    assert.equal(readProviderProfessionalProfile(form).valid, false);
    form.elements.experienceYears.value = '2';
    form.elements.phone.value = 'invalid';
    assert.equal(readProviderProfessionalProfile(form).valid, false);
    dom.window.close();
  });

  it('shows the existing profile, activities, area, availability and KYC sections in Hồ sơ', async () => {
    const dom = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual: true });
    const root = dom.window.document.querySelector('#provider-root');
    const repository = createMockProviderAppRepository({
      provider: { id: 'p1', name: 'Provider Test', kycStatus: 'verified', serviceRadiusKm: 20 },
      status: { online: true, available: true }, offers: [], assignment: null,
      services: [{ id: 's1', providerId: 'p1', serviceCategory: 'electricity', activityName: 'Thợ điện', pricingModel: 'hourly', hourlyRate: 300000, minimumCharge: 0, enabled: true }],
    });
    const app = await initialiseProviderApp(root, async () => repository, async () => null,
      { enabled: false, getSession: async () => null }, () => ({ sync() {}, stop() {} }));
    try {
      root.querySelector('[data-provider-view="profile"]').click();
      await tick(); await tick();
      for (const text of ['Hồ sơ nghề nghiệp', 'Hoạt động của tôi', 'Khu vực hoạt động', 'Lịch nhận việc', 'Xác minh danh tính']) {
        assert.match(root.textContent, new RegExp(text));
      }
      const form = root.querySelector('[data-professional-profile-form]');
      form.elements.displayName.value = 'Nguyễn Văn Test';
      form.elements.phone.value = '0901 234 567';
      form.elements.experienceYears.value = '8';
      form.elements.introduction.value = 'Sửa chữa điện dân dụng.';
      root.querySelector('[data-save-professional-profile]').click();
      await tick(); await tick(); await tick();
      assert.match(root.textContent, /Đã lưu hồ sơ nghề nghiệp/);
      assert.equal((await repository.getProfessionalProfile()).phone, '+84901234567');
      app.stop();
      const restored = new JSDOM('<div id="provider-root"></div>', { pretendToBeVisual: true });
      const restoredRoot = restored.window.document.querySelector('#provider-root');
      const restoredApp = await initialiseProviderApp(restoredRoot, async () => repository, async () => null,
        { enabled: false, getSession: async () => null }, () => ({ sync() {}, stop() {} }));
      restoredRoot.querySelector('[data-provider-view="profile"]').click();
      await tick(); await tick();
      assert.equal(restoredRoot.querySelector('[name="displayName"]').value, 'Nguyễn Văn Test');
      assert.equal(restoredRoot.querySelector('[name="phone"]').value, '+84901234567');
      restoredApp.stop(); restored.window.close();
    } finally { app.stop(); dom.window.close(); }
  });

  it('uses self-scoped profile RPCs and a dedicated avatar bucket', async () => {
    const calls = [];
    const storageCalls = [];
    const client = {
      from() { return {}; },
      rpc: async (name, args) => { calls.push([name, args]); return { data: {
        providerId: 'p1', name: 'Provider', phone: '+84912345678', avatarPath: 'p1/avatar/a.jpg',
        experienceYears: 4, introduction: 'Test', kycStatus: 'verified', ratingAverage: 5, reviewCount: 1,
      }, error: null }; },
      auth: { getUser: async () => ({ data: { user: { id: 'p1' } }, error: null }) },
      storage: { from: bucket => ({
        getPublicUrl: path => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
        upload: async (path) => { storageCalls.push(['upload', bucket, path]); return { data: {}, error: null }; },
        remove: async paths => { storageCalls.push(['remove', bucket, paths]); return { data: {}, error: null }; },
      }) },
    };
    const repository = createSupabaseOffersRepository(client);
    const current = await repository.getCurrentProviderProfessionalProfile();
    assert.equal(current.avatarUrl, 'https://storage.test/provider-avatars/p1/avatar/a.jpg');
    await repository.updateCurrentProviderProfessionalProfile({ name: 'Provider', phone: '+84912345678', experienceYears: 4, introduction: 'Test', avatarPath: 'p1/avatar/a.jpg' });
    const file = { type: 'image/jpeg', size: 10 };
    await repository.uploadCurrentProviderAvatar(file);
    assert.deepEqual(calls.map(([name]) => name), ['get_current_provider_professional_profile', 'update_current_provider_professional_profile']);
    assert.equal(calls.some(([, args]) => args && ('provider_id' in args || 'user_id' in args)), false);
    assert.equal(storageCalls[0][1], 'provider-avatars');
  });

  it('uploads a replacement, saves its path, then removes the previous avatar through Storage', async () => {
    const calls = [];
    const offers = {
      getCurrentProviderKycState: async () => ({ provider: { id: 'p1', kycStatus: 'verified' } }),
      getProviderDashboard: async () => ({ provider: { id: 'p1' }, status: {}, offers: [], assignment: null }),
      getCurrentProviderProfessionalProfile: async () => ({ providerId: 'p1', avatarPath: 'p1/avatar/old.jpg' }),
      uploadCurrentProviderAvatar: async () => ({ path: 'p1/avatar/new.jpg', url: '/new.jpg' }),
      updateCurrentProviderProfessionalProfile: async profile => { calls.push(['save', profile.avatarPath]); return profile; },
      deleteCurrentProviderAvatar: async path => { calls.push(['delete', path]); },
    };
    const repository = await createProgressiveProviderAppRepository({}, null, () => ({
      enabled: true, client: { auth: { getUser: async () => ({ data: { user: { id: 'p1' } }, error: null }) } }, offers,
    }));
    await repository.saveProfessionalProfile({
      name: 'Provider', phone: '+84912345678', experienceYears: 4,
      introduction: 'Test', photoFile: { type: 'image/jpeg', size: 10 },
    });
    assert.deepEqual(calls, [['save', 'p1/avatar/new.jpg'], ['delete', 'p1/avatar/old.jpg']]);
  });

  it('requests a safe client profile and only renders the phone when returned by the backend', async () => {
    const calls = [];
    const client = {
      from() { return {}; },
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'get_profile_phone') return { data: '+84912345678', error: null };
        return { data: {
          providerId: 'p1', name: 'Provider A', avatarPath: null, verified: true,
          ratingAverage: 4.8, reviewCount: 12, experienceYears: 7, introduction: 'Điện dân dụng',
          phone: args.target_mission_id ? '+84912345678' : null,
          activities: [{ serviceCategory: 'electricity', name: 'Thợ điện' }],
        }, error: null };
      },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    };
    const repository = createSupabaseProvidersRepository(client);
    const before = await repository.getProfessionalProfile('p1');
    const beforeMarkup = createProviderProfileMarkup(createProviderProfile({ id: 'p1', category: 'electricity', ...before }));
    assert.doesNotMatch(beforeMarkup, /tel:/);
    assert.doesNotMatch(beforeMarkup, /Khu vực phục vụ|Ngôn ngữ|Đánh giá gần đây/);
    const after = await repository.getProfessionalProfile('p1', 'm1');
    const contact = await repository.getAssignedContact('p1');
    const afterMarkup = createProviderProfileMarkup(createProviderProfile({ id: 'p1', category: 'electricity', ...after }));
    assert.match(afterMarkup, /tel:\+84912345678/);
    assert.equal(contact.phone, '+84912345678');
    assert.deepEqual(calls[0], ['get_provider_professional_profile', { target_provider_id: 'p1', target_mission_id: null }]);
    assert.deepEqual(calls.at(-1), ['get_profile_phone', { target_user_id: 'p1' }]);
  });

  it('keeps profile photos separate from KYC and enforces server-side privacy in SQL', async () => {
    const [migration, sqlTest, providerRepository] = await Promise.all([
      readFile(new URL('../supabase/migrations/20260911060203_provider_professional_profile.sql', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/tests/018_provider_professional_profile.sql', import.meta.url), 'utf8'),
      readFile(new URL('../src/supabase/repositories/providers.js', import.meta.url), 'utf8'),
    ]);
    assert.match(migration, /values\('provider-avatars','provider-avatars',true/);
    assert.match(migration, /bucket_id='provider-avatars'/);
    assert.match(migration, /\(storage\.foldername\(name\)\)\[1\]=\(select auth\.uid\(\)\)::text/);
    assert.match(migration, /case when can_view_phone then p\.phone else null end/);
    assert.match(migration, /m\.client_id=uid and m\.provider_id=target_provider_id/);
    assert.match(migration, /create or replace function public\.get_profile_phone/);
    assert.match(migration, /m\.status in \('accepted','travelling','arrived','quote_pending','in_progress'/);
    assert.doesNotMatch(migration, /identity_number.*jsonb_build_object\([\s\S]*get_provider_professional_profile/);
    const matchingProjection = providerRepository.match(/const providerColumns = `([\s\S]*?)`;/)?.[1] ?? '';
    assert.doesNotMatch(matchingProjection, /phone/);
    assert.match(sqlTest, /Phone exposed before an accepted mission/);
    assert.match(sqlTest, /Legacy phone RPC exposed provider before acceptance/);
    assert.match(sqlTest, /Other customer can see provider phone/);
    assert.match(sqlTest, /KYC bucket became public/);
  });
});
