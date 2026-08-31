const formatDistance = (distanceKm) => distanceKm < 1
  ? `${Math.round(distanceKm * 1000)} m`
  : `${distanceKm.toFixed(1)} km`;

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
