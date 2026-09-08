const esc = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const serviceLabels = { electricity: 'Điện', plumbing: 'Nước', 'air-conditioning': 'Điều hòa', appliances: 'Điện gia dụng' };
const money = (value, currency = 'VND') => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}${currency === 'VND' ? 'đ' : ` ${currency}`}`;
const date = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(value)) : '—';

export function prepareProviderHistory(rows = [], providerId) {
  return rows.filter((mission) => mission?.providerId === providerId && mission.status === 'completed').map((mission) => Object.freeze({
    ...mission, finalAmount: Number(mission.finalAuthorizedAmount) || 0,
    completedAt: mission.completedAt ?? mission.requestedAt,
  })).sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
}

export function calculateProviderIncome(history = []) {
  const paid = history.filter((mission) => mission.status === 'completed' && mission.paymentStatus === 'paid_external');
  return Object.freeze({ missionCount: paid.length, total: paid.reduce((sum, mission) => sum + mission.finalAmount, 0), currency: paid[0]?.currency ?? 'VND' });
}

function stars(rating) {
  return rating ? `<span class="history-rating" aria-label="${rating} trên 5 sao">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>` : '<span class="history-rating history-rating--empty">Chưa có đánh giá</span>';
}

export function renderProviderMissionHistory(history = [], { loading = false, error = '', selectedMissionId = null } = {}) {
  if (loading) return '<main class="provider-history"><p class="history-kicker">NHIỆM VỤ</p><h1>Lịch sử công việc</h1><div class="empty">Đang tải dữ liệu Supabase…</div></main>';
  if (error) return `<main class="provider-history"><p class="history-kicker">NHIỆM VỤ</p><h1>Lịch sử công việc</h1><div class="history-error" role="alert">Không thể tải lịch sử Supabase.<small>${esc(error)}</small><button data-history-retry>Thử lại</button></div></main>`;
  const selected = history.find((mission) => mission.id === selectedMissionId);
  if (selected) return `<main class="provider-history"><button class="history-back" data-history-back>‹ Lịch sử</button><article class="history-detail"><p class="history-kicker">NHIỆM VỤ HOÀN THÀNH</p><h1>${esc(serviceLabels[selected.serviceCategory] ?? selected.serviceCategory)}</h1><dl><div><dt>Ngày</dt><dd>${date(selected.completedAt)}</dd></div><div><dt>Khách hàng</dt><dd>${esc(selected.clientName ?? 'Khách hàng HOME AI')}</dd></div><div><dt>Vấn đề</dt><dd>${esc(selected.problemDescription)}</dd></div><div><dt>Tổng tiền cuối cùng</dt><dd>${money(selected.finalAmount, selected.currency)}</dd></div><div><dt>Thanh toán</dt><dd>Trực tiếp cho thợ</dd></div></dl><section><h2>Đánh giá khách hàng</h2>${stars(selected.review?.rating)}${selected.review?.comment ? `<p>${esc(selected.review.comment)}</p>` : ''}</section></article></main>`;
  return `<main class="provider-history"><p class="history-kicker">NHIỆM VỤ</p><h1>Lịch sử công việc</h1>${history.length ? `<section class="history-list">${history.map((mission) => `<button class="history-card" data-history-mission="${esc(mission.id)}"><span class="history-icon">✓</span><span><strong>${esc(serviceLabels[mission.serviceCategory] ?? mission.serviceCategory)}</strong><small>${date(mission.completedAt)} · ${esc(mission.clientName ?? 'Khách hàng HOME AI')}</small>${stars(mission.review?.rating)}</span><b>${money(mission.finalAmount, mission.currency)}</b></button>`).join('')}</section>` : '<div class="empty">Chưa có nhiệm vụ hoàn thành.</div>'}</main>`;
}

export function renderProviderIncome(history = [], { loading = false, error = '' } = {}) {
  if (loading) return '<main class="provider-history"><p class="history-kicker">THU NHẬP</p><h1>Thu nhập của bạn</h1><div class="empty">Đang tải dữ liệu Supabase…</div></main>';
  if (error) return `<main class="provider-history"><p class="history-kicker">THU NHẬP</p><h1>Thu nhập của bạn</h1><div class="history-error" role="alert">Không thể tải thu nhập Supabase.<small>${esc(error)}</small><button data-history-retry>Thử lại</button></div></main>`;
  const income = calculateProviderIncome(history);
  return `<main class="provider-history"><p class="history-kicker">THU NHẬP</p><h1>Thu nhập của bạn</h1><section class="income-total"><span>Tổng thu nhập đã xác nhận</span><strong>${money(income.total, income.currency)}</strong><small>${income.missionCount} nhiệm vụ · thanh toán trực tiếp</small></section><p class="income-note">HOME AI chỉ tổng hợp các nhiệm vụ đã hoàn thành và được khách hàng xác nhận thanh toán. Ứng dụng không xử lý thanh toán.</p>${history.length ? `<section class="history-list">${history.filter((mission) => mission.paymentStatus === 'paid_external').map((mission) => `<article class="income-row"><span><strong>${esc(serviceLabels[mission.serviceCategory] ?? mission.serviceCategory)}</strong><small>${date(mission.completedAt)}</small></span><b>+${money(mission.finalAmount, mission.currency)}</b></article>`).join('')}</section>` : ''}</main>`;
}
