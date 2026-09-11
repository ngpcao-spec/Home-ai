import { getProviderActivityLabel } from './provider-activities.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const initials = (name = '') => String(name).trim().split(/\s+/).filter(Boolean).slice(-2)
  .map(part => part[0]).join('').toUpperCase() || 'P';

export const normalizeProviderPhone = (value = '') => {
  const compact = String(value).replace(/[\s().-]/g, '');
  if (!compact) return '';
  if (/^0\d{9}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
};

export function renderProviderProfessionalProfile(profile, {
  loading = false, error = '', message = '', busy = false, previewUrl = '',
} = {}) {
  if (loading) return '<section class="provider-professional"><p class="pricing-kicker">HỒ SƠ</p><h1>Hồ sơ nghề nghiệp</h1><div class="empty">Đang tải hồ sơ…</div></section>';
  if (error || !profile) return `<section class="provider-professional"><p class="pricing-kicker">HỒ SƠ</p><h1>Hồ sơ nghề nghiệp</h1><div class="history-error" role="alert">Không thể tải hồ sơ.<small>${esc(error)}</small><button data-professional-profile-retry>Thử lại</button></div></section>`;
  const photo = previewUrl || profile.avatarUrl || '';
  return `<section class="provider-professional" aria-labelledby="professional-profile-title">
    <p class="pricing-kicker">HỒ SƠ</p><h1 id="professional-profile-title">Hồ sơ nghề nghiệp</h1>
    <p>Thông tin khách hàng nhìn thấy khi chọn kỹ thuật viên.</p>
    <form class="professional-profile-card" data-professional-profile-form>
      <div class="professional-photo-field">
        <span class="professional-photo-preview" data-professional-photo-preview>${photo
          ? `<img src="${esc(photo)}" alt="Ảnh đại diện">`
          : `<span aria-hidden="true">${esc(initials(profile.name))}</span>`}</span>
        <div><strong>Ảnh đại diện</strong><small>Khác với ảnh CCCD. Tối đa 5 MB.</small>
          <label class="professional-photo-button">Chọn ảnh<input type="file" accept="image/jpeg,image/png,image/webp" data-professional-photo-input></label>
        </div>
      </div>
      <p class="professional-rating" aria-label="${Number(profile.rating) || 0} trên 5 sao">★ ${Number(profile.rating) || 0} · ${Number(profile.reviewCount) || 0} đánh giá</p>
      <label>Họ và tên <input name="displayName" autocomplete="name" maxlength="120" required value="${esc(profile.name)}"></label>
      <label>Số điện thoại <input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="0912 345 678" value="${esc(profile.phone ?? '')}"></label>
      <label>Số năm kinh nghiệm <input name="experienceYears" type="number" inputmode="numeric" min="0" max="80" step="1" value="${profile.experienceYears == null ? '' : Number(profile.experienceYears)}" placeholder="Không bắt buộc"></label>
      <label>Giới thiệu <textarea name="introduction" maxlength="300" rows="4" placeholder="Giới thiệu ngắn về kinh nghiệm và cách làm việc">${esc(profile.introduction ?? '')}</textarea><small><span data-professional-introduction-count>${String(profile.introduction ?? '').length}</span>/300</small></label>
      <button type="submit" data-save-professional-profile ${busy ? 'disabled' : ''}>Lưu thay đổi</button>
    </form><p class="app-message" role="status">${esc(message)}</p>
  </section>`;
}

export function readProviderProfessionalProfile(form, photoFile = null) {
  const name = String(form?.elements?.displayName?.value ?? '').trim();
  const phone = normalizeProviderPhone(form?.elements?.phone?.value ?? '');
  const experienceValue = String(form?.elements?.experienceYears?.value ?? '').trim();
  const experienceYears = experienceValue === '' ? null : Number(experienceValue);
  const introduction = String(form?.elements?.introduction?.value ?? '').trim();
  const photoValid = !photoFile || ['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type) && photoFile.size > 0 && photoFile.size <= 5_242_880;
  return Object.freeze({
    valid: name.length >= 1 && name.length <= 120 && phone !== null
      && (experienceYears === null || Number.isInteger(experienceYears) && experienceYears >= 0 && experienceYears <= 80)
      && introduction.length <= 300 && photoValid,
    name, phone, experienceYears, introduction, photoFile,
  });
}

export function updateProviderProfessionalProfileDraft(root, photoUrl = '') {
  const textarea = root.querySelector('[name="introduction"]');
  const count = root.querySelector('[data-professional-introduction-count]');
  if (textarea && count) count.textContent = String(textarea.value.length);
  const preview = root.querySelector('[data-professional-photo-preview]');
  if (preview && photoUrl) preview.innerHTML = `<img src="${esc(photoUrl)}" alt="Ảnh đại diện mới">`;
}

export function renderProviderActivitiesSummary(services = []) {
  return `<section class="provider-profile-activities"><div><p class="pricing-kicker">DỊCH VỤ</p><h1>Hoạt động của tôi</h1></div>
    <div>${services.length ? services.map(service => `<span>${esc(getProviderActivityLabel(service))}</span>`).join('') : '<small>Chưa có hoạt động.</small>'}</div>
    <button type="button" data-open-provider-activities>Quản lý hoạt động</button>
  </section>`;
}
