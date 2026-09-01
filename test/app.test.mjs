import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBookingTechnicianMarkup, createHomeAiMarkup, createMissionMarkup, getEstimatedPriceRange, serviceCategories } from '../src/app.js';
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
});
