const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const profileIcon = (symbol) => `<span class="profile-section-icon" aria-hidden="true">${symbol}</span>`;

const profileInitials = (name) => String(name ?? '')
  .trim().split(/\s+/).slice(-2).map((part) => part[0] ?? '').join('').toUpperCase() || 'MA';

const safeAvatarUrl = (value) => {
  try {
    const url = new URL(String(value ?? ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
};

export function createCustomerProfileMarkup(profile, options = {}) {
  const avatarUrl = safeAvatarUrl(profile.avatarUrl);
  const avatar = avatarUrl
    ? `<img class="customer-profile-avatar" src="${escapeHtml(avatarUrl)}" alt="Ảnh đại diện của ${escapeHtml(profile.name)}">`
    : `<span class="customer-profile-avatar" aria-hidden="true">${escapeHtml(profileInitials(profile.name))}</span>`;
  const loadStatus = options.loadMessage
    ? `<p class="profile-load-status" data-profile-load-status role="status">${escapeHtml(options.loadMessage)}</p>`
    : '';
  const editingAddress = profile.addresses.find(({ id }) => id === options.editingAddressId);
  const addresses = profile.addresses.length
    ? profile.addresses.map((item) => `<article class="customer-address-card">
        <div><strong>${escapeHtml(item.label)}</strong>${item.isDefault ? '<span>Mặc định</span>' : ''}<p>${escapeHtml(item.address)}</p></div>
        <div class="address-actions">
          ${item.isDefault ? '' : `<button type="button" data-default-address="${escapeHtml(item.id)}">Đặt mặc định</button>`}
          <button type="button" data-edit-address="${escapeHtml(item.id)}">Sửa</button>
          <button type="button" data-delete-address="${escapeHtml(item.id)}">Xóa</button>
        </div>
      </article>`).join('')
    : '<p class="empty-addresses">Bạn chưa có địa chỉ đã lưu.</p>';
  const addressForm = options.addressFormOpen
    ? `<form class="address-form" data-address-form>
        <h3>${editingAddress ? 'Chỉnh sửa địa chỉ' : 'Thêm địa chỉ'}</h3>
        <label>Tên địa chỉ<input name="label" value="${escapeHtml(editingAddress?.label)}" placeholder="Ví dụ: Nhà, Văn phòng" required></label>
        <label>Địa chỉ<input name="address" value="${escapeHtml(editingAddress?.address)}" placeholder="Nhập địa chỉ tại Nha Trang" required></label>
        <label class="default-address-option"><input type="checkbox" name="isDefault" ${editingAddress?.isDefault ? 'checked' : ''}> Đặt làm địa chỉ mặc định</label>
        <div><button type="submit">Lưu địa chỉ</button><button type="button" data-cancel-address>Hủy</button></div>
      </form>`
    : '<button class="add-address" type="button" data-add-address>+ Thêm địa chỉ</button>';

  return `<div class="customer-profile-heading"><p class="quote-eyebrow">TÀI KHOẢN KHÁCH HÀNG</p><h1 id="profile-title">Hồ sơ</h1>${loadStatus}</div>
    <article class="customer-profile-card">
      ${avatar}
      <div><strong>${escapeHtml(profile.name)}</strong><span>${escapeHtml(profile.phone)}</span><small>${escapeHtml(profile.language)}</small></div>
    </article>
    <section class="profile-section" aria-labelledby="personal-info-title">
      <h2 id="personal-info-title">${profileIcon('人')}Thông tin cá nhân</h2>
      <dl><div><dt>Họ và tên</dt><dd>${escapeHtml(profile.name)}</dd></div><div><dt>Số điện thoại</dt><dd>${escapeHtml(profile.phone)}</dd></div><div><dt>Ngôn ngữ</dt><dd>${escapeHtml(profile.language)}</dd></div></dl>
    </section>
    <section class="profile-section" aria-labelledby="addresses-title">
      <h2 id="addresses-title">${profileIcon('⌖')}Địa chỉ của tôi</h2><div class="customer-address-list">${addresses}</div>${addressForm}
      <p class="profile-action-status" data-profile-action-status role="status">${escapeHtml(options.statusMessage)}</p>
    </section>
    <div class="profile-menu">
      <button type="button" data-profile-history>${profileIcon('↻')}<span><strong>Lịch sử dịch vụ</strong><small>Xem các chuyến đã hoàn thành</small></span><em>›</em></button>
      <button type="button" data-profile-help>${profileIcon('?')}<span><strong>Trợ giúp &amp; hỗ trợ</strong><small>Câu hỏi thường gặp và liên hệ</small></span><em>›</em></button>
      <button type="button" data-profile-terms>${profileIcon('§')}<span><strong>Điều khoản &amp; quyền riêng tư</strong><small>Thông tin sử dụng dịch vụ</small></span><em>›</em></button>
      <button class="logout-action" type="button" data-profile-logout>${profileIcon('↪')}<span><strong>Đăng xuất</strong><small>Đăng xuất khỏi phiên khách hàng hiện tại</small></span><em>›</em></button>
    </div>`;
}
