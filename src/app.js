import { createMockDiagnostic } from './diagnostic/mock-diagnostic.js';
import { findBestTechnicians, getMatchReasons } from './technicians/matching.js';
import { createMockTechnicianRepository, defaultMvpLocation } from './technicians/repository.js';

export const serviceCategories = [
  { id: 'electricity', label: 'Điện', technician: 'Thợ điện dân dụng', icon: 'bolt', prompt: 'Tôi cần sửa điện trong nhà' },
  { id: 'plumbing', label: 'Nước', technician: 'Thợ sửa ống nước', icon: 'drop', prompt: 'Tôi cần sửa đường nước' },
  { id: 'air-conditioning', label: 'Điều hòa', technician: 'Thợ kỹ thuật điều hòa', icon: 'snow', prompt: 'Điều hòa nhà tôi cần kiểm tra' },
  { id: 'appliances', label: 'Điện gia dụng', technician: 'Thợ sửa điện gia dụng', icon: 'plug', prompt: 'Tôi cần sửa thiết bị điện gia dụng' },
];

const icons = {
  bolt: '<path d="M13 2 5.8 13h5.7L11 22l7.2-11h-5.7L13 2Z"/>',
  drop: '<path d="M12 2.8S5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 2.8 12 2.8Z"/><path d="M9 16.2c.5 1.3 1.4 2 2.8 2.2"/>',
  snow: '<path d="M12 2v20M4 7l16 10M20 7 4 17M8.5 4.5 12 7l3.5-2.5M8.5 19.5 12 17l3.5 2.5M3.8 10.2 7.5 10l.2-3.7M20.2 13.8l-3.7.2-.2 3.7"/>',
  plug: '<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-6 6v5M9 21h6"/>',
};

function icon(name) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[name]}</svg>`;
}

const formatPrice = (price) => new Intl.NumberFormat('vi-VN').format(price);
export const createSelectionMessage = (name) => `Bạn đã chọn ${name}`;

export function createTechnicianCardsMarkup(technicians) {
  return technicians.map((technician) => {
    const reasons = getMatchReasons(technician).map((reason) => `<li>${reason}</li>`).join('');
    return `<article class="technician-card" data-technician-card="${technician.id}">
      <div class="technician-heading">
        <span class="technician-avatar" aria-hidden="true">${technician.initials}</span>
        <div><h3>${technician.name}</h3>${technician.verified ? '<span class="verified-badge">✓ Đã xác minh</span>' : ''}</div>
      </div>
      <p class="technician-description">${technician.shortDescription}</p>
      <div class="technician-facts">
        <span><strong>⭐ ${technician.rating}</strong> (${technician.reviewCount} đánh giá)</span>
        <span>${technician.distanceKm} km</span><span>Khoảng ${technician.estimatedArrivalMinutes} phút</span>
        <span>Từ <strong>${formatPrice(technician.priceFrom)}đ</strong></span>
        <span>${technician.completedJobs} việc đã hoàn thành</span>
        <span class="availability">● ${technician.availability}</span>
      </div>
      <div class="match-reasons"><strong>Vì sao HOME AI đề xuất thợ này?</strong><ul>${reasons}</ul></div>
      <div class="technician-actions">
        <button class="profile-button" type="button" data-view-profile="${technician.id}">Xem hồ sơ</button>
        <button class="choose-button" type="button" data-choose-technician="${technician.id}">Chọn thợ</button>
      </div>
    </article>`;
  }).join('');
}

export function createHomeAiMarkup() {
  const categories = serviceCategories.map((category) => `
    <button class="category-card" type="button" data-category="${category.id}" data-prompt="${category.prompt}" aria-pressed="false">
      <span class="category-icon category-icon--${category.id}">${icon(category.icon)}</span>
      <span>${category.label}</span>
    </button>`).join('');

  return `
    <div class="page-shell">
      <header class="topbar">
        <a class="brand" href="./" aria-label="HOME AI - Trang chủ">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M5 15.2 16 6l11 9.2v10.3H19v-7h-6v7H5V15.2Z"/><path d="m11.5 13.5 4.5-3.8 4.5 3.8"/></svg>
          </span>
          <span>HOME <strong>AI</strong></span>
        </a>
        <button class="location-pill" type="button" data-location>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
          <span data-location-label>Nha Trang, Khánh Hòa</span>
          <svg class="chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>
        </button>
      </header>

      <main>
        <section class="hero" aria-labelledby="home-title">
          <div class="trust-badge"><span>✓</span> Thợ uy tín gần bạn</div>
          <h1 id="home-title">Bạn cần sửa gì<br /><em>hôm nay?</em></h1>
          <p class="hero-copy">Mô tả vấn đề, HOME AI sẽ giúp bạn tìm đúng thợ chuyên nghiệp.</p>

          <form class="request-box" data-request-form>
            <label class="sr-only" for="service-request">Mô tả vấn đề của bạn</label>
            <textarea id="service-request" name="request" rows="3" placeholder="Ví dụ: Điều hòa không lạnh, vòi nước bị rò..." required></textarea>
            <div class="request-actions">
              <button class="attach-button" type="button" aria-label="Thêm hình ảnh">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h3l1.5-2h7L17 7h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/></svg>
              </button>
              <button class="start-button" type="submit">
                <span>Bắt đầu với AI</span>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
              </button>
            </div>
          </form>
          <p class="form-status" data-form-status aria-live="polite"></p>
          <section class="diagnostic-result" data-diagnostic-result hidden aria-live="polite">
            <div class="result-check" aria-hidden="true">✓</div>
            <div class="result-content">
              <p class="result-eyebrow">AI đã hiểu vấn đề của bạn</p>
              <dl>
                <div><dt>Vấn đề:</dt><dd data-result-summary></dd></div>
                <div><dt>Dịch vụ phù hợp:</dt><dd data-result-category></dd></div>
                <div><dt>Thợ được đề xuất:</dt><dd data-result-technician></dd></div>
              </dl>
              <p class="result-note">HOME AI đề xuất tìm một chuyên gia phù hợp với vấn đề này.</p>
              <div class="result-actions">
                <button class="find-button" type="button" data-find-technician>Tìm thợ phù hợp</button>
                <button class="edit-button" type="button" data-edit-description>Chỉnh sửa mô tả</button>
              </div>
            </div>
          </section>
          <section class="technician-results" data-technician-results hidden aria-live="polite">
            <div class="technician-results-heading">
              <div><p>THỢ PHÙ HỢP GẦN BẠN</p><h2>Đề xuất dành cho bạn</h2></div>
              <span>Nha Trang, Khánh Hòa</span>
            </div>
            <div class="technician-list" data-technician-list></div>
            <p class="selection-status" data-selection-status role="status"></p>
          </section>
        </section>

        <section class="services" aria-labelledby="services-title">
          <div class="section-heading">
            <div><p>DỊCH VỤ PHỔ BIẾN</p><h2 id="services-title">Bạn đang cần gì?</h2></div>
            <span>Chọn nhanh</span>
          </div>
          <div class="category-grid">${categories}</div>
        </section>

        <section class="confidence-card" aria-label="Cam kết dịch vụ">
          <div class="confidence-icon">${icon('bolt')}</div>
          <div><strong>Nhanh chóng &amp; an tâm</strong><span>Kết nối thợ phù hợp, báo giá minh bạch</span></div>
          <span class="rating">★ 4.9</span>
        </section>
      </main>

      <footer><span>Đã phục vụ hơn <strong>10.000+</strong> gia đình Việt</span></footer>
    </div>`;
}

export function initialiseHomePage(
  root,
  geolocation = globalThis.navigator?.geolocation,
  diagnostic = createMockDiagnostic(),
  technicianRepository = createMockTechnicianRepository(),
) {
  root.innerHTML = createHomeAiMarkup();
  const input = root.querySelector('#service-request');
  const status = root.querySelector('[data-form-status]');
  const resultCard = root.querySelector('[data-diagnostic-result]');
  const form = root.querySelector('[data-request-form]');
  let selectedCategory;
  let diagnosedCategory;
  let selectedTechnician;

  root.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.prompt;
      selectedCategory = button.dataset.category;
      input.focus();
      root.querySelectorAll('[data-prompt]').forEach((item) => {
        const isSelected = item === button;
        item.classList.toggle('is-selected', isSelected);
        item.setAttribute('aria-pressed', String(isSelected));
      });
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const description = input.value.trim();
    if (!description) return;

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    resultCard.hidden = true;
    status.textContent = 'AI đang phân tích vấn đề của bạn...';

    try {
      const diagnosis = await diagnostic.analyse({ description, preferredCategory: selectedCategory });
      const category = serviceCategories.find(({ id }) => id === diagnosis.categoryId) ?? serviceCategories[3];
      diagnosedCategory = category.id;
      root.querySelector('[data-result-summary]').textContent = diagnosis.summary;
      root.querySelector('[data-result-category]').textContent = category.label;
      root.querySelector('[data-result-technician]').textContent = category.technician;
      status.textContent = '';
      resultCard.hidden = false;
      resultCard.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch {
      status.textContent = 'Không thể phân tích lúc này. Vui lòng thử lại.';
    } finally {
      submitButton.disabled = false;
    }
  });

  root.querySelector('[data-edit-description]').addEventListener('click', () => {
    resultCard.hidden = true;
    input.focus();
  });

  root.querySelector('[data-find-technician]').addEventListener('click', async () => {
    const results = root.querySelector('[data-technician-results]');
    status.textContent = 'Đang tìm thợ phù hợp gần bạn...';
    results.hidden = true;
    const technicians = await technicianRepository.list({ location: defaultMvpLocation });
    const matches = findBestTechnicians(technicians, diagnosedCategory);
    root.querySelector('[data-technician-list]').innerHTML = createTechnicianCardsMarkup(matches);
    status.textContent = '';
    results.hidden = false;
    results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  root.querySelector('[data-technician-list]').addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-choose-technician]');
    if (!button) return;
    selectedTechnician = button.dataset.chooseTechnician;
    const card = button.closest('[data-technician-card]');
    const name = card.querySelector('h3').textContent;
    root.querySelector('[data-selection-status]').textContent = createSelectionMessage(name);
    root.querySelectorAll('[data-technician-card]').forEach((item) => item.classList.toggle('is-chosen', item === card));
    void selectedTechnician;
  });

  root.querySelector('[data-location]').addEventListener('click', () => {
    const label = root.querySelector('[data-location-label]');
    if (!geolocation) {
      label.textContent = 'Chọn vị trí';
      return;
    }
    label.textContent = 'Đang định vị...';
    geolocation.getCurrentPosition(
      () => { label.textContent = 'Vị trí hiện tại'; },
      () => { label.textContent = 'Chọn vị trí'; },
    );
  });
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#root');
  if (root) initialiseHomePage(root);
}
