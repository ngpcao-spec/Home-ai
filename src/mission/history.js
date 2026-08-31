import { createProviderAvatarMarkup } from './completion-summary.js';

const formatAmount = (amount, currency = 'VND') => (
  currency === 'VND' ? `${new Intl.NumberFormat('vi-VN').format(amount)}đ` : `${amount} ${currency}`
);

const formatDate = (value, includeTime = false) => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(new Date(value));

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const freezeMission = (mission) => Object.freeze({
  ...mission,
  technician: Object.freeze({ ...mission.technician }),
  completedWork: Object.freeze([...(mission.completedWork ?? [])]),
  quoteHistory: Object.freeze((mission.quoteHistory ?? []).map((quote) => Object.freeze({ ...quote }))),
  review: mission.review ? Object.freeze({ ...mission.review }) : null,
});

export function createCompletedMissionRecord(missionState, context) {
  if (!missionState?.completion) return null;
  const { completion } = missionState;
  return freezeMission({
    missionId: completion.missionId,
    problem: context.problem,
    service: context.service,
    bookedAt: context.bookedAt ?? completion.completedAt,
    completedAt: completion.completedAt,
    address: context.address,
    technician: context.technician,
    status: missionState.missionStatus,
    statusLabel: 'Hoàn thành',
    quoteHistory: missionState.quoteHistory,
    finalAuthorizedAmount: completion.finalAuthorizedAmount,
    currency: completion.currency,
    paymentStatus: missionState.paymentStatus,
    paidAt: missionState.paidAt,
    warrantyDays: completion.warrantyDays,
    completedWork: completion.completedWork,
    acceptedQuoteId: completion.acceptedQuoteId,
    review: missionState.reviewSent
      ? { rating: missionState.rating, comment: missionState.reviewComment }
      : null,
  });
}

export const mockMissionHistory = Object.freeze([
  freezeMission({
    missionId: 'HOMEAI-HISTORY-003',
    problem: 'Vòi nước bếp bị rò rỉ',
    service: 'Sửa chữa đường nước',
    bookedAt: '2026-07-18T02:15:00.000Z',
    completedAt: '2026-07-18T03:40:00.000Z',
    address: '24 Nguyễn Thiện Thuật, Nha Trang, Khánh Hòa',
    technician: { name: 'Phạm Thị Lan', rating: 4.9, reviewCount: 164, shortDescription: 'Chuyên xử lý rò rỉ và đường ống nước.' },
    status: 'completed',
    statusLabel: 'Hoàn thành',
    quoteHistory: [{ id: 'H003-v1', version: 1, status: 'accepted', totalAmount: 240000 }],
    finalAuthorizedAmount: 240000,
    currency: 'VND',
    paymentStatus: 'paid_external',
    paidAt: '2026-07-18T03:45:00.000Z',
    warrantyDays: 30,
    completedWork: ['Thay gioăng vòi nước', 'Kiểm tra đường ống', 'Vệ sinh khu vực sửa chữa'],
    acceptedQuoteId: 'H003-v1',
    review: { rating: 5, comment: 'Thợ làm việc nhanh và sạch sẽ.' },
  }),
  freezeMission({
    missionId: 'HOMEAI-HISTORY-002',
    problem: 'Ổ cắm phòng khách mất điện',
    service: 'Điện dân dụng',
    bookedAt: '2026-05-03T07:30:00.000Z',
    completedAt: '2026-05-03T09:05:00.000Z',
    address: '8 Lê Thánh Tôn, Nha Trang, Khánh Hòa',
    technician: { name: 'Nguyễn Văn Minh', rating: 4.9, reviewCount: 186, shortDescription: 'Chuyên sửa điện dân dụng.' },
    status: 'completed',
    statusLabel: 'Hoàn thành',
    quoteHistory: [{ id: 'H002-v1', version: 1, status: 'accepted', totalAmount: 180000 }],
    finalAuthorizedAmount: 180000,
    currency: 'VND',
    paymentStatus: 'paid_external',
    paidAt: '2026-05-03T09:10:00.000Z',
    warrantyDays: 30,
    completedWork: ['Thay ổ cắm bị hỏng', 'Kiểm tra mạch điện', 'Kiểm tra an toàn'],
    acceptedQuoteId: 'H002-v1',
    review: { rating: 4, comment: '' },
  }),
  freezeMission({
    missionId: 'HOMEAI-HISTORY-001',
    problem: 'Máy giặt không xả nước',
    service: 'Điện gia dụng',
    bookedAt: '2026-02-12T01:00:00.000Z',
    completedAt: '2026-02-12T03:20:00.000Z',
    address: '61 Yersin, Nha Trang, Khánh Hòa',
    technician: { name: 'Ngô Thu Thảo', rating: 4.9, reviewCount: 147, shortDescription: 'Sửa chữa thiết bị điện gia đình.' },
    status: 'completed',
    statusLabel: 'Hoàn thành',
    quoteHistory: [{ id: 'H001-v1', version: 1, status: 'accepted', totalAmount: 320000 }],
    finalAuthorizedAmount: 320000,
    currency: 'VND',
    paymentStatus: 'paid_external',
    paidAt: '2026-02-12T03:25:00.000Z',
    warrantyDays: 45,
    completedWork: ['Vệ sinh bộ lọc', 'Thay bơm xả nước', 'Chạy kiểm tra máy'],
    acceptedQuoteId: 'H001-v1',
    review: null,
  }),
]);

export function getClientMissionHistory(currentMission, archivedMissions = mockMissionHistory) {
  return [currentMission, ...archivedMissions]
    .filter(Boolean)
    .toSorted((left, right) => new Date(right.completedAt) - new Date(left.completedAt));
}

export function createMissionHistoryMarkup(missions) {
  const cards = missions.map((mission) => `<button class="history-card" type="button" data-open-mission="${escapeHtml(mission.missionId)}">
    <span class="history-card-heading"><span><small>${escapeHtml(mission.service)}</small><strong>${escapeHtml(mission.problem)}</strong></span><em>${escapeHtml(mission.statusLabel)}</em></span>
    <span class="history-card-meta"><span>${formatDate(mission.completedAt)}</span><span>${escapeHtml(mission.technician.name)}</span></span>
    <span class="history-card-footer"><strong>${formatAmount(mission.finalAuthorizedAmount, mission.currency)}</strong>${mission.review ? `<span aria-label="Đã đánh giá ${mission.review.rating} sao">★ ${mission.review.rating}/5</span>` : '<span>Chưa đánh giá</span>'}</span>
  </button>`).join('');
  return `<div class="history-heading"><p>LỊCH SỬ DỊCH VỤ</p><h1>Lịch sử</h1><span>${missions.length} chuyến đã hoàn thành</span></div><div class="history-list">${cards}</div>`;
}

export function createMissionDetailMarkup(mission) {
  if (!mission) return '<p>Không tìm thấy chuyến.</p>';
  const quotes = mission.quoteHistory.map((quote) => `<li><strong>v${quote.version}</strong><span>${formatAmount(quote.totalAmount, mission.currency)}</span><em>${escapeHtml(quote.status)}</em></li>`).join('');
  const review = mission.review
    ? `<div><dt>Đánh giá của bạn</dt><dd><strong>★ ${mission.review.rating}/5</strong>${mission.review.comment ? `<span>${escapeHtml(mission.review.comment)}</span>` : ''}</dd></div>`
    : '<div><dt>Đánh giá của bạn</dt><dd>Chưa đánh giá</dd></div>';
  return `<button class="detail-back" type="button" data-back-history>‹ Quay lại lịch sử</button>
    <article class="mission-detail-card" aria-labelledby="mission-detail-title">
      <p class="quote-eyebrow">Chi tiết chuyến</p><h1 id="mission-detail-title">${escapeHtml(mission.problem)}</h1><span class="detail-status">${escapeHtml(mission.statusLabel)}</span>
      <dl class="detail-facts"><div><dt>Ngày và giờ</dt><dd>${formatDate(mission.completedAt, true)}</dd></div><div><dt>Địa chỉ</dt><dd>${escapeHtml(mission.address)}</dd></div><div><dt>Dịch vụ</dt><dd>${escapeHtml(mission.service)}</dd></div><div><dt>Mission ID</dt><dd>${escapeHtml(mission.missionId)}</dd></div></dl>
      <section class="detail-provider">${createProviderAvatarMarkup()}<div><strong>${escapeHtml(mission.technician.name)}</strong><span>★ ${mission.technician.rating}${mission.technician.reviewCount ? ` · ${mission.technician.reviewCount} đánh giá` : ''}</span><small>${escapeHtml(mission.technician.shortDescription)}</small></div></section>
      <section class="detail-block"><h2>Công việc đã thực hiện</h2><ul>${mission.completedWork.map((work) => `<li>${escapeHtml(work)}</li>`).join('')}</ul></section>
      <section class="detail-block quote-history"><h2>Lịch sử báo giá</h2><ol>${quotes}</ol></section>
      <dl class="detail-summary"><div><dt>Tổng thanh toán</dt><dd>${formatAmount(mission.finalAuthorizedAmount, mission.currency)}</dd></div><div><dt>Trạng thái thanh toán</dt><dd>${escapeHtml(mission.paymentStatus)}</dd></div><div><dt>Bảo hành</dt><dd>${mission.warrantyDays} ngày</dd></div>${review}</dl>
    </article>`;
}
