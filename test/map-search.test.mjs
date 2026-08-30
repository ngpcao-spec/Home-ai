import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { createHomeAiMarkup } from '../src/app.js';
import { createMapMarkup } from '../src/map/map-provider.js';
import { createSearchPlan, getNextTechnician, prototypeSearchTiming, realtimeSearchTiming } from '../src/search/map-search.js';
import { createNoTechnicianMarkup, createTechnicianSheetMarkup } from '../src/search/technician-sheet.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';

describe('C08/C09 — tìm thợ trên bản đồ', () => {
  it('chuẩn bị màn hình bản đồ sau bước chẩn đoán', () => {
    const markup = createHomeAiMarkup();
    assert.match(markup, /data-map-search/);
    assert.match(markup, /Đang tìm thợ gần bạn/);
    assert.doesNotMatch(markup, /data-technician-list/);
  });

  it('hiển thị vị trí khách và chỉ marker của danh mục tương thích', () => {
    const plan = createSearchPlan(mockTechnicians, 'air-conditioning');
    assert.ok(plan.compatible.every(({ category }) => category === 'air-conditioning'));
    const markup = createMapMarkup({ technicians: plan.compatible, selectedId: plan.selected.id });
    assert.match(markup, /Vị trí của bạn/);
    assert.match(markup, /data-map-technician="lanh-khoa"/);
    assert.doesNotMatch(markup, /dien-minh/);
  });

  it('mở rộng 2 → 5 km chỉ khi bán kính trước chưa có kết quả', () => {
    const distant = [{ ...mockTechnicians[6], id: 'distant', distanceKm: 4.2 }];
    const plan = createSearchPlan(distant, 'air-conditioning');
    assert.deepEqual(plan.phases.map(({ radiusKm }) => radiusKm), [2, 5]);
    assert.equal(plan.phases[0].technicians.length, 0);
    assert.equal(plan.phases[1].technicians.length, 1);
  });

  it('sélectionne le meilleur technicien dans le premier rayon qui aboutit', () => {
    const near = { ...mockTechnicians[6], id: 'near', distanceKm: 1.8, estimatedArrivalMinutes: 12 };
    const fasterButFar = { ...mockTechnicians[7], id: 'far-fast', distanceKm: 4.2, estimatedArrivalMinutes: 5 };
    const plan = createSearchPlan([near, fasterButFar], 'air-conditioning');
    assert.equal(plan.selected.id, 'near');
    assert.deepEqual(plan.phases.map(({ radiusKm }) => radiusKm), [2]);
  });

  it('cadence la simulation C08 sur environ cinq secondes et permet de supprimer le délai', () => {
    assert.deepEqual(Object.values(prototypeSearchTiming), [1500, 2800, 3500, 4100, 4800]);
    assert.ok(prototypeSearchTiming.completeMs >= 4500 && prototypeSearchTiming.completeMs <= 5000);
    assert.deepEqual(Object.values(realtimeSearchTiming), [0, 0, 0, 0, 0]);
  });

  it('chọn người đứng đầu ranking và chuyển tuần tự sang thợ kế tiếp', () => {
    const plan = createSearchPlan(mockTechnicians, 'air-conditioning');
    assert.equal(plan.selected.id, 'lanh-khoa');
    assert.equal(getNextTechnician(plan.compatible, plan.selected.id).id, 'lanh-nam');
    assert.equal(getNextTechnician(plan.compatible, plan.compatible.at(-1).id).id, 'lanh-khoa');
  });

  it('cung cấp fiche kết quả, hành động đặt thợ và trạng thái không có thợ', () => {
    const sheet = createTechnicianSheetMarkup(mockTechnicians[6]);
    ['Đã tìm thấy thợ phù hợp', '203 đánh giá', 'Kỹ năng', 'km đường bộ', 'ETA khoảng', 'Vì sao HOME AI đề xuất thợ này?', 'Chọn thợ này', 'Tìm thợ khác'].forEach((text) => assert.match(sheet, new RegExp(text)));
    const empty = createNoTechnicianMarkup();
    ['Hiện chưa có thợ phù hợp gần bạn', 'Thử lại', 'Đặt lịch sau'].forEach((text) => assert.match(empty, new RegExp(text)));
  });

  it('gère le cas où aucun prestataire disponible ne se trouve à 10 km', () => {
    const unavailable = mockTechnicians.map((technician) => ({ ...technician, available: false, availability: 'Không khả dụng' }));
    const plan = createSearchPlan(unavailable, 'air-conditioning');
    assert.equal(plan.selected, null);
    assert.deepEqual(plan.phases.map(({ radiusKm }) => radiusKm), [2, 5, 10]);
  });

  it('n’expose aucune clé de fournisseur cartographique', async () => {
    const files = await Promise.all(['../src/app.js', '../src/map/map-provider.js', '../index.html'].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
    assert.doesNotMatch(files.join('\n'), /(googleMapsApiKey|mapboxToken|pk\.[a-zA-Z0-9]{20,}|AIza[\w-]{20,})/);
  });
});
