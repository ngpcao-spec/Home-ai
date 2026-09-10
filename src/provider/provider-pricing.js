const esc = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const labels = { electricity: 'Điện', plumbing: 'Nước', 'air-conditioning': 'Điều hòa', appliances: 'Điện gia dụng' };
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;

export function renderProviderPricing(services = [], { loading = false, error = '', message = '', busy = false } = {}) {
  if (loading) return '<main class="provider-pricing"><p class="pricing-kicker">HỒ SƠ</p><h1>Giá dịch vụ</h1><div class="empty">Đang tải cấu hình…</div></main>';
  if (error) return `<main class="provider-pricing"><p class="pricing-kicker">HỒ SƠ</p><h1>Giá dịch vụ</h1><div class="history-error" role="alert">Không thể tải cấu hình.<small>${esc(error)}</small><button data-pricing-retry>Thử lại</button></div></main>`;
  return `<main class="provider-pricing"><p class="pricing-kicker">HỒ SƠ</p>
    <h1>Giá dịch vụ</h1><p>Mỗi dịch vụ có mô hình giá riêng. Phiên bản này hỗ trợ tính theo giờ.</p>
    ${services.length ? services.map((service) => `<form class="pricing-card" data-pricing-service="${esc(service.serviceCategory)}">
      <div><span>${service.serviceCategory === 'electricity' ? '⚡' : '🛠'}</span><h2>${esc(labels[service.serviceCategory] ?? service.serviceCategory)}</h2><b>HOURLY</b></div>
      <label>Đơn giá mỗi giờ (VND)<input type="number" inputmode="numeric" min="1" max="1000000000" step="1000" value="${Number(service.hourlyRate) || ''}" data-pricing-hourly-rate></label>
      <label>Phí tối thiểu (VND)<input type="number" inputmode="numeric" min="0" max="1000000000000" step="1000" value="${service.minimumCharge == null ? '' : Number(service.minimumCharge)}" data-pricing-minimum-charge></label>
      <small>${service.pricingModel === 'hourly' && service.hourlyRate != null && service.minimumCharge != null
        ? `Hiện tại: ${money(service.hourlyRate)}/giờ · tối thiểu ${money(service.minimumCharge)}`
        : `Chưa cấu hình giá theo giờ. Giá tham khảo cũ không được dùng làm đơn giá.`}</small>
      <button type="submit" data-save-pricing ${busy ? 'disabled' : ''}>Lưu giá dịch vụ</button>
    </form>`).join('') : '<div class="empty">Không có dịch vụ đang hoạt động.</div>'}
    <p class="app-message" role="status">${esc(message)}</p>
  </main>`;
}

export function readProviderPricingForm(form) {
  const hourlyRate = Number(form.querySelector('[data-pricing-hourly-rate]')?.value);
  const minimumCharge = Number(form.querySelector('[data-pricing-minimum-charge]')?.value);
  const valid = Number.isInteger(hourlyRate) && hourlyRate > 0 && hourlyRate <= 1_000_000_000
    && Number.isInteger(minimumCharge) && minimumCharge >= 0 && minimumCharge <= 1_000_000_000_000;
  return Object.freeze({
    valid,
    serviceCategory: form.dataset.pricingService,
    hourlyRate,
    minimumCharge,
  });
}
