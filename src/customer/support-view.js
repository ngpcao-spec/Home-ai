const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const backButton = '<button class="support-back" type="button" data-back-profile><span aria-hidden="true">‹</span> Quay lại Hồ sơ</button>';

export function createSupportMarkup(faqs, statusMessage = '') {
  const faqMarkup = faqs.map(({ question, answer }) => `<details class="support-faq">
    <summary>${escapeHtml(question)}<span aria-hidden="true">+</span></summary>
    <p>${escapeHtml(answer)}</p>
  </details>`).join('');

  return `${backButton}<header class="support-heading"><p class="quote-eyebrow">C21 · TRUNG TÂM TRỢ GIÚP</p><h1 id="support-title">Trợ giúp &amp; hỗ trợ</h1><span>Tìm câu trả lời hoặc liên hệ đội ngũ HOME AI.</span></header>
    <section class="support-card" aria-labelledby="faq-title"><h2 id="faq-title">Câu hỏi thường gặp</h2><div class="support-faq-list">${faqMarkup}</div></section>
    <section class="support-card" aria-labelledby="contact-support-title"><h2 id="contact-support-title">Liên hệ hỗ trợ</h2>
      <p>Đây là kênh hỗ trợ mô phỏng trong phiên bản MVP.</p>
      <div class="support-contact-actions"><button type="button" data-mock-support="call">Gọi hỗ trợ</button><button type="button" data-mock-support="message">Nhắn tin hỗ trợ</button></div>
      <p class="support-status" role="status" aria-live="polite">${escapeHtml(statusMessage)}</p>
    </section>`;
}

export function createLegalMarkup(content) {
  const renderDocument = ({ title, sections }) => `<section class="support-card legal-document"><h2>${escapeHtml(title)}</h2>${sections.map((section) => `<article><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.content)}</p></article>`).join('')}</section>`;
  return `${backButton}<header class="support-heading"><p class="quote-eyebrow">C21 · THÔNG TIN PHÁP LÝ</p><h1 id="legal-title">Điều khoản &amp; quyền riêng tư</h1><span>Nội dung được cấu trúc cho văn bản pháp lý chính thức trong tương lai.</span></header>
    <div class="legal-placeholder" role="note">Bản nội dung mẫu dành cho MVP — chưa phải văn bản pháp lý chính thức.</div>
    ${renderDocument(content.terms)}${renderDocument(content.privacy)}`;
}
