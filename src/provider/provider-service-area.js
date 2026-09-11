const ALLOWED_RADII = Object.freeze([5, 10, 20, 30, 50]);
const esc = (value = '') => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export function renderProviderServiceArea(serviceArea, { loading = false, error = '', message = '', busy = false } = {}) {
  if (loading) return '<section class="provider-service-area"><p class="pricing-kicker">HỒ SƠ</p><h1>Zone d’intervention</h1><div class="empty">Đang tải bán kính…</div></section>';
  if (error) return `<section class="provider-service-area"><p class="pricing-kicker">HỒ SƠ</p><h1>Zone d’intervention</h1><div class="history-error" role="alert">Không thể tải khu vực hoạt động.<small>${esc(error)}</small><button data-service-area-retry>Thử lại</button></div></section>`;
  const radius = Number(serviceArea?.serviceRadiusKm ?? 20);
  return `<section class="provider-service-area">
    <p class="pricing-kicker">HỒ SƠ</p><h1>Zone d’intervention</h1>
    <p>La zone suit automatiquement votre position GPS actuelle.</p>
    <form class="service-area-card" data-service-area-form>
      <strong>Rayon maximum : <span data-service-area-value>${radius}</span> km</strong>
      <div class="service-area-options" role="radiogroup" aria-label="Rayon maximum">
        ${ALLOWED_RADII.map(value => `<label><input type="radio" name="service-radius" value="${value}" data-service-area-radius ${value === radius ? 'checked' : ''}><span>${value} km</span></label>`).join('')}
      </div>
      <small>Khoảng cách được tính từ vị trí GPS gần nhất của bạn.</small>
      <button type="submit" data-save-service-area ${busy ? 'disabled' : ''}>Lưu thay đổi</button>
    </form><p class="app-message" role="status">${esc(message)}</p>
  </section>`;
}

export function readProviderServiceArea(root) {
  const radius = Number(root.querySelector('[data-service-area-radius]:checked')?.value);
  return Object.freeze({ valid: ALLOWED_RADII.includes(radius), serviceRadiusKm: radius });
}

export function updateProviderServiceAreaPreview(root) {
  const result = readProviderServiceArea(root);
  const output = root.querySelector('[data-service-area-value]');
  if (result.valid && output) output.textContent = String(result.serviceRadiusKm);
  return result;
}

export { ALLOWED_RADII as PROVIDER_SERVICE_AREA_RADII };
