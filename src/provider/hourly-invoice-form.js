import { calculateHourlyInvoice } from '../billing/hourly-pricing.js';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;

export function renderHourlyInvoiceForm(pricing, { busy = false } = {}) {
  if (pricing?.pricingModel !== 'hourly') {
    return '<section class="provider-invoice" data-provider-invoice-unavailable><h2>Chưa thể lập hóa đơn</h2><p>Dịch vụ này chưa được cấu hình tarif theo giờ.</p></section>';
  }
  return `<section class="provider-invoice" data-hourly-invoice-form>
    <p class="invoice-kicker">HÓA ĐƠN CUỐI CÙNG</p>
    <h2>Khai báo thời gian làm việc</h2>
    <p>Kiểm tra và sửa thông tin trước khi gửi. Hóa đơn đã gửi sẽ không thể chỉnh sửa.</p>
    <div class="invoice-duration">
      <label>Giờ<input inputmode="numeric" type="number" min="0" max="168" step="1" value="0" data-invoice-hours></label>
      <label>Phút<input inputmode="numeric" type="number" min="0" max="59" step="1" value="0" data-invoice-minutes></label>
    </div>
    <label>Vật tư tổng cộng (VND)<input inputmode="numeric" type="number" min="0" step="1000" value="0" data-invoice-material></label>
    <dl class="invoice-breakdown">
      <div><dt>Thời gian khai báo</dt><dd data-invoice-duration>—</dd></div>
      <div><dt>Đơn giá theo giờ</dt><dd>${money(pricing.hourlyRate)}</dd></div>
      <div><dt>Mức phí tối thiểu</dt><dd>${money(pricing.minimumCharge)}</dd></div>
      <div><dt>Tiền công</dt><dd data-invoice-labor>—</dd></div>
      <div><dt>Vật tư</dt><dd data-invoice-material-summary>${money(0)}</dd></div>
      <div class="invoice-total"><dt>TỔNG THANH TOÁN</dt><dd data-invoice-total>—</dd></div>
    </dl>
    <p class="invoice-validation" data-invoice-validation role="status">Nhập thời gian làm việc để tiếp tục.</p>
    <div class="invoice-actions"><button type="button" data-cancel-invoice ${busy ? 'disabled' : ''}>Quay lại</button><button type="button" data-send-invoice disabled>Gửi hóa đơn</button></div>
  </section>`;
}

export function readHourlyInvoiceForm(root, pricing) {
  try {
    const invoice = calculateHourlyInvoice({
      hourlyRate: pricing.hourlyRate,
      minimumCharge: pricing.minimumCharge,
      hours: Number(root.querySelector('[data-invoice-hours]')?.value),
      minutes: Number(root.querySelector('[data-invoice-minutes]')?.value),
      materialAmount: Number(root.querySelector('[data-invoice-material]')?.value),
    });
    return Object.freeze({ valid: true, invoice });
  } catch (error) {
    return Object.freeze({ valid: false, invoice: null, error });
  }
}

export function updateHourlyInvoiceForm(root, pricing, canSubmit = true, busy = false) {
  const result = readHourlyInvoiceForm(root, pricing);
  const moneyText = (value) => money(value);
  const duration = root.querySelector('[data-invoice-duration]');
  const labor = root.querySelector('[data-invoice-labor]');
  const material = root.querySelector('[data-invoice-material-summary]');
  const total = root.querySelector('[data-invoice-total]');
  const validation = root.querySelector('[data-invoice-validation]');
  const submit = root.querySelector('[data-send-invoice]');
  if (result.valid) {
    duration.textContent = `${result.invoice.hours} giờ ${result.invoice.minutes} phút`;
    labor.textContent = moneyText(result.invoice.laborAmount);
    material.textContent = moneyText(result.invoice.materialAmount);
    total.textContent = moneyText(result.invoice.totalAmount);
    validation.textContent = result.invoice.laborAmount === pricing.minimumCharge
      ? 'Áp dụng mức phí tối thiểu.' : 'Tiền công được tính theo thời gian khai báo.';
  } else {
    if (duration) duration.textContent = '—';
    if (labor) labor.textContent = '—';
    if (material) material.textContent = moneyText(Number(root.querySelector('[data-invoice-material]')?.value) || 0);
    if (total) total.textContent = '—';
    if (validation) validation.textContent = 'Thời gian phải từ 1 phút; số phút từ 0 đến 59.';
  }
  if (submit) submit.disabled = !result.valid || !canSubmit || busy;
  return result;
}
