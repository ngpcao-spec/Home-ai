const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function createProviderProfileMarkup(profile) {
  const skills = profile.skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join('');
  const reviews = profile.reviews.map((review) => `<article class="provider-profile-review">
    <div><strong>${escapeHtml(review.customerName)}</strong><span aria-label="${review.rating} trên 5 sao">${'★'.repeat(review.rating)}</span></div>
    <p>${escapeHtml(review.comment)}</p>
  </article>`).join('');

  return `<article class="provider-profile-card" data-provider-profile-card="${escapeHtml(profile.providerId)}" aria-labelledby="provider-profile-name">
    <header class="provider-profile-header">
      <span class="provider-profile-photo" role="img" aria-label="${escapeHtml(profile.avatar.label)}">${escapeHtml(profile.avatar.initials)}</span>
      <div><p>HỒ SƠ KỸ THUẬT VIÊN</p><h2 id="provider-profile-name">${escapeHtml(profile.name)}</h2>
      <span class="provider-profile-rating">★ ${profile.rating} · ${profile.reviewCount} đánh giá</span></div>
      ${profile.verified ? '<strong class="verified-badge">✓ Đã xác minh</strong>' : ''}
    </header>
    <dl class="provider-profile-facts">
      <div><dt>Chuyên môn</dt><dd>${escapeHtml(profile.specialty)}</dd></div>
      <div><dt>Kinh nghiệm</dt><dd>${profile.experienceYears} năm</dd></div>
      <div><dt>Khu vực phục vụ</dt><dd>${escapeHtml(profile.serviceArea)}</dd></div>
      <div><dt>Ngôn ngữ</dt><dd>${profile.languages.map(escapeHtml).join(', ')}</dd></div>
    </dl>
    <section class="provider-profile-section"><h3>Kỹ năng</h3><ul class="provider-profile-skills">${skills}</ul></section>
    <section class="provider-profile-section"><h3>Giới thiệu</h3><p>${escapeHtml(profile.introduction)}</p></section>
    <section class="provider-profile-section"><h3>Đánh giá gần đây</h3><div class="provider-profile-reviews">${reviews}</div></section>
    <div class="provider-profile-actions">
      <button type="button" data-choose-profile-technician>Chọn kỹ thuật viên này</button>
      <button type="button" data-close-provider-profile>Quay lại</button>
    </div>
  </article>`;
}
