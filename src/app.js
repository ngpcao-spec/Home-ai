import { createMockDiagnostic } from './diagnostic/mock-diagnostic.js';
import { getMatchReasons, getRouteMatrixCandidates } from './technicians/matching.js';
import { createMockTechnicianRepository, defaultMvpLocation } from './technicians/repository.js';
import { createProviderProfile } from './technicians/provider-profile.js';
import { createProviderProfileMarkup } from './technicians/provider-profile-view.js';
import { createMapProvider } from './map/map-provider.js';
import { getClientLocation } from './location/client-location.js';
import { createRouteService } from './routing/routing-provider.js';
import { createMockProviderLocationSource } from './tracking/location-stream.js';
import { createTrackingRouteSession } from './tracking/route-session.js';
import { createInterventionQuote } from './mission/intervention-quote.js';
import { createCompletionSummaryMarkup, createPaidExternalMarkup, createProviderReviewMarkup } from './mission/completion-summary.js';
import {
  createCompletedMissionRecord,
  createMissionDetailMarkup,
  createMissionHistoryMarkup,
  getClientMissionHistory,
} from './mission/history.js';
import { createTrackingStageMarkup, updateInterventionQuotePresentation, updateTrackingPresentation } from './tracking/tracking-sheet.js';
import { createSearchPlan, getNextTechnician, prototypeSearchTiming, searchRadiiKm } from './search/map-search.js';
import { createNoTechnicianMarkup, createTechnicianSheetMarkup } from './search/technician-sheet.js';
import {
  addCustomerAddress,
  createCustomerProfile,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  updateCustomerAddress,
} from './customer/profile.js';
import { loadSupabaseCustomerProfile } from './customer/supabase-profile.js';
import { createCustomerProfileMarkup } from './customer/profile-view.js';
import { legalContent, supportFaqs } from './customer/support.js';
import { createLegalMarkup, createSupportMarkup } from './customer/support-view.js';
import {
  createLoginMarkup,
  createOnboardingMarkup,
  createSplashMarkup,
  isOnboardingCompleted,
  onboardingPages,
  saveOnboardingCompleted,
} from './onboarding/flow.js';
import {
  clearCustomerSession,
  createMockCustomerSession,
  isValidMockOtp,
  maskVietnamesePhone,
  normalizeVietnamesePhone,
  readCustomerSession,
  saveCustomerSession,
} from './customer/session.js';
import {
  advanceMission,
  confirmCompletion,
  createMissionState,
  completeMissionRepair,
  completeExternalPayment,
  decideRepairQuote,
  decideMissionSupplement,
  decideSupplement,
  getAcceptedSupplement,
  getMissionProgress,
  discoverMissionSupplement,
  markMissionArrived,
  missionStatuses,
  openProviderReview,
  prepareMissionDetail,
  requestSupplement,
  startMissionDiagnosis,
  submitReview,
} from './mission/tracker.js';

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
export const getEstimatedPriceRange = (priceFrom) => ({ from: priceFrom, to: priceFrom + 200000 });

export function createBookingTechnicianMarkup(technician) {
  const estimate = getEstimatedPriceRange(technician.priceFrom);
  return `<div class="booking-technician-heading">
    <span class="technician-avatar" aria-hidden="true">${technician.initials}</span>
    <div><h3>${technician.name}</h3><p>⭐ ${technician.rating} · ${technician.distanceKm} km</p></div>
  </div>
  <dl class="booking-technician-facts">
    <div><dt>Giá tham khảo</dt><dd>${formatPrice(estimate.from)}đ – ${formatPrice(estimate.to)}đ</dd></div>
    <div><dt>Khả dụng</dt><dd>${technician.availability}</dd></div>
  </dl>`;
}

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

export function createMissionMarkup() {
  return `<section class="mission-tracker" data-mission-tracker hidden aria-labelledby="mission-title">
    <div class="mission-heading"><div><p>THEO DÕI NHIỆM VỤ</p><h2 id="mission-title">Hành trình của thợ</h2></div><span data-mission-status-badge></span></div>
    <article class="mission-technician"><span class="technician-avatar" data-mission-initials></span><div><h3 data-mission-technician></h3><p>⭐ <span data-mission-rating></span></p></div></article>
    <dl class="mission-facts"><div><dt>Vấn đề</dt><dd data-mission-problem></dd></div><div><dt>Địa chỉ</dt><dd data-mission-address></dd></div><div><dt>Giá tham khảo</dt><dd data-mission-price></dd></div><div><dt>Dự kiến đến</dt><dd data-mission-arrival></dd></div></dl>
    <ol class="mission-timeline" data-mission-timeline>${missionStatuses.map((status, index) => `<li data-mission-step="${index}"><span>${index + 1}</span><strong>${status.label}</strong></li>`).join('')}</ol>
    <div class="mission-stage" data-mission-stage aria-live="polite"></div>
    <button class="demo-next" type="button" data-mission-next>Chuyển sang bước tiếp theo</button>
  </section>`;
}

export function createHomeAiMarkup() {
  const categories = serviceCategories.map((category) => `
    <button class="category-card" type="button" data-category="${category.id}" data-prompt="${category.prompt}" aria-pressed="false">
      <span class="category-icon category-icon--${category.id}">${icon(category.icon)}</span>
      <span>${category.label}</span>
    </button>`).join('');

  return `
    <div class="startup-flow" data-startup-flow>${createSplashMarkup()}</div>
    <div class="page-shell" data-app-shell hidden>
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
        <div data-app-view="home">
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
          <section class="map-search" data-map-search hidden aria-live="polite" aria-labelledby="map-search-title">
            <div class="map-search-heading"><div><p>TÌM THỢ QUANH BẠN</p><h2 id="map-search-title">Đang tìm thợ gần bạn...</h2></div><span data-search-radius>Bán kính 2 km</span></div>
            <div class="map-stage" data-map-stage></div>
            <div class="search-progress" data-search-progress role="status"><span class="search-spinner" aria-hidden="true"></span><strong data-search-message>Đang tìm thợ gần bạn...</strong><small data-search-stats>Đang kiểm tra trong bán kính 2 km</small></div>
            <div data-technician-sheet></div>
            <div data-provider-profile hidden></div>
          </section>
          <section class="booking-panel" data-booking-panel hidden aria-labelledby="booking-title">
            <div class="booking-title-row"><div><p>ĐẶT LỊCH SỬA CHỮA</p><h2 id="booking-title">Xác nhận yêu cầu</h2></div><button type="button" data-close-booking aria-label="Đóng đặt lịch">×</button></div>
            <div class="booking-technician" data-booking-technician></div>
            <p class="diagnosed-problem"><span>Vấn đề đã chẩn đoán</span><strong data-booking-problem></strong></p>
            <form data-booking-form>
              <fieldset><legend>Địa chỉ sửa chữa</legend><label class="sr-only" for="repair-address">Địa chỉ sửa chữa</label><input id="repair-address" name="address" value="Nha Trang, Khánh Hòa" required /><button class="location-button" type="button" data-use-current-location>Sử dụng vị trí hiện tại</button><p class="field-help" data-location-status></p></fieldset>
              <fieldset><legend>Bạn muốn thợ đến khi nào?</legend><div class="schedule-options"><label><input type="radio" name="schedule" value="asap" checked /> Càng sớm càng tốt</label><label><input type="radio" name="schedule" value="scheduled" /> Đặt lịch</label></div><div class="date-time-fields" data-date-time hidden><label>Ngày<input type="date" name="date" /></label><label>Giờ<input type="time" name="time" /></label></div></fieldset>
              <div class="price-estimate"><span>Giá dự kiến</span><strong data-booking-estimate></strong><p>Giá cuối cùng sẽ được xác nhận sau khi thợ kiểm tra.</p></div>
              <div class="booking-summary"><h3>Tóm tắt yêu cầu</h3><dl><div><dt>Vấn đề</dt><dd data-summary-problem></dd></div><div><dt>Dịch vụ</dt><dd data-summary-service></dd></div><div><dt>Thợ</dt><dd data-summary-technician></dd></div><div><dt>Địa chỉ</dt><dd data-summary-address></dd></div><div><dt>Thời gian</dt><dd data-summary-schedule></dd></div><div><dt>Ước tính</dt><dd data-summary-estimate></dd></div></dl></div>
              <button class="submit-booking" type="submit">Gửi yêu cầu</button><p class="booking-status" data-booking-status role="status" aria-live="polite"></p>
            </form>
          </section>
          <section class="booking-confirmation" data-booking-confirmation hidden aria-live="polite"><div class="confirmation-check">✓</div><p>YÊU CẦU ĐÃ ĐƯỢC XÁC NHẬN</p><h2>Thợ đã nhận yêu cầu!</h2><dl><div><dt>Thợ</dt><dd data-confirmation-technician></dd></div><div><dt>Thời gian dự kiến đến</dt><dd data-confirmation-arrival></dd></div><div><dt>Địa chỉ</dt><dd data-confirmation-address></dd></div><div><dt>Vấn đề</dt><dd data-confirmation-problem></dd></div><div><dt>Giá tham khảo</dt><dd data-confirmation-estimate></dd></div></dl><div class="confirmation-actions"><button type="button" data-track-technician>Theo dõi thợ</button><button type="button" data-cancel-request>Hủy yêu cầu</button></div><p data-confirmation-status role="status"></p></section>
          ${createMissionMarkup()}
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
        </div>

        <section class="history-view" data-app-view="history" hidden aria-label="Lịch sử interventions"></section>
        <section class="mission-detail-view" data-app-view="mission-detail" hidden aria-label="Chi tiết chuyến"></section>
        <section class="profile-view" data-app-view="profile" hidden aria-labelledby="profile-title"></section>
        <section class="support-view" data-app-view="support" hidden aria-labelledby="support-title"></section>
        <section class="legal-view" data-app-view="legal" hidden aria-labelledby="legal-title"></section>
      </main>

      <footer><span>Đã phục vụ hơn <strong>10.000+</strong> gia đình Việt</span></footer>
      <nav class="app-navigation" aria-label="Điều hướng chính">
        <button type="button" data-navigation="home" class="is-active" aria-current="page"><span aria-hidden="true">⌂</span>Accueil</button>
        <button type="button" data-navigation="history"><span aria-hidden="true">↻</span>Lịch sử</button>
        <button type="button" data-navigation="profile"><span aria-hidden="true">○</span>Hồ sơ</button>
      </nav>
    </div>`;
}

export function initialiseHomePage(
  root,
  geolocation = globalThis.navigator?.geolocation,
  diagnostic = createMockDiagnostic(),
  technicianRepository = createMockTechnicianRepository(),
  scheduleTask = globalThis.setTimeout,
  searchTiming = prototypeSearchTiming,
  mapProviderFactory = createMapProvider,
  routingProvider = createRouteService(),
  providerLocationSourceFactory = createMockProviderLocationSource,
  customerProfileLoader = loadSupabaseCustomerProfile,
) {
  root.innerHTML = createHomeAiMarkup();
  const startupFlow = root.querySelector('[data-startup-flow]');
  const appShell = root.querySelector('[data-app-shell]');
  let onboardingIndex = 0;
  let loginPhone = '';
  let openHomeView = () => {};
  let browserStorage;
  try { browserStorage = globalThis.localStorage; } catch { browserStorage = undefined; }
  const renderLogin = (options = {}) => {
    startupFlow.innerHTML = createLoginMarkup({ phone: loginPhone, ...options });
  };
  const showApplication = () => {
    startupFlow.hidden = true;
    appShell.hidden = false;
    openHomeView();
    root.querySelector('#service-request')?.focus();
  };
  const finishOnboarding = () => {
    saveOnboardingCompleted(browserStorage);
    renderLogin();
  };
  scheduleTask(() => {
    if (readCustomerSession(browserStorage)) showApplication();
    else {
      startupFlow.innerHTML = isOnboardingCompleted(browserStorage)
        ? createLoginMarkup()
        : createOnboardingMarkup(onboardingIndex);
    }
  }, 650);
  startupFlow.addEventListener('click', (event) => {
    if (event.target.closest('[data-skip-onboarding]')) {
      finishOnboarding();
      return;
    }
    if (event.target.closest('[data-onboarding-next]')) {
      if (onboardingIndex >= onboardingPages.length - 1) finishOnboarding();
      else {
        onboardingIndex += 1;
        startupFlow.innerHTML = createOnboardingMarkup(onboardingIndex);
      }
      return;
    }
    if (event.target.closest('[data-resend-otp]')) {
      renderLogin({ step: 'otp', phone: maskVietnamesePhone(loginPhone), resendMessage: 'Mã xác thực mới đã sẵn sàng.' });
    }
  });
  startupFlow.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.matches('[data-login-phone-form]')) {
      const normalized = normalizeVietnamesePhone(event.target.elements.phone.value);
      if (!normalized) {
        loginPhone = event.target.elements.phone.value;
        renderLogin({ error: 'Số điện thoại Việt Nam không hợp lệ.' });
        return;
      }
      loginPhone = normalized;
      renderLogin({ step: 'otp', phone: maskVietnamesePhone(loginPhone) });
      startupFlow.querySelector('[name="otp"]')?.focus();
      return;
    }
    if (event.target.matches('[data-login-otp-form]')) {
      if (!isValidMockOtp(event.target.elements.otp.value)) {
        renderLogin({ step: 'otp', phone: maskVietnamesePhone(loginPhone), error: 'Mã xác thực không đúng. Vui lòng thử lại.' });
        return;
      }
      const session = createMockCustomerSession(loginPhone);
      saveCustomerSession(browserStorage, session);
      showApplication();
    }
  });
  const input = root.querySelector('#service-request');
  const status = root.querySelector('[data-form-status]');
  const resultCard = root.querySelector('[data-diagnostic-result]');
  const form = root.querySelector('[data-request-form]');
  let selectedCategory;
  let diagnosedCategory;
  let selectedTechnician;
  let currentDiagnosis;
  let matchedTechnicians = [];
  let currentRadiusKm = 2;
  let mapProvider;
  let clientLocation;
  let stopLocationStream;
  let searchGeneration = 0;
  const mapProviderReady = Promise.resolve(mapProviderFactory()).then((provider) => { mapProvider = provider; return provider; });
  const renderMap = async (stage, state) => {
    const provider = await mapProviderReady;
    provider.setClientLocation(clientLocation);
    await provider.render(stage, { ...state, clientLocation });
  };
  let missionState = createMissionState();
  let customerProfile = createCustomerProfile();
  let addressFormOpen = false;
  let editingAddressId;
  let profileStatusMessage = '';
  let profileLoadState = 'idle';
  let profileLoadMessage = '';
  let profileLoadAttempt;
  let customerProfilePersistence;
  let persistedCustomerProfileExists = false;
  let personalFormOpen = false;
  let supportStatusMessage = '';
  let missionBookedAt;
  let trackingRoute;
  const trackingRoutes = createTrackingRouteSession(routingProvider);
  const getCurrentMissionRecord = () => createCompletedMissionRecord(missionState, {
    problem: currentDiagnosis?.summary ?? '',
    service: currentDiagnosis?.service ?? '',
    address: bookingForm?.elements.address.value ?? '',
    bookedAt: missionBookedAt,
    technician: selectedTechnician ?? {},
  });
  const getMissionHistory = () => getClientMissionHistory(getCurrentMissionRecord());
  const renderCustomerProfile = () => {
    root.querySelector('[data-app-view="profile"]').innerHTML = createCustomerProfileMarkup(customerProfile, {
      addressFormOpen,
      editingAddressId,
      statusMessage: profileStatusMessage,
      loadMessage: profileLoadMessage,
      canPersist: Boolean(customerProfilePersistence),
      personalFormOpen,
      canEditAddresses: !customerProfilePersistence || persistedCustomerProfileExists,
    });
  };
  const loadRealCustomerProfile = () => {
    if (profileLoadState === 'loading' || profileLoadState === 'loaded') return profileLoadAttempt;
    profileLoadState = 'loading';
    profileLoadMessage = 'Đang tải hồ sơ...';
    renderCustomerProfile();
    profileLoadAttempt = Promise.resolve(customerProfileLoader({ fallbackProfile: customerProfile }))
      .then((result) => {
        customerProfile = result.profile ?? customerProfile;
        customerProfilePersistence = result.persistence ?? null;
        persistedCustomerProfileExists = result.source === 'supabase';
        profileLoadState = result.source === 'supabase' ? 'loaded' : 'fallback';
        profileLoadMessage = result.reason === 'error'
          ? 'Không thể tải hồ sơ trực tuyến. Đang sử dụng hồ sơ mẫu.'
          : result.reason === 'no-profile'
            ? 'Hãy lưu thông tin để tạo hồ sơ Supabase của bạn.'
            : '';
      })
      .catch(() => {
        profileLoadState = 'fallback';
        profileLoadMessage = 'Không thể tải hồ sơ trực tuyến. Đang sử dụng hồ sơ mẫu.';
      })
      .finally(() => {
        if (!root.querySelector('[data-app-view="profile"]')?.hidden) renderCustomerProfile();
      });
    return profileLoadAttempt;
  };
  const showAppView = (view, missionId) => {
    if (view === 'history') root.querySelector('[data-app-view="history"]').innerHTML = createMissionHistoryMarkup(getMissionHistory());
    if (view === 'profile') {
      renderCustomerProfile();
      void loadRealCustomerProfile();
    }
    if (view === 'support') root.querySelector('[data-app-view="support"]').innerHTML = createSupportMarkup(supportFaqs, supportStatusMessage);
    if (view === 'legal') root.querySelector('[data-app-view="legal"]').innerHTML = createLegalMarkup(legalContent);
    if (view === 'mission-detail') {
      const selectedMission = getMissionHistory().find((item) => item.missionId === missionId);
      root.querySelector('[data-app-view="mission-detail"]').innerHTML = createMissionDetailMarkup(selectedMission);
    }
    root.querySelectorAll('[data-app-view]').forEach((section) => { section.hidden = section.dataset.appView !== view; });
    root.querySelectorAll('[data-navigation]').forEach((button) => {
      const activeView = view === 'mission-detail' ? 'history' : ['support', 'legal'].includes(view) ? 'profile' : view;
      const isActive = button.dataset.navigation === activeView;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
  };
  openHomeView = () => showAppView('home');

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
      currentDiagnosis = { ...diagnosis, service: category.label };
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
    const generation = ++searchGeneration;
    const scheduleSearchTask = (task, delay) => scheduleTask(() => { if (generation === searchGeneration) task(); }, delay);
    const search = root.querySelector('[data-map-search]');
    const stage = search.querySelector('[data-map-stage]');
    const sheet = search.querySelector('[data-technician-sheet]');
    search.hidden = false;
    sheet.innerHTML = '';
    search.querySelector('[data-search-progress]').hidden = false;
    search.querySelector('#map-search-title').textContent = 'Đang tìm thợ gần bạn...';
    status.textContent = '';
    clientLocation = await getClientLocation(geolocation);
    root.querySelector('[data-location-label]').textContent = clientLocation.source === 'browser' ? 'Vị trí hiện tại' : 'Đang dùng vị trí mặc định · Nha Trang';
    const technicians = await technicianRepository.list({ location: defaultMvpLocation });
    const routingCandidates = getRouteMatrixCandidates(technicians, diagnosedCategory);
    try {
      await renderMap(stage, { technicians: routingCandidates, radiusKm: 2, searching: true });
    } catch {
      stage.innerHTML = '<div class="map-error" role="alert"><strong>Không thể tải bản đồ Amazon Location</strong><span>Kiểm tra trạng thái HTTP và mã lỗi AWS trong console trình duyệt.</span></div>';
    }
    let routedTechnicians;
    try {
      routedTechnicians = routingCandidates.length ? await routingProvider.matrix(routingCandidates, clientLocation) : [];
    } catch {
      search.querySelector('[data-search-progress]').hidden = true;
      search.querySelector('#map-search-title').textContent = 'Không thể tính tuyến đường';
      sheet.innerHTML = '<article class="map-bottom-sheet map-empty"><h2>Kết nối định tuyến bị gián đoạn</h2><p>HOME AI không hiển thị ETA ước đoán. Vui lòng kiểm tra mạng và thử lại.</p><div class="sheet-actions"><button type="button" data-retry-search>Thử lại</button></div></article>';
      return;
    }
    const plan = createSearchPlan(routedTechnicians.filter(({ routeError }) => !routeError), diagnosedCategory);
    matchedTechnicians = plan.compatible;
    const progress = search.querySelector('[data-search-progress]');
    const message = search.querySelector('[data-search-message]');
    const stats = search.querySelector('[data-search-stats]');
    const techniciansInRadius = (radiusKm) => matchedTechnicians.filter(({ distanceKm }) => distanceKm <= radiusKm);
    const renderSearchingMap = (radiusKm, techniciansToShow, selectedId) => {
      currentRadiusKm = radiusKm;
      void renderMap(stage, { technicians: techniciansToShow, selectedId, radiusKm, searching: true });
      search.querySelector('[data-search-radius]').textContent = `Bán kính ${radiusKm} km`;
    };

    const renderPhase = ({ radiusKm, technicians: visibleTechnicians }) => {
      renderSearchingMap(radiusKm, visibleTechnicians);
      message.textContent = radiusKm === 2 ? 'Đang tìm thợ gần bạn...' : 'Đang mở rộng phạm vi tìm kiếm...';
      stats.textContent = `Đã tìm thấy ${visibleTechnicians.length} thợ phù hợp trong bán kính ${radiusKm} km`;
    };

    renderPhase(plan.phases[0] ?? { radiusKm: 2, technicians: [] });
    message.textContent = 'Đang tìm thợ gần bạn...';
    stats.textContent = 'Đang kiểm tra trong bán kính 2 km';

    if (plan.phases[1]) scheduleSearchTask(() => renderPhase(plan.phases[1]), searchTiming.expandTo5KmMs);
    if (plan.phases[2]) scheduleSearchTask(() => renderPhase(plan.phases[2]), searchTiming.expandTo10KmMs);

    scheduleSearchTask(() => {
      const finalPhase = plan.phases.at(-1) ?? { radiusKm: 10, technicians: [] };
      renderSearchingMap(finalPhase.radiusKm, finalPhase.technicians);
      message.textContent = 'HOME AI đang chọn thợ phù hợp nhất...';
      stats.textContent = `${finalPhase.technicians.length} thợ phù hợp đang được so sánh`;
      progress.classList.add('is-comparing');
    }, searchTiming.compareMs);

    scheduleSearchTask(() => {
      const finalRadiusKm = plan.phases.at(-1)?.radiusKm ?? 10;
      renderSearchingMap(finalRadiusKm, techniciansInRadius(finalRadiusKm), plan.selected?.id);
    }, searchTiming.highlightBestMs);

    scheduleSearchTask(() => {
      progress.classList.remove('is-comparing');
      progress.hidden = true;
      if (!plan.selected) {
        currentRadiusKm = plan.phases.at(-1)?.radiusKm ?? 5;
        void renderMap(stage, { radiusKm: currentRadiusKm, searching: false });
        search.querySelector('#map-search-title').textContent = 'Không tìm thấy thợ';
        sheet.innerHTML = createNoTechnicianMarkup();
        return;
      }
      selectedTechnician = plan.selected;
      void renderMap(stage, { technicians: techniciansInRadius(currentRadiusKm), selectedId: selectedTechnician.id, radiusKm: currentRadiusKm, searching: false });
      search.querySelector('#map-search-title').textContent = 'Đã tìm thấy thợ phù hợp';
      sheet.innerHTML = createTechnicianSheetMarkup(selectedTechnician);
    }, searchTiming.completeMs);
    search.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  const openBooking = async () => {
    const sheet = root.querySelector('[data-technician-sheet]');
    try {
      const route = await trackingRoutes.get(selectedTechnician, clientLocation);
      trackingRoute = route;
      await renderMap(root.querySelector('[data-map-stage]'), { technicians: matchedTechnicians, selectedId: selectedTechnician.id, radiusKm: currentRadiusKm, searching: false, route: route.points });
    } catch {
      sheet.insertAdjacentHTML('afterbegin', '<p class="route-error" role="alert">Không thể tải tuyến đường. Vui lòng thử lại trước khi chọn thợ.</p>');
      return;
    }
    const panel = root.querySelector('[data-booking-panel]');
    const estimate = getEstimatedPriceRange(selectedTechnician.priceFrom);
    const estimateLabel = `${formatPrice(estimate.from)}đ – ${formatPrice(estimate.to)}đ`;
    panel.querySelector('[data-booking-technician]').innerHTML = createBookingTechnicianMarkup(selectedTechnician);
    panel.querySelector('[data-booking-problem]').textContent = currentDiagnosis.summary;
    panel.querySelector('[data-booking-estimate]').textContent = estimateLabel;
    panel.querySelector('[data-summary-problem]').textContent = currentDiagnosis.summary;
    panel.querySelector('[data-summary-service]').textContent = currentDiagnosis.service;
    panel.querySelector('[data-summary-technician]').textContent = selectedTechnician.name;
    panel.querySelector('[data-summary-estimate]').textContent = estimateLabel;
    panel.querySelector('[data-summary-address]').textContent = panel.querySelector('[name="address"]').value;
    panel.querySelector('[data-summary-schedule]').textContent = 'Càng sớm càng tốt';
    panel.hidden = false;
    root.querySelector('[data-booking-confirmation]').hidden = true;
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  root.querySelector('[data-map-search]').addEventListener('click', (event) => {
    const profilePanel = root.querySelector('[data-provider-profile]');
    const technicianSheet = root.querySelector('[data-technician-sheet]');
    if (event.target.closest?.('[data-view-profile]')) {
      const technicianId = event.target.closest('[data-view-profile]').dataset.viewProfile;
      const technician = matchedTechnicians.find(({ id }) => id === technicianId) ?? selectedTechnician;
      if (technician) {
        selectedTechnician = technician;
        profilePanel.innerHTML = createProviderProfileMarkup(createProviderProfile(technician));
        profilePanel.hidden = false;
        technicianSheet.hidden = true;
        profilePanel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (event.target.closest?.('[data-close-provider-profile]')) {
      profilePanel.hidden = true;
      profilePanel.innerHTML = '';
      technicianSheet.hidden = false;
      technicianSheet.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (event.target.closest?.('[data-choose-profile-technician]')) {
      profilePanel.hidden = true;
      technicianSheet.hidden = false;
      void openBooking();
      return;
    }
    if (event.target.closest?.('[data-choose-map-technician]')) void openBooking();
    if (event.target.closest?.('[data-next-technician]')) {
      selectedTechnician = getNextTechnician(matchedTechnicians, selectedTechnician.id);
      currentRadiusKm = searchRadiiKm.find((radiusKm) => selectedTechnician.distanceKm <= radiusKm) ?? searchRadiiKm.at(-1);
      const visibleTechnicians = matchedTechnicians.filter(({ distanceKm }) => distanceKm <= currentRadiusKm);
      root.querySelector('[data-search-radius]').textContent = `Bán kính ${currentRadiusKm} km`;
      void renderMap(root.querySelector('[data-map-stage]'), { technicians: visibleTechnicians, selectedId: selectedTechnician.id, radiusKm: currentRadiusKm, searching: false });
      root.querySelector('[data-technician-sheet]').innerHTML = createTechnicianSheetMarkup(selectedTechnician);
    }
    if (event.target.closest?.('[data-map-technician]')) {
      selectedTechnician = matchedTechnicians.find(({ id }) => id === event.target.closest('[data-map-technician]').dataset.mapTechnician);
      void renderMap(root.querySelector('[data-map-stage]'), { technicians: matchedTechnicians, selectedId: selectedTechnician.id, radiusKm: currentRadiusKm, searching: false });
      root.querySelector('[data-technician-sheet]').innerHTML = createTechnicianSheetMarkup(selectedTechnician);
    }
    if (event.target.closest?.('[data-retry-search]')) root.querySelector('[data-find-technician]').click();
    if (event.target.closest?.('[data-book-later]')) {
      root.querySelector('[data-map-search]').hidden = true;
      input.focus();
    }
  });

  const bookingPanel = root.querySelector('[data-booking-panel]');
  const bookingForm = root.querySelector('[data-booking-form]');
  const updateSummary = () => {
    const scheduled = bookingForm.elements.schedule.value === 'scheduled';
    const date = bookingForm.elements.date.value;
    const time = bookingForm.elements.time.value;
    bookingPanel.querySelector('[data-summary-address]').textContent = bookingForm.elements.address.value || 'Chưa nhập địa chỉ';
    bookingPanel.querySelector('[data-summary-schedule]').textContent = scheduled ? (date && time ? `${date}, ${time}` : 'Chọn ngày và giờ') : 'Càng sớm càng tốt';
  };
  bookingForm.addEventListener('input', updateSummary);
  bookingForm.addEventListener('change', (event) => {
    if (event.target.name !== 'schedule') return;
    const scheduled = event.target.value === 'scheduled';
    bookingPanel.querySelector('[data-date-time]').hidden = !scheduled;
    bookingForm.elements.date.required = scheduled;
    bookingForm.elements.time.required = scheduled;
    updateSummary();
  });
  root.querySelector('[data-use-current-location]').addEventListener('click', () => {
    bookingForm.elements.address.value = 'Vị trí hiện tại, Nha Trang, Khánh Hòa';
    root.querySelector('[data-location-status]').textContent = 'Đã mô phỏng vị trí hiện tại.';
    updateSummary();
  });
  root.querySelector('[data-close-booking]').addEventListener('click', () => { bookingPanel.hidden = true; });
  bookingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = bookingForm.querySelector('[type="submit"]');
    submit.disabled = true;
    root.querySelector('[data-booking-status]').textContent = 'Đang gửi yêu cầu đến thợ...';
    scheduleTask(() => {
      missionBookedAt = new Date().toISOString();
      const confirmation = root.querySelector('[data-booking-confirmation]');
      const estimate = bookingPanel.querySelector('[data-booking-estimate]').textContent;
      confirmation.querySelector('[data-confirmation-technician]').textContent = selectedTechnician.name;
      confirmation.querySelector('[data-confirmation-arrival]').textContent = `Khoảng ${selectedTechnician.estimatedArrivalMinutes} phút`;
      confirmation.querySelector('[data-confirmation-address]').textContent = bookingForm.elements.address.value;
      confirmation.querySelector('[data-confirmation-problem]').textContent = currentDiagnosis.summary;
      confirmation.querySelector('[data-confirmation-estimate]').textContent = estimate;
      bookingPanel.hidden = true;
      confirmation.hidden = false;
      submit.disabled = false;
      root.querySelector('[data-booking-status]').textContent = '';
      confirmation.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 700);
  });
  const mission = root.querySelector('[data-mission-tracker]');
  const renderMissionProgress = () => {
    const status = missionStatuses[missionState.statusIndex];
    mission.querySelector('[data-mission-status-badge]').textContent = status.label;
    mission.querySelectorAll('[data-mission-step]').forEach((step, index) => {
      const progress = getMissionProgress(missionState)[index].progress;
      step.classList.toggle('is-active', progress === 'active');
      step.classList.toggle('is-done', progress === 'done');
    });
    return status;
  };
  const renderMission = () => {
    const status = renderMissionProgress();
    const stage = mission.querySelector('[data-mission-stage]');
    const completedMarkup = missionState.reviewStage === 'rating'
      ? createProviderReviewMarkup(selectedTechnician, missionState)
      : missionState.paymentStatus === 'paid_external'
        ? createPaidExternalMarkup(missionState.completion)
        : createCompletionSummaryMarkup(missionState.completion, missionState.quoteHistory);
    const stageMarkup = {
      accepted: '<h3>Thợ đã nhận yêu cầu</h3><p>Thợ đang chuẩn bị dụng cụ cho nhiệm vụ.</p>',
      travelling: createTrackingStageMarkup(selectedTechnician),
      arrived: createTrackingStageMarkup(selectedTechnician),
      in_progress: createTrackingStageMarkup(selectedTechnician),
      completed_pending_payment: completedMarkup,
    };
    stage.innerHTML = stageMarkup[status.id];
    if (status.id === 'in_progress' && missionState.quote) {
      mission.querySelector('[data-mission-status-badge]').textContent = updateInterventionQuotePresentation(stage, missionState);
    }
    mission.querySelector('[data-mission-next]').hidden = ['travelling', 'arrived', 'in_progress', 'completed_pending_payment'].includes(status.id);
  };
  const startTrackingMap = async () => {
    if (missionStatuses[missionState.statusIndex].id !== 'travelling') return;
    const stage = mission.querySelector('[data-mission-stage]');
    let trackingPhase = 'route';
    stopLocationStream?.();
    stopLocationStream = undefined;
    stage.querySelector('.tracking-route-error')?.remove();
    stage.querySelector('[data-retry-tracking]')?.remove();
    try {
      trackingRoute = await trackingRoutes.get(selectedTechnician, clientLocation);
      if (!trackingRoute?.points || trackingRoute.points.length < 2) throw new Error('CalculateRoutes returned no route geometry');
      const trackingMap = mission.querySelector('[data-tracking-map]');
      trackingPhase = 'map';
      await renderMap(trackingMap, { technicians: [selectedTechnician], selectedId: selectedTechnician.id, searching: false, route: trackingRoute.points });
      trackingPhase = 'location-source';
      const source = providerLocationSourceFactory({ providerId: selectedTechnician.id, route: trackingRoute.points, durationMinutes: trackingRoute.durationMinutes, totalDistanceKm: trackingRoute.distanceKm });
      stopLocationStream = source.subscribe((position) => {
        mapProvider.moveProvider(selectedTechnician.id, position);
        updateTrackingPresentation(stage, position);
        if (position.arrived && missionStatuses[missionState.statusIndex].id === 'travelling') {
          stopLocationStream?.();
          stopLocationStream = undefined;
          missionState = markMissionArrived(missionState);
          renderMissionProgress();
          mission.querySelector('[data-mission-next]').hidden = true;
        }
      });
    } catch (error) {
      console.error('[HOME AI][C13]', { phase: trackingPhase, errorType: error?.awsErrorCode ?? error?.name ?? 'Error' });
      stage.insertAdjacentHTML('beforeend', '<p class="route-error tracking-route-error" role="alert">Không thể tải hành trình của thợ. Vui lòng thử lại.</p><button type="button" data-retry-tracking>Thử lại</button>');
    }
  };
  root.querySelector('[data-track-technician]').addEventListener('click', () => {
    missionState = advanceMission(createMissionState());
    mission.querySelector('[data-mission-initials]').textContent = selectedTechnician.initials;
    mission.querySelector('[data-mission-technician]').textContent = selectedTechnician.name;
    mission.querySelector('[data-mission-rating]').textContent = selectedTechnician.rating;
    mission.querySelector('[data-mission-problem]').textContent = currentDiagnosis.summary;
    mission.querySelector('[data-mission-address]').textContent = bookingForm.elements.address.value;
    mission.querySelector('[data-mission-price]').textContent = bookingPanel.querySelector('[data-booking-estimate]').textContent;
    mission.querySelector('[data-mission-arrival]').textContent = `Khoảng ${selectedTechnician.estimatedArrivalMinutes} phút`;
    mission.hidden = false;
    root.querySelector('[data-booking-confirmation]').hidden = true;
    renderMission();
    mission.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    void startTrackingMap();
  });
  mission.addEventListener('click', (event) => {
    if (event.target.closest('[data-tracking-call]')) {
      mission.querySelector('[data-tracking-action-status]').textContent = 'Bản demo: cuộc gọi với thợ sẽ được mở tại đây.';
      return;
    }
    if (event.target.closest('[data-tracking-message]')) {
      mission.querySelector('[data-tracking-action-status]').textContent = 'Bản demo: cuộc trò chuyện với thợ sẽ được mở tại đây.';
      return;
    }
    if (event.target.closest('[data-retry-tracking]')) {
      trackingRoutes.reset();
      void startTrackingMap();
      return;
    }
    if (event.target.closest('[data-mission-next]')) missionState = advanceMission(missionState);
    if (event.target.closest('[data-start-repair]')) {
      missionState = startMissionDiagnosis(missionState, createInterventionQuote(currentDiagnosis, selectedTechnician));
      renderMissionProgress();
      mission.querySelector('[data-mission-status-badge]').textContent = updateInterventionQuotePresentation(mission.querySelector('[data-mission-stage]'), missionState);
      mission.querySelector('[data-mission-next]').hidden = true;
      return;
    }
    const quoteDecision = event.target.closest('[data-quote-decision]')?.dataset.quoteDecision;
    if (quoteDecision) {
      missionState = decideRepairQuote(missionState, quoteDecision);
      mission.querySelector('[data-mission-status-badge]').textContent = updateInterventionQuotePresentation(mission.querySelector('[data-mission-stage]'), missionState);
      return;
    }
    if (event.target.closest('[data-discover-supplement]')) {
      missionState = discoverMissionSupplement(missionState);
      updateInterventionQuotePresentation(mission.querySelector('[data-mission-stage]'), missionState);
      return;
    }
    const supplementDecision = event.target.closest('[data-supplement-quote-decision]')?.dataset.supplementQuoteDecision;
    if (supplementDecision) {
      missionState = decideMissionSupplement(missionState, supplementDecision);
      updateInterventionQuotePresentation(mission.querySelector('[data-mission-stage]'), missionState);
      return;
    }
    if (event.target.closest('[data-complete-repair]')) {
      missionState = completeMissionRepair(missionState, {
        missionId: `HOMEAI-${selectedTechnician.id}`,
        completedAt: new Date().toISOString(),
      });
      renderMission();
      return;
    }
    if (event.target.closest('[data-continue-payment]')) {
      missionState = completeExternalPayment(missionState, { paidAt: new Date().toISOString() });
      renderMission();
      scheduleTask(() => {
        missionState = openProviderReview(missionState);
        renderMission();
      }, 700);
      return;
    }
    if (event.target.closest('[data-request-extra]')) missionState = requestSupplement(missionState);
    const decision = event.target.closest('[data-extra-decision]')?.dataset.extraDecision;
    if (decision) missionState = decideSupplement(missionState, decision);
    if (event.target.closest('[data-confirm-completion]')) missionState = confirmCompletion(missionState);
    const rating = Number(event.target.closest('[data-rating]')?.dataset.rating);
    if (rating && !missionState.reviewSent) missionState = { ...missionState, rating, reviewComment: mission.querySelector('[data-review-comment]')?.value ?? missionState.reviewComment };
    if (event.target.closest('[data-send-review]')) missionState = submitReview(missionState, missionState.rating, mission.querySelector('[data-review-comment]')?.value);
    if (event.target.closest('[data-view-mission-detail]')) {
      missionState = prepareMissionDetail(missionState);
      renderMission();
      showAppView('mission-detail', missionState.completion.missionId);
      return;
    }
    renderMission();
    void startTrackingMap();
  });
  root.querySelector('[data-cancel-request]').addEventListener('click', () => { root.querySelector('[data-confirmation-status]').textContent = 'Yêu cầu đã được hủy.'; });

  root.querySelector('.app-navigation').addEventListener('click', (event) => {
    const destination = event.target.closest('[data-navigation]')?.dataset.navigation;
    if (destination) showAppView(destination);
  });
  root.querySelector('[data-app-view="history"]').addEventListener('click', (event) => {
    const missionId = event.target.closest('[data-open-mission]')?.dataset.openMission;
    if (missionId) showAppView('mission-detail', missionId);
  });
  root.querySelector('[data-app-view="mission-detail"]').addEventListener('click', (event) => {
    if (event.target.closest('[data-back-history]')) showAppView('history');
  });
  root.querySelector('[data-app-view="support"]').addEventListener('click', (event) => {
    if (event.target.closest('[data-back-profile]')) {
      showAppView('profile');
      return;
    }
    const action = event.target.closest('[data-mock-support]')?.dataset.mockSupport;
    if (action) {
      supportStatusMessage = action === 'call'
        ? 'Cuộc gọi hỗ trợ đã được mô phỏng. Không có cuộc gọi thật nào được thực hiện.'
        : 'Tin nhắn hỗ trợ đã được mô phỏng. Không có dữ liệu nào được gửi.';
      showAppView('support');
    }
  });
  root.querySelector('[data-app-view="legal"]').addEventListener('click', (event) => {
    if (event.target.closest('[data-back-profile]')) showAppView('profile');
  });
  const profileView = root.querySelector('[data-app-view="profile"]');
  const refreshPersistedCustomerProfile = async (message) => {
    profileStatusMessage = message;
    profileLoadState = 'idle';
    profileLoadMessage = '';
    await loadRealCustomerProfile();
  };
  const showProfilePersistenceError = () => {
    profileStatusMessage = 'Không thể lưu thay đổi. Vui lòng thử lại.';
    renderCustomerProfile();
  };
  profileView.addEventListener('click', async (event) => {
    if (event.target.closest('[data-profile-history]')) {
      showAppView('history');
      return;
    }
    if (event.target.closest('[data-add-address]')) {
      addressFormOpen = true;
      editingAddressId = undefined;
      profileStatusMessage = '';
      renderCustomerProfile();
      return;
    }
    if (event.target.closest('[data-edit-personal-profile]')) {
      personalFormOpen = true;
      profileStatusMessage = '';
      renderCustomerProfile();
      return;
    }
    if (event.target.closest('[data-cancel-profile-edit]')) {
      personalFormOpen = false;
      renderCustomerProfile();
      return;
    }
    const editId = event.target.closest('[data-edit-address]')?.dataset.editAddress;
    if (editId) {
      addressFormOpen = true;
      editingAddressId = editId;
      profileStatusMessage = '';
      renderCustomerProfile();
      return;
    }
    if (event.target.closest('[data-cancel-address]')) {
      addressFormOpen = false;
      editingAddressId = undefined;
      renderCustomerProfile();
      return;
    }
    const defaultId = event.target.closest('[data-default-address]')?.dataset.defaultAddress;
    if (defaultId) {
      if (customerProfilePersistence) {
        try {
          await customerProfilePersistence.addresses.setDefault(defaultId);
          await refreshPersistedCustomerProfile('Đã cập nhật địa chỉ mặc định.');
        } catch { showProfilePersistenceError(); }
        return;
      }
      customerProfile = setDefaultCustomerAddress(customerProfile, defaultId);
      profileStatusMessage = 'Đã cập nhật địa chỉ mặc định.';
      renderCustomerProfile();
      return;
    }
    const deleteId = event.target.closest('[data-delete-address]')?.dataset.deleteAddress;
    if (deleteId) {
      if (customerProfilePersistence) {
        try {
          await customerProfilePersistence.addresses.delete(deleteId);
          await refreshPersistedCustomerProfile('Đã xóa địa chỉ.');
        } catch { showProfilePersistenceError(); }
        return;
      }
      customerProfile = deleteCustomerAddress(customerProfile, deleteId);
      profileStatusMessage = 'Đã xóa địa chỉ.';
      renderCustomerProfile();
      return;
    }
    if (event.target.closest('[data-profile-help]')) {
      supportStatusMessage = '';
      showAppView('support');
      return;
    }
    if (event.target.closest('[data-profile-terms]')) {
      showAppView('legal');
      return;
    }
    if (event.target.closest('[data-profile-logout]')) {
      clearCustomerSession(browserStorage);
      saveOnboardingCompleted(browserStorage);
      loginPhone = '';
      appShell.hidden = true;
      startupFlow.hidden = false;
      renderLogin();
      return;
    }
  });
  profileView.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-profile-personal-form]')) {
      event.preventDefault();
      const phone = normalizeVietnamesePhone(event.target.elements.phone.value);
      if (!phone) {
        profileStatusMessage = 'Số điện thoại Việt Nam không hợp lệ.';
        renderCustomerProfile();
        return;
      }
      try {
        await customerProfilePersistence.profiles.saveCurrent({
          name: event.target.elements.name.value,
          phone,
          avatarUrl: event.target.elements.avatarUrl.value || null,
        });
        personalFormOpen = false;
        await refreshPersistedCustomerProfile('Đã lưu thông tin cá nhân.');
      } catch { showProfilePersistenceError(); }
      return;
    }
    if (!event.target.matches('[data-address-form]')) return;
    event.preventDefault();
    const address = {
      label: event.target.elements.label.value,
      address: event.target.elements.address.value,
      isDefault: event.target.elements.isDefault.checked,
    };
    if (customerProfilePersistence) {
      try {
        const wasEditing = Boolean(editingAddressId);
        await customerProfilePersistence.addresses.save({ id: editingAddressId ?? null, ...address });
        addressFormOpen = false;
        editingAddressId = undefined;
        await refreshPersistedCustomerProfile(wasEditing ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.');
      } catch { showProfilePersistenceError(); }
      return;
    }
    customerProfile = editingAddressId
      ? updateCustomerAddress(customerProfile, editingAddressId, address)
      : addCustomerAddress(customerProfile, address);
    profileStatusMessage = editingAddressId ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.';
    addressFormOpen = false;
    editingAddressId = undefined;
    renderCustomerProfile();
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
