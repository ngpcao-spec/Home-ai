import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBookingTechnicianMarkup, createHomeAiMarkup, createMissionMarkup, createProductionConfigErrorMarkup, getEstimatedPriceRange, getProductionSupabaseConfigError, resetCustomerRequestView, serviceCategories, showRestoredCustomerMission } from '../src/app.js';
import { createCompletionSummaryMarkup } from '../src/mission/completion-summary.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';

describe('HOME AI C04 marketplace home page', () => {
  it('renders the Vietnamese service intake entry point', () => {
    const markup = createHomeAiMarkup();

    assert.match(markup, /HOME <strong>AI/);
    assert.match(markup, /Bạn cần sửa gì/);
    assert.match(markup, /Bắt đầu với AI/);
    assert.match(markup, /data-location/);
    assert.match(markup, /AI đã hiểu vấn đề của bạn/);
    assert.match(markup, /Tìm thợ phù hợp/);
    assert.match(markup, /Chỉnh sửa mô tả/);
  });

  it('renders every MVP category', () => {
    const markup = createHomeAiMarkup();

    assert.deepEqual(serviceCategories.map(({ label }) => label), ['Điện', 'Nước', 'Điều hòa', 'Điện gia dụng']);
    serviceCategories.forEach(({ label }) => assert.match(markup, new RegExp(`>${label}<`)));
  });

  it('does not render content from the previous technical landing page', () => {
    const markup = createHomeAiMarkup();

    assert.doesNotMatch(markup, /assistant domestique intelligent|bases web|Node\.js|Fondations incluses/i);
  });

  it('renders the complete Vietnamese booking and confirmation flow', () => {
    const markup = createHomeAiMarkup();

    ['Địa chỉ sửa chữa', 'Sử dụng vị trí hiện tại', 'Bạn muốn thợ đến khi nào?', 'Càng sớm càng tốt', 'Đặt lịch', 'Giá dự kiến', 'Gửi yêu cầu', 'Thợ đã nhận yêu cầu!', 'Theo dõi thợ', 'Hủy yêu cầu'].forEach((text) => assert.match(markup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.match(markup, /data-confirmation-mission/);
    assert.match(markup, /data-confirmation-state/);
  });

  it('builds a local technician summary and deterministic VND estimate', () => {
    const technician = mockTechnicians[0];
    const markup = createBookingTechnicianMarkup(technician);

    assert.deepEqual(getEstimatedPriceRange(technician.priceFrom), { from: 150000, to: 350000 });
    ['Nguyễn Văn Minh', '⭐ 4.9', '1.2 km', '150.000đ – 350.000đ', 'Đang sẵn sàng'].forEach((text) => assert.match(markup, new RegExp(text.replace('.', '\\.'))));
  });

  it('renders the complete Vietnamese mission tracking surface', () => {
    const markup = createMissionMarkup();

    ['Hành trình của thợ', 'Đã nhận yêu cầu', 'Đang di chuyển', 'Đã đến nơi', 'Đang sửa chữa', 'Hoàn thành', 'Chuyển sang bước tiếp theo'].forEach((text) => assert.match(markup, new RegExp(text)));
    assert.match(markup, /data-mission-stage/);
  });

  it('places C01/C02 before the existing application without removing C04', () => {
    const markup = createHomeAiMarkup();
    assert.match(markup, /data-startup-flow/);
    assert.match(markup, /Dịch vụ gia đình, thông minh hơn/);
    assert.match(markup, /data-app-shell hidden/);
    assert.match(markup, /Bạn cần sửa gì/);
  });

  it('renders the responsive C19 navigation and application views', () => {
    const markup = createHomeAiMarkup();
    ['Accueil', 'Lịch sử', 'Hồ sơ'].forEach((text) => assert.match(markup, new RegExp(text)));
    ['home', 'history', 'mission-detail', 'profile', 'support', 'legal'].forEach((view) => assert.match(markup, new RegExp(`data-app-view="${view}"`)));
  });

  it('keeps the C20 profile surface model-driven and initially empty for rendering', () => {
    const markup = createHomeAiMarkup();
    assert.match(markup, /class="profile-view" data-app-view="profile"/);
    assert.doesNotMatch(markup, /Phú Dũng/);
    assert.doesNotMatch(markup, /Nguyễn Minh Anh/);
  });

  it('ouvre directement le paiement après reload d’une mission completed_pending_payment', () => {
    const newRequestFlow = { hidden: false };
    const newRequestSections = [{ hidden: false }, { hidden: false }];
    let scrolled = false;
    const root = {
      querySelector(selector) {
        if (selector === '[data-new-request-flow]') return newRequestFlow;
        if (selector === '[data-mission-tracker]') return { scrollIntoView() { scrolled = true; } };
        throw new Error(`Unexpected selector ${selector}`);
      },
      querySelectorAll(selector) {
        assert.equal(selector, '[data-new-request-only]');
        return newRequestSections;
      },
    };

    assert.equal(showRestoredCustomerMission(root, 'completed_pending_payment'), 'payment');
    assert.equal(newRequestFlow.hidden, true);
    assert.equal(newRequestSections.every(({ hidden }) => hidden), true);
    assert.equal(scrolled, true);
    assert.match(createCompletionSummaryMarkup({ completedWork: [], finalAuthorizedAmount: 300000, warrantyDays: 30 }, [
      { version: 2, status: 'accepted', totalAmount: 300000 },
    ]), /Thanh toán trực tiếp cho thợ/);
  });

  it('restaure un C04 complet après recherche puis annulation', () => {
    const nodes = new Map();
    const makeNode = (extra = {}) => ({ hidden: false, textContent: 'ancien état', innerHTML: 'ancienne offre', ...extra });
    const newRequestFlow = makeNode({ hidden: true });
    const newRequestSections = [makeNode({ hidden: true }), makeNode({ hidden: true })];
    const resetForms = [];
    for (const selector of [
      '[data-diagnostic-result]', '[data-map-search]', '[data-booking-panel]', '[data-booking-confirmation]',
      '[data-mission-tracker]', '[data-provider-profile]', '[data-technician-sheet]', '[data-form-status]',
      '[data-booking-status]', '[data-confirmation-status]',
    ]) nodes.set(selector, makeNode());
    nodes.set('[data-new-request-flow]', newRequestFlow);
    nodes.set('[data-request-form]', makeNode({ reset() { resetForms.push('request'); } }));
    nodes.set('[data-booking-form]', makeNode({ reset() { resetForms.push('booking'); } }));
    const prompt = { classList: { remove(value) { assert.equal(value, 'is-selected'); } }, setAttribute(name, value) { assert.deepEqual([name, value], ['aria-pressed', 'false']); } };
    const root = {
      querySelector: selector => nodes.get(selector) ?? null,
      querySelectorAll(selector) {
        if (selector === '[data-new-request-only]') return newRequestSections;
        if (selector === '[data-prompt]') return [prompt];
        throw new Error(`Unexpected selector ${selector}`);
      },
    };

    resetCustomerRequestView(root);

    assert.equal(newRequestFlow.hidden, false);
    assert.equal(newRequestSections.every(section => !section.hidden), true);
    assert.equal(nodes.get('[data-map-search]').hidden, true);
    assert.equal(nodes.get('[data-mission-tracker]').hidden, true);
    assert.equal(nodes.get('[data-technician-sheet]').innerHTML, '');
    assert.deepEqual(resetForms, ['request', 'booking']);
    for (const selector of ['[data-form-status]', '[data-booking-status]', '[data-confirmation-status]']) {
      assert.equal(nodes.get(selector).textContent, '');
    }
  });

  it('bloque explicitement le fallback mock si Supabase manque sur GitHub Pages', () => {
    assert.equal(getProductionSupabaseConfigError({}, 'ngpcao-spec.github.io'), 'Cấu hình Supabase bắt buộc đang bị thiếu.');
    assert.equal(getProductionSupabaseConfigError({}, 'localhost'), null);
    assert.equal(getProductionSupabaseConfigError({
      SUPABASE_REQUIRED: true,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key',
    }, 'ngpcao-spec.github.io'), null);
    assert.match(createProductionConfigErrorMarkup('Cấu hình Supabase bắt buộc đang bị thiếu.'), /Không thể khởi động HOME AI/);
  });
});
