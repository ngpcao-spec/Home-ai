const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const formatMoney = value => `${new Intl.NumberFormat('vi-VN').format(Number(value))}đ`;
const activityLabels = {
  electricity: 'Thợ điện', plumbing: 'Thợ sửa ống nước',
  'air-conditioning': 'Điều hòa', appliances: 'Điện gia dụng',
};
const activityDescriptions = {
  electricity: 'Sửa chữa và lắp đặt điện dân dụng.',
  plumbing: 'Sửa chữa và lắp đặt hệ thống nước.',
  'air-conditioning': 'Bảo trì và sửa chữa điều hòa.',
  appliances: 'Kiểm tra và sửa chữa thiết bị gia dụng.',
};
const activityIcons = { electricity: '⚡', plumbing: '◆', 'air-conditioning': '❄', appliances: '⌁' };

const progress = active => `<div class="activity-progress" aria-label="Bước ${active} trên 3">
  ${[1, 2, 3].map(step => `<span class="${step <= active ? 'is-active' : ''}"></span>${step < 3 ? '<i></i>' : ''}`).join('')}
</div>`;
const back = target => `<button type="button" class="activity-back" data-activity-back="${target}" aria-label="Quay lại">‹</button>`;

export function renderProviderActivities(services = [], flow = {}) {
  const step = flow.step ?? 'list';
  if (step === 'choose') {
    const input = escapeHtml(flow.input ?? '');
    const entry = flow.mode ? `<form class="activity-entry" data-activity-entry>
      <label>${flow.mode === 'profession' ? 'Nghề của bạn' : 'Công việc bạn thực hiện'}
        <textarea rows="3" maxlength="1000" data-activity-input placeholder="${flow.mode === 'profession' ? 'Ví dụ: Thợ điện, thợ sửa ống nước…' : 'Ví dụ: Tôi sửa ổ cắm và công tắc trong nhà…'}">${input}</textarea>
      </label>
      <button type="submit" data-analyze-activity ${flow.busy ? 'disabled' : ''}>Tiếp tục</button>
    </form>` : '';
    return `<main class="provider-activities activity-flow">${back('list')}<div class="activity-page-title">Thêm hoạt động</div>${progress(1)}
      <h1>Bạn muốn thêm hoạt động như thế nào?</h1><p>Chọn cách đơn giản nhất cho bạn.</p>
      <button type="button" class="activity-choice ${flow.mode === 'profession' ? 'is-selected' : ''}" data-activity-mode="profession">
        <span>●</span><div><strong>Cho biết nghề nghiệp của tôi</strong><small>Ví dụ: Thợ điện, thợ sửa ống nước, tài xế, nhân viên massage…</small><em>AI tự động hiểu phạm vi thông thường của nghề.</em></div><b>›</b>
      </button>
      <button type="button" class="activity-choice ${flow.mode === 'description' ? 'is-selected' : ''}" data-activity-mode="description">
        <span>▤</span><div><strong>Mô tả công việc tôi làm</strong><small>Ví dụ: Tôi sửa ổ cắm và công tắc trong nhà.</small><em>Phù hợp khi hoạt động của bạn cụ thể hoặc không thuộc một nghề phổ biến.</em></div><b>›</b>
      </button>${entry}<p class="activity-message" role="status">${escapeHtml(flow.error ?? '')}</p>
    </main>`;
  }
  if (step === 'proposal') {
    const proposal = flow.proposal;
    const reference = flow.reference;
    const referenceMarkup = reference?.medianHourlyRate != null
      ? `<strong>Tarif médian HOME AI : ${formatMoney(reference.medianHourlyRate)}/giờ</strong><small>Basé sur ${reference.providerCount} providers</small>`
      : '<strong>Chưa có dữ liệu so sánh</strong><small>Bạn hoàn toàn tự do nhập mức giá của mình.</small>';
    return `<main class="provider-activities activity-flow">${back('choose')}<div class="activity-page-title">Đề xuất của HOME AI</div>${progress(2)}
      <div class="analysis-complete">✦ Phân tích hoàn tất</div><h1>Đây là những gì tôi hiểu</h1><p>Kiểm tra và sửa nếu cần.</p>
      <section class="activity-proposal-card"><span>${activityIcons[proposal.serviceCategory] ?? '◆'}</span><button type="button" data-edit-activity>Chỉnh sửa</button>
        <h2>${escapeHtml(proposal.activityName)}</h2><p>${escapeHtml(proposal.description)}</p></section>
      <section class="pricing-model-advice"><span>⌛</span><div><small>Mô hình giá đề xuất</small><strong>${proposal.pricingModel === 'hourly' ? 'Theo giờ' : escapeHtml(proposal.pricingModel)}</strong><p>HOME AI chỉ hỗ trợ cấu hình theo giờ trong phiên bản này.</p></div></section>
      <section class="rate-reference"><span>▥</span><div>${referenceMarkup}</div></section>
      <button type="button" class="activity-primary" data-activity-continue ${proposal.pricingModel !== 'hourly' ? 'disabled' : ''}>Tiếp tục</button>
      <p class="activity-message" role="status">${escapeHtml(flow.error ?? '')}</p>
    </main>`;
  }
  if (step === 'rate') {
    const proposal = flow.proposal;
    const suggested = flow.reference?.medianHourlyRate;
    const hourlyRate = flow.hourlyRate ?? suggested ?? '';
    const minimumCharge = flow.minimumCharge ?? 0;
    return `<main class="provider-activities activity-flow">${back('proposal')}<div class="activity-page-title">Đặt mức giá của tôi</div>${progress(3)}
      <h1>Bạn muốn đề xuất mức giá nào?</h1><p>Bạn hoàn toàn tự do lựa chọn. Mức HOME AI chỉ mang tính tham khảo.</p>
      ${suggested == null ? '' : `<section class="rate-suggestion"><small>Tarif conseillé par HOME AI</small><strong>${formatMoney(suggested)}/giờ</strong></section>`}
      <form class="activity-rate-form" data-activity-rate-form>
        <label>Đơn giá theo giờ <b>*</b><span><input type="number" inputmode="numeric" min="1" max="1000000000" step="1000" value="${hourlyRate}" data-activity-hourly-rate required><em>đ/giờ</em></span></label>
        <label>Mức phí tối thiểu <b>*</b><span><input type="number" inputmode="numeric" min="0" max="1000000000000" step="1000" value="${minimumCharge}" data-activity-minimum-charge required><em>đ</em></span></label>
        <aside><strong>💡 Gợi ý</strong><p>Mức phí tối thiểu giúp bù chi phí di chuyển và các công việc nhỏ.</p></aside>
        <button type="submit" data-create-activity ${flow.busy ? 'disabled' : ''}>Thêm hoạt động của tôi</button>
      </form><p class="activity-message" role="status">${escapeHtml(flow.error ?? '')}</p>
    </main>`;
  }

  return `<main class="provider-activities"><p class="activities-kicker">DỊCH VỤ PROVIDER</p><h1>Hoạt động của tôi</h1><p>Đây là các hoạt động bạn cung cấp trên HOME AI.</p>
    <div class="activity-list">${services.map(service => `<article class="activity-card" data-provider-activity="${escapeHtml(service.serviceCategory)}">
      <span>${activityIcons[service.serviceCategory] ?? '◆'}</span><div><h2>${escapeHtml(service.activityName ?? activityLabels[service.serviceCategory] ?? service.serviceCategory)}</h2>
      <p>${escapeHtml(service.activityDescription ?? activityDescriptions[service.serviceCategory] ?? 'Dịch vụ được cung cấp trên HOME AI.')}</p>
      <strong>${service.pricingModel === 'hourly' && service.hourlyRate != null ? `${formatMoney(service.hourlyRate)}/giờ` : 'Theo báo giá'}</strong></div>
      <em>${service.enabled ? '✓ Đã đăng' : 'Bản nháp'}</em></article>`).join('') || '<div class="empty">Bạn chưa có hoạt động nào.</div>'}</div>
    <button type="button" class="activity-primary" data-add-activity>＋ Thêm hoạt động</button>
    <p class="activity-message" role="status">${escapeHtml(flow.message ?? flow.error ?? '')}</p>
  </main>`;
}

export function readProviderActivityInput(root, mode) {
  const text = root.querySelector('[data-activity-input]')?.value?.trim() ?? '';
  return Object.freeze({ valid: ['profession', 'description'].includes(mode) && text.length >= 2 && text.length <= 1000,
    inputMode: mode, text });
}

export function readProviderActivityPricing(root) {
  const hourlyRateValue = root.querySelector('[data-activity-hourly-rate]')?.value ?? '';
  const minimumChargeValue = root.querySelector('[data-activity-minimum-charge]')?.value ?? '';
  const hourlyRate = Number(hourlyRateValue);
  const minimumCharge = Number(minimumChargeValue);
  return Object.freeze({
    valid: hourlyRateValue !== '' && minimumChargeValue !== ''
      && Number.isInteger(hourlyRate) && hourlyRate > 0 && hourlyRate <= 1_000_000_000
      && Number.isInteger(minimumCharge) && minimumCharge >= 0 && minimumCharge <= 1_000_000_000_000,
    hourlyRate, minimumCharge,
  });
}
