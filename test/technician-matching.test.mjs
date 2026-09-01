import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSelectionMessage, createTechnicianCardsMarkup } from '../src/app.js';
import { findBestTechnicians, rankTechnicians } from '../src/technicians/matching.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';
import { createProgressiveTechnicianRepository } from '../src/technicians/repository.js';

describe('ghép thợ cục bộ', () => {
  it('lọc theo danh mục và loại trừ danh mục không tương thích', () => {
    const result = rankTechnicians(mockTechnicians, 'plumbing');
    assert.equal(result.length, 2);
    assert.ok(result.every(({ category }) => category === 'plumbing'));
  });

  it('chỉ trả về tối đa top 3 sau bộ lọc bắt buộc', () => {
    assert.equal(findBestTechnicians(mockTechnicians, 'electricity').length, 2);
  });

  it('có thứ tự hoàn toàn xác định', () => {
    const first = rankTechnicians(mockTechnicians, 'electricity').map(({ id }) => id);
    const second = rankTechnicians([...mockTechnicians].reverse(), 'electricity').map(({ id }) => id);
    assert.deepEqual(first, second);
  });

  it('loại thợ chưa xác minh rồi ưu tiên ETA/khoảng cách và đánh giá', () => {
    const base = { category: 'electricity', online: true, available: true, reviewCount: 1, estimatedArrivalMinutes: 1, completedJobs: 1, priceFrom: 1, location: '', shortDescription: '', initials: 'T' };
    const data = [
      { ...base, id: 'unverified', verified: false, availability: 'Đang sẵn sàng', distanceKm: 0.1, rating: 5 },
      { ...base, id: 'later', verified: true, availability: 'Có thể nhận việc hôm nay', distanceKm: 0.2, rating: 5 },
      { ...base, id: 'far', verified: true, availability: 'Đang sẵn sàng', distanceKm: 3, rating: 5 },
      { ...base, id: 'near-low-rating', verified: true, availability: 'Đang sẵn sàng', distanceKm: 1, rating: 4.7 },
      { ...base, id: 'near-high-rating', verified: true, availability: 'Đang sẵn sàng', distanceKm: 1, rating: 4.9 },
    ];
    assert.deepEqual(rankTechnicians(data, 'electricity').map(({ id }) => id), ['later', 'near-high-rating', 'near-low-rating', 'far']);
  });

  it('rend les informations et les actions du prestataire en vietnamien', () => {
    const markup = createTechnicianCardsMarkup([mockTechnicians[0]]);
    ['Nguyễn Văn Minh', 'Đã xác minh', '186 đánh giá', '1.2 km', 'Khoảng 18 phút', '150.000đ', '342 việc đã hoàn thành', 'Đang sẵn sàng', 'Vì sao HOME AI đề xuất thợ này?', 'Xem hồ sơ', 'Chọn thợ'].forEach((text) => assert.match(markup, new RegExp(text.replace('.', '\\.'))));
  });

  it('expose l’action de sélection liée à l’identifiant du prestataire', () => {
    const markup = createTechnicianCardsMarkup([mockTechnicians[0]]);
    assert.match(markup, /data-choose-technician="dien-minh"/);
    assert.equal(createSelectionMessage(mockTechnicians[0].name), 'Bạn đã chọn Nguyễn Văn Minh');
  });

  it('conserve le fallback mock si Supabase est absent', async () => {
    const fallbackCalls = [];
    const fallback = { async list(args) { fallbackCalls.push(args); return mockTechnicians; } };
    const repository = createProgressiveTechnicianRepository({}, fallback);
    const result = await repository.list({
      serviceCategory: 'electricity', location: { latitude: 12.24, longitude: 109.19 },
    });
    assert.equal(result, mockTechnicians);
    assert.equal(fallbackCalls.length, 1);
  });
});
