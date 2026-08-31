const formatDistance = (distanceKm) => distanceKm < 1
  ? `${Math.round(distanceKm * 1000)} m`
  : `${distanceKm.toFixed(1)} km`;

const formatPrice = (price) => `${new Intl.NumberFormat('vi-VN').format(price)}đ`;
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function createInterventionQuoteMarkup(quote, phase = 'quote_pending') {
  const decision = phase === 'repairing'
    ? '<p class="quote-decision quote-decision--accepted" role="status">Bạn đã chấp nhận báo giá. Thợ bắt đầu sửa chữa.</p>'
    : phase === 'quote_declined'
      ? '<p class="quote-decision quote-decision--declined" role="status">Bạn đã từ chối báo giá. Việc sửa chữa chưa bắt đầu.</p>'
      : '<div class="quote-actions"><button type="button" data-quote-decision="accepted">Chấp nhận báo giá</button><button type="button" data-quote-decision="declined">Từ chối báo giá</button></div>';
  return `<div class="intervention-diagnosis">
    <p class="quote-eyebrow">KẾT QUẢ CHẨN ĐOÁN</p>
    <h4>${escapeHtml(quote.diagnosis)}</h4>
    <p>${escapeHtml(quote.recommendedWork)}</p>
  </div>
  <div class="repair-quote">
    <div class="quote-heading"><div><p class="quote-eyebrow">BÁO GIÁ SỬA CHỮA</p><h4>${formatPrice(quote.totalAmount)}</h4></div><span>${quote.estimatedMinutes} phút</span></div>
    <dl>
      <div><dt>Công thợ</dt><dd>${formatPrice(quote.laborAmount)}</dd></div>
      <div><dt>Linh kiện dự kiến</dt><dd>${formatPrice(quote.partsAmount)}</dd></div>
      <div><dt>Tổng cộng</dt><dd>${formatPrice(quote.totalAmount)}</dd></div>
      <div><dt>Bảo hành</dt><dd>${quote.warrantyDays} ngày</dd></div>
    </dl>
    <p class="quote-note">Chỉ bắt đầu sửa chữa sau khi bạn chấp nhận báo giá.</p>
    ${decision}
  </div>`;
}

export function createTrackingStageMarkup(technician) {
  return `<div class="tracking-shell">
    <div class="tracking-map" data-tracking-map aria-label="Bản đồ theo dõi thợ"></div>
    <article class="tracking-bottom-sheet" aria-label="Thông tin thợ đang đến">
      <div class="tracking-provider">
        <span class="technician-avatar" aria-hidden="true">${technician.initials}</span>
        <div><h3>${technician.name}</h3><p>⭐ ${technician.rating} · ${technician.reviewCount ?? 0} đánh giá</p><small>${technician.specialty ?? technician.shortDescription ?? technician.category}</small></div>
        <strong data-tracking-status>Thợ đang đến</strong>
      </div>
      <p class="tracking-status-message" data-tracking-message hidden></p>
      <div class="tracking-metrics" data-tracking-metrics>
        <div><span>Thời gian đến</span><strong data-tracking-eta>Đang tính...</strong></div>
        <div><span>Quãng đường còn lại</span><strong data-tracking-distance>Đang tính...</strong></div>
      </div>
      <div class="tracking-contact-actions">
        <button type="button" data-tracking-call>☎ Gọi thợ</button>
        <button type="button" data-tracking-message>💬 Nhắn tin</button>
      </div>
      <p class="tracking-action-status" data-tracking-action-status role="status"></p>
      <button class="start-repair" type="button" data-start-repair hidden>Bắt đầu sửa chữa</button>
      <section class="intervention-quote" data-intervention-quote hidden aria-label="Chẩn đoán và báo giá sửa chữa"></section>
    </article>
  </div>`;
}

export function updateTrackingPresentation(container, position) {
  container.querySelector('[data-tracking-status]').textContent = position.status;
  container.querySelector('[data-tracking-eta]').textContent = position.arrived ? '0 phút' : `${position.etaMinutes} phút`;
  container.querySelector('[data-tracking-distance]').textContent = formatDistance(position.remainingDistanceKm);
  container.querySelector('[data-start-repair]').hidden = !position.arrived;
  const message = container.querySelector('[data-tracking-message]');
  message.textContent = position.arrived ? 'Thợ đã đến địa điểm của bạn.' : '';
  message.hidden = !position.arrived;
}

export function updateInterventionPresentation(container) {
  container.querySelector('[data-tracking-status]').textContent = 'Đang sửa chữa';
  const message = container.querySelector('[data-tracking-message]');
  message.textContent = 'Thợ đang kiểm tra và sửa chữa thiết bị của bạn.';
  message.hidden = false;
  container.querySelector('[data-tracking-metrics]').hidden = true;
  container.querySelector('[data-start-repair]').hidden = true;
}

export function updateInterventionQuotePresentation(container, state) {
  const phase = state.interventionPhase;
  const status = container.querySelector('[data-tracking-status]');
  const message = container.querySelector('[data-tracking-message]');
  const quote = container.querySelector('[data-intervention-quote]');
  container.querySelector('[data-tracking-metrics]').hidden = true;
  container.querySelector('[data-start-repair]').hidden = true;
  quote.hidden = false;
  quote.innerHTML = createInterventionQuoteMarkup(state.quote, phase);
  if (phase === 'repairing') {
    status.textContent = 'Đang sửa chữa';
    message.textContent = 'Thợ đang kiểm tra và sửa chữa thiết bị của bạn.';
  } else if (phase === 'quote_declined') {
    status.textContent = 'Đã từ chối báo giá';
    message.textContent = 'Việc sửa chữa chưa bắt đầu.';
  } else {
    status.textContent = 'Chờ xác nhận báo giá';
    message.textContent = 'Thợ đã kiểm tra và gửi báo giá sửa chữa.';
  }
  message.hidden = false;
  return status.textContent;
}
