import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createCompletedMissionRecord,
  createMissionDetailMarkup,
  createMissionHistoryMarkup,
  getClientMissionHistory,
  mockMissionHistory,
} from '../src/mission/history.js';

const currentState = {
  missionStatus: 'completed',
  paymentStatus: 'paid_external',
  paidAt: '2026-08-31T05:30:00.000Z',
  rating: 5,
  reviewComment: 'Dịch vụ rất tốt.',
  reviewSent: true,
  quoteHistory: [
    { id: 'quote-v1', version: 1, status: 'accepted', totalAmount: 290000 },
    { id: 'quote-v2', version: 2, status: 'accepted', totalAmount: 390000 },
  ],
  completion: {
    missionId: 'HOMEAI-lanh-khoa',
    completedAt: '2026-08-31T05:20:00.000Z',
    completedWork: ['Thay tụ điện máy nén', 'Thay dây điện nguồn'],
    acceptedQuoteId: 'quote-v2',
    finalAuthorizedAmount: 390000,
    currency: 'VND',
    warrantyDays: 30,
  },
};

const context = {
  problem: 'Điều hòa không lạnh',
  service: 'Điều hòa',
  bookedAt: '2026-08-31T04:00:00.000Z',
  address: 'Nha Trang, Khánh Hòa',
  technician: {
    name: 'Đặng Minh Khoa',
    rating: 5,
    reviewCount: 203,
    shortDescription: 'Bảo dưỡng và sửa điều hòa dân dụng mọi thương hiệu.',
  },
};

describe('C19 historique des interventions', () => {
  it('construit la mission actuelle depuis le modèle existant sans recalculer le montant', () => {
    const mission = createCompletedMissionRecord(currentState, context);
    assert.equal(mission.finalAuthorizedAmount, currentState.completion.finalAuthorizedAmount);
    assert.equal(mission.paymentStatus, 'paid_external');
    assert.equal(mission.acceptedQuoteId, 'quote-v2');
    assert.equal(mission.review.rating, 5);
    assert.equal(mission.review.comment, 'Dịch vụ rất tốt.');
    assert.equal(Object.isFrozen(mission), true);
    assert.equal(Object.isFrozen(mission.quoteHistory), true);
  });

  it('classe la mission actuelle et les anciennes missions de la plus récente à la plus ancienne', () => {
    const current = createCompletedMissionRecord(currentState, context);
    const history = getClientMissionHistory(current);
    assert.equal(history.length, 4);
    assert.equal(history[0].missionId, 'HOMEAI-lanh-khoa');
    const dates = history.map(({ completedAt }) => completedAt);
    assert.deepEqual(dates, dates.toSorted().reverse());
    assert.equal(mockMissionHistory.length, 3);
  });

  it('rend les cartes C19 avec service, date, technicien, statut, montant et note', () => {
    const current = createCompletedMissionRecord(currentState, context);
    const markup = createMissionHistoryMarkup(getClientMissionHistory(current));
    ['Lịch sử', 'Điều hòa không lạnh', 'Đặng Minh Khoa', 'Hoàn thành', '390.000đ', '★ 5/5', 'Vòi nước bếp bị rò rỉ'].forEach((text) => assert.match(markup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.equal((markup.match(/data-open-mission=/g) ?? []).length, 4);
  });

  it('rend le détail complet depuis la mission sélectionnée', () => {
    const mission = createCompletedMissionRecord(currentState, context);
    const markup = createMissionDetailMarkup(mission);
    [
      'Chi tiết chuyến',
      'Điều hòa không lạnh',
      'Nha Trang, Khánh Hòa',
      'Đặng Minh Khoa',
      'Thay tụ điện máy nén',
      'Lịch sử báo giá',
      'v1',
      'v2',
      '390.000đ',
      'paid_external',
      '30 ngày',
      'Dịch vụ rất tốt.',
      'HOMEAI-lanh-khoa',
    ].forEach((text) => assert.match(markup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  });

  it('conserve 290.000đ lorsque le dernier supplément a été refusé', () => {
    const rejectedState = {
      ...currentState,
      quoteHistory: [currentState.quoteHistory[0], { ...currentState.quoteHistory[1], status: 'rejected' }],
      completion: { ...currentState.completion, acceptedQuoteId: 'quote-v1', finalAuthorizedAmount: 290000 },
    };
    const mission = createCompletedMissionRecord(rejectedState, context);
    assert.equal(mission.finalAuthorizedAmount, 290000);
    assert.match(createMissionHistoryMarkup([mission]), /290\.000đ/);
    assert.match(createMissionDetailMarkup(mission), /290\.000đ/);
  });
});
