const formatPrice = (price) => `${new Intl.NumberFormat('vi-VN').format(price)}đ`;
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function getLatestAcceptedQuoteAmount(quoteHistory = []) {
  const latestAccepted = quoteHistory.reduce((latest, quote) => {
    if (quote.status !== 'accepted') return latest;
    return !latest || quote.version > latest.version ? quote : latest;
  }, null);
  return latestAccepted?.totalAmount ?? null;
}

export function getCompletedMissionPricePresentation(quoteHistory = [], finalAuthorizedAmount = null) {
  return Object.freeze({
    label: 'Tổng tiền cuối cùng',
    amount: finalAuthorizedAmount ?? getLatestAcceptedQuoteAmount(quoteHistory),
  });
}

export function createCompletionSummaryMarkup(completion, quoteHistory, context = {}) {
  if (!completion) return '';
  const acceptedQuote = quoteHistory.filter(({ status }) => status === 'accepted').at(-1);
  const history = quoteHistory.map(({ version, status, totalAmount }) => `<li><strong>v${version}</strong><span>${formatPrice(totalAmount)}</span><em>${status}</em></li>`).join('');
  const invoice = completion.invoice;
  const invoiceBreakdown = invoice?.pricingModel === 'hourly' ? `<div class="customer-invoice" data-customer-hourly-invoice>
    <p class="quote-eyebrow">HÓA ĐƠN</p><dl>
      <div><dt>Thời gian làm việc</dt><dd>${Math.floor(invoice.workedMinutes / 60)} giờ ${invoice.workedMinutes % 60} phút</dd></div>
      <div><dt>Đơn giá</dt><dd>${formatPrice(invoice.hourlyRate)}/giờ</dd></div>
      <div><dt>Mức phí tối thiểu</dt><dd>${formatPrice(invoice.minimumCharge)}</dd></div>
      <div><dt>Tiền công</dt><dd>${formatPrice(invoice.laborAmount)}</dd></div>
      <div><dt>Vật tư</dt><dd>${formatPrice(invoice.materialAmount)}</dd></div>
      <div class="payment-total"><dt>TỔNG THANH TOÁN</dt><dd>${formatPrice(invoice.totalAmount)}</dd></div>
    </dl></div>` : '';
  const completedWork = completion.completedWork.length
    ? `<div class="completed-work"><h4>Công việc đã thực hiện</h4><ul>${completion.completedWork.map((work) => `<li>${escapeHtml(work)}</li>`).join('')}</ul></div>` : '';
  const financialSummary = invoice?.pricingModel === 'hourly'
    ? ''
    : `<div class="final-financial-summary">
      <p class="quote-eyebrow">TÓM TẮT CHI PHÍ</p>
      <dl>
        <div><dt>Báo giá cuối cùng đã chấp nhận</dt><dd>${formatPrice(acceptedQuote?.totalAmount ?? completion.finalAuthorizedAmount)}</dd></div>
        <div class="payment-total"><dt>TỔNG THANH TOÁN</dt><dd>${formatPrice(completion.finalAuthorizedAmount)}</dd></div>
        ${completion.warrantyDays == null ? '' : `<div><dt>Bảo hành</dt><dd>${completion.warrantyDays} ngày</dd></div>`}
      </dl>
    </div>`;
  const quoteHistoryMarkup = history
    ? `<div class="quote-history"><p class="quote-eyebrow">LỊCH SỬ BÁO GIÁ</p><ol>${history}</ol></div>` : '';
  return `<section class="completion-summary" aria-labelledby="completion-title">
    <div class="completion-check" aria-hidden="true">✓</div>
    <p class="quote-eyebrow">HOÀN THÀNH CAN THIỆP</p>
    <h3 id="completion-title">Sửa chữa hoàn tất</h3>
    <p>Kỹ thuật viên đã hoàn thành công việc.</p>
    <dl class="completion-facts">
      <div><dt>Thợ</dt><dd>${escapeHtml(context.providerName ?? '')}</dd></div>
      <div><dt>Vấn đề</dt><dd>${escapeHtml(context.problem ?? '')}</dd></div>
      <div><dt>Trạng thái</dt><dd>Hoàn thành</dd></div>
    </dl>
    ${completedWork}${invoiceBreakdown}${financialSummary}${quoteHistoryMarkup}
    <div class="external-payment"><strong>Thanh toán trực tiếp cho thợ</strong><p>HOME AI không xử lý thanh toán trong ứng dụng.</p></div>
    <button class="continue-payment" type="button" data-continue-payment>Tôi đã thanh toán</button>
    <p class="payment-preparation-status" data-payment-preparation-status role="status"></p>
  </section>`;
}

export function createPaidExternalMarkup(completion) {
  return `<section class="paid-external" role="status">
    <div class="completion-check" aria-hidden="true">✓</div>
    <p class="quote-eyebrow">HOÀN THÀNH</p>
    <h3>Đã thanh toán</h3>
    <p>Kỹ thuật viên đã được thanh toán trực tiếp.</p>
    <strong>${formatPrice(completion.finalAuthorizedAmount)}</strong>
  </section>`;
}

export function createProviderAvatarMarkup() {
  return '<span class="provider-profile-avatar" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="17" r="8"/><path d="M10 42c1.5-10 6.7-15 14-15s12.5 5 14 15"/></svg></span>';
}

export function createProviderReviewMarkup(technician, missionState) {
  const stars = [1, 2, 3, 4, 5].map((rating) => `<button type="button" data-rating="${rating}" aria-label="${rating} sao" class="${missionState.rating >= rating ? 'is-selected' : ''}" ${missionState.reviewSent ? 'disabled' : ''}>★</button>`).join('');
  const reviewForm = missionState.reviewSent
    ? `<p class="review-thanks" role="status">Cảm ơn bạn đã đánh giá!</p>
      <button class="view-mission-detail" type="button" data-view-mission-detail>Xem chi tiết chuyến</button>
      ${missionState.missionDetailTarget ? '<p class="mission-detail-status" role="status">Đã sẵn sàng mở chi tiết chuyến.</p>' : ''}`
    : `<label>Nhận xét (không bắt buộc)<textarea data-review-comment rows="3" placeholder="Chia sẻ trải nghiệm của bạn...">${escapeHtml(missionState.reviewComment ?? '')}</textarea></label>
      <button type="button" data-send-review ${missionState.rating ? '' : 'disabled'}>Gửi đánh giá</button>`;
  return `<section class="provider-review" aria-labelledby="provider-review-title">
    <p class="paid-badge">✓ Đã thanh toán · ${formatPrice(missionState.completion.finalAuthorizedAmount)}</p>
    <div class="provider-review-profile">
      ${createProviderAvatarMarkup()}
      <div><strong>${escapeHtml(technician.name)}</strong><span>⭐ ${technician.rating} · ${technician.reviewCount ?? 0} đánh giá</span><small>${escapeHtml(technician.shortDescription ?? technician.category)}</small></div>
    </div>
    <h3 id="provider-review-title">Đánh giá kỹ thuật viên</h3>
    <p>Trải nghiệm của bạn với kỹ thuật viên như thế nào?</p>
    <div class="stars" role="group" aria-label="Chọn số sao">${stars}</div>
    ${reviewForm}
  </section>`;
}
