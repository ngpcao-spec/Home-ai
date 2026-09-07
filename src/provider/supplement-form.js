const money = value => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;

export function renderSupplementForm(parent) {
  return `<section class="provider-quote" data-supplement-form>
    <h3>Đề xuất chi phí phát sinh</h3>
    <label>Lý do / mô tả<textarea data-supplement-reason rows="3" maxlength="4000"></textarea></label>
    <label>Công bổ sung (VND)<input data-supplement-labor type="number" inputmode="numeric" min="0" step="1" value=""></label>
    <label>Linh kiện bổ sung (VND)<input data-supplement-parts type="number" inputmode="numeric" min="0" step="1" value=""></label>
    <label>Bảo hành (ngày, không bắt buộc)<input data-supplement-warranty type="number" inputmode="numeric" min="0" max="3650" step="1" value=""></label>
    <p>Giá đã chấp nhận: ${money(Number(parent.totalAmount))}</p>
    <p data-supplement-total role="status"></p>
    <button type="button" data-send-supplement>Gửi chi phí phát sinh cho khách hàng</button>
    <button type="button" data-cancel-supplement>Hủy</button>
    <small>Chỉ thực hiện chi phí phát sinh sau khi khách hàng chấp nhận.</small>
  </section>`;
}

export function readSupplementForm(root, parent) {
  const number = key => {
    const field = root.querySelector(`[data-supplement-${key}]`);
    if (field.validity?.badInput) return NaN;
    return Number(field.value);
  };
  const finding = root.querySelector('[data-supplement-reason]').value.trim();
  const additionalLaborAmount = number('labor');
  const additionalPartsAmount = number('parts');
  const warrantyDays = root.querySelector('[data-supplement-warranty]').value === ''
    ? Number(parent.warrantyDays) : number('warranty');
  const total = Number(parent.totalAmount) + additionalLaborAmount + additionalPartsAmount;
  const valid = finding.length > 0 && finding.length <= 4000
    && [additionalLaborAmount, additionalPartsAmount, warrantyDays, total].every(value => Number.isSafeInteger(value) && value >= 0)
    && warrantyDays <= 3650;
  return { draft: { finding, additionalLaborAmount, additionalPartsAmount, warrantyDays, parentQuoteId: parent.id }, total, valid };
}

export function updateSupplementForm(root, parent, canSend, busy) {
  const result = readSupplementForm(root, parent);
  root.querySelector('[data-supplement-total]').textContent = Number.isSafeInteger(result.total)
    ? `Tổng mới đề xuất: ${money(result.total)}` : 'Vui lòng nhập số tiền hợp lệ.';
  root.querySelector('[data-send-supplement]').disabled = busy || !canSend || !result.valid;
  root.querySelector('[data-cancel-supplement]').disabled = busy;
  return result;
}
