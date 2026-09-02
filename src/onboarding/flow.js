export const onboardingStorageKey = 'onboardingCompleted';

export const onboardingPages = Object.freeze([
  Object.freeze({
    title: 'Mô tả vấn đề',
    description: 'AI hiểu nhu cầu của bạn.',
    icon: '✦',
  }),
  Object.freeze({
    title: 'Tìm đúng kỹ thuật viên',
    description: 'Tìm thợ phù hợp gần bạn.',
    icon: '⌖',
  }),
  Object.freeze({
    title: 'Theo dõi và hoàn thành',
    description: 'Theo dõi dịch vụ từ đầu đến cuối.',
    icon: '✓',
  }),
]);

const entryLogo = () => `<span class="entry-logo" aria-hidden="true">
  <svg viewBox="0 0 32 32"><path d="M5 15.2 16 6l11 9.2v10.3H19v-7h-6v7H5V15.2Z"/><path d="m11.5 13.5 4.5-3.8 4.5 3.8"/></svg>
</span><span class="entry-brand">HOME <strong>AI</strong></span>`;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function isOnboardingCompleted(storage) {
  try {
    return storage?.getItem(onboardingStorageKey) === 'true';
  } catch {
    return false;
  }
}

export function saveOnboardingCompleted(storage) {
  try {
    storage?.setItem(onboardingStorageKey, 'true');
    return true;
  } catch {
    return false;
  }
}

export function createSplashMarkup() {
  return `<section class="splash-screen" aria-label="HOME AI đang khởi động">
    <div class="entry-identity">${entryLogo()}</div>
    <p>Dịch vụ gia đình, thông minh hơn</p>
    <span class="splash-loader" aria-label="Đang tải"></span>
  </section>`;
}

export function createOnboardingMarkup(index) {
  const page = onboardingPages[index] ?? onboardingPages[0];
  const lastPage = index === onboardingPages.length - 1;
  const dots = onboardingPages.map((_item, dotIndex) => `<span class="${dotIndex === index ? 'is-active' : ''}" aria-hidden="true"></span>`).join('');
  return `<section class="onboarding-screen" aria-labelledby="onboarding-title">
    <header><div class="entry-identity entry-identity--small">${entryLogo()}</div><button type="button" data-skip-onboarding>Bỏ qua</button></header>
    <div class="onboarding-visual" aria-hidden="true"><span>${page.icon}</span><i></i><i></i></div>
    <div class="onboarding-copy"><p>BƯỚC ${index + 1} / ${onboardingPages.length}</p><h1 id="onboarding-title">${page.title}</h1><span>${page.description}</span></div>
    <div class="onboarding-dots">${dots}</div>
    <button class="onboarding-next" type="button" data-onboarding-next>${lastPage ? 'Bắt đầu' : 'Tiếp tục'}</button>
  </section>`;
}

export function createLoginMarkup({ step = 'phone', phone = '', error = '', resendMessage = '' } = {}) {
  const content = step === 'otp'
    ? `<p class="login-instruction">Nhập mã xác thực</p>
      <p class="masked-phone">Mã gồm 6 chữ số đã được tạo cho <strong>${phone}</strong></p>
      <form data-login-otp-form>
        <label class="sr-only" for="otp-code">Mã xác thực gồm 6 chữ số</label>
        <input id="otp-code" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" required>
        <button type="submit">Xác nhận</button>
      </form>
      <button class="resend-otp" type="button" data-resend-otp>Gửi lại mã</button>
      ${resendMessage ? `<p class="login-success" role="status">${resendMessage}</p>` : ''}`
    : `<h1 id="login-title">Chào mừng bạn</h1>
      <p class="login-instruction">Nhập số điện thoại để tiếp tục</p>
      <form data-login-phone-form>
        <label class="phone-field"><span>+84</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel-national" value="${escapeHtml(phone)}" placeholder="09•• ••• •••" aria-label="Số điện thoại" required></label>
        <button type="submit">Tiếp tục</button>
      </form>
      <div class="login-divider"><span>hoặc</span></div>
      <button class="google-login" type="button" data-google-login><strong>G</strong>Continuer avec Google</button>`;
  return `<section class="login-placeholder" aria-labelledby="login-title">
    <div class="entry-identity">${entryLogo()}</div>
    <p class="quote-eyebrow">C03 · TÀI KHOẢN KHÁCH HÀNG</p>
    ${step === 'otp' ? '<h1 id="login-title">Nhập mã xác thực</h1>' : ''}
    ${content}
    ${error ? `<p class="login-error" role="alert">${error}</p>` : ''}
    <small>Điện thoại dùng OTP thử nghiệm 123456 · Google dùng đăng nhập Supabase an toàn.</small>
  </section>`;
}
