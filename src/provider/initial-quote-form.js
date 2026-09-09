const money = value => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;

const readAmount = (root, key) => {
  const field = root.querySelector(`[data-quote-${key}]`);
  if (!field || field.validity?.badInput || field.value === '') return NaN;
  return Number(field.value);
};

export function renderInitialQuoteForm({ busy = false } = {}) {
  return `<section class="provider-quote" data-initial-quote-form>
    <p>CHẨN ĐOÁN & BÁO GIÁ</p>
    <label>Kết quả chẩn đoán <small>(không bắt buộc)</small><textarea data-quote-diagnosis rows="3" maxlength="4000" placeholder="Có thể để trống"></textarea></label>
    <div class="quote-grid">
      <label>Công thợ (VND)<input data-quote-labor type="number" inputmode="numeric" min="0" step="1000" value=""></label>
      <label>Linh kiện / vật tư (VND)<input data-quote-parts type="number" inputmode="numeric" min="0" step="1000" value="0"></label>
    </div>
    <div class="initial-quote-total"><small>TỔNG CỘNG</small><strong data-quote-total role="status">0đ</strong></div>
    <label>Bảo hành <small>(không bắt buộc)</small><input data-quote-warranty type="number" inputmode="numeric" min="0" max="3650" step="1" value="" placeholder="Số ngày"></label>
    <button type="button" data-send-quote ${busy ? 'disabled' : ''}>Gửi báo giá cho khách hàng</button>
    <small>Chỉ bắt đầu công việc tính phí sau khi khách hàng chấp nhận rõ ràng.</small>
  </section>`;
}

export function readInitialQuoteForm(root) {
  const diagnosis = root.querySelector('[data-quote-diagnosis]')?.value.trim() ?? '';
  const laborAmount = readAmount(root, 'labor');
  const partsAmount = readAmount(root, 'parts');
  const warrantyField = root.querySelector('[data-quote-warranty]');
  const warrantyDays = warrantyField?.value === '' ? 0 : readAmount(root, 'warranty');
  const total = laborAmount + partsAmount;
  const valid = diagnosis.length <= 4000
    && [laborAmount, partsAmount, warrantyDays, total].every(value => Number.isSafeInteger(value) && value >= 0)
    && warrantyDays <= 3650
    && total > 0;
  return { draft: { diagnosis, laborAmount, partsAmount, warrantyDays,
    laborDescription: 'Công kiểm tra và sửa chữa', partsDescription: 'Linh kiện dự kiến' }, total, valid };
}

export function updateInitialQuoteForm(root, canSend, busy) {
  const result = readInitialQuoteForm(root);
  const total = root.querySelector('[data-quote-total]');
  if (total) total.textContent = Number.isSafeInteger(result.total) ? money(result.total) : 'Số tiền không hợp lệ';
  const submit = root.querySelector('[data-send-quote]');
  if (submit) submit.disabled = busy || !canSend || !result.valid;
  return result;
}
