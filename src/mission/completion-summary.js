const formatPrice = (price) => `${new Intl.NumberFormat('vi-VN').format(price)}đ`;
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function createCompletionSummaryMarkup(completion, quoteHistory) {
  if (!completion) return '';
  const initial = quoteHistory[0];
  const supplement = quoteHistory.find(({ version }) => version === 2);
  const acceptedSupplementAmount = supplement?.status === 'accepted' ? supplement.supplementAmount : 0;
  const history = quoteHistory.map(({ version, status, totalAmount }) => `<li><strong>v${version}</strong><span>${formatPrice(totalAmount)}</span><em>${status}</em></li>`).join('');
  return `<section class="completion-summary" aria-labelledby="completion-title">
    <div class="completion-check" aria-hidden="true">✓</div>
    <p class="quote-eyebrow">HOÀN THÀNH CAN THIỆP</p>
    <h3 id="completion-title">Sửa chữa hoàn tất</h3>
    <p>Kỹ thuật viên đã hoàn thành công việc.</p>
    <div class="completed-work"><h4>Công việc đã thực hiện</h4><ul>${completion.completedWork.map((work) => `<li>${escapeHtml(work)}</li>`).join('')}</ul></div>
    <div class="final-financial-summary">
      <p class="quote-eyebrow">TÓM TẮT CHI PHÍ</p>
      <dl>
        <div><dt>Giá ban đầu đã chấp nhận</dt><dd>${formatPrice(initial.totalAmount)}</dd></div>
        <div><dt>Chi phí phát sinh đã chấp nhận</dt><dd>${acceptedSupplementAmount ? `+${formatPrice(acceptedSupplementAmount)}` : formatPrice(0)}</dd></div>
        <div class="payment-total"><dt>TỔNG THANH TOÁN</dt><dd>${formatPrice(completion.finalAuthorizedAmount)}</dd></div>
        <div><dt>Bảo hành</dt><dd>${completion.warrantyDays} ngày</dd></div>
      </dl>
    </div>
    <div class="quote-history"><p class="quote-eyebrow">LỊCH SỬ BÁO GIÁ</p><ol>${history}</ol></div>
    <button class="continue-payment" type="button" data-continue-payment>Tiếp tục thanh toán</button>
    <p class="payment-preparation-status" data-payment-preparation-status role="status"></p>
  </section>`;
}
