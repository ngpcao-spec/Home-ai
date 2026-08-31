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

export function createLoginPlaceholderMarkup() {
  return `<section class="login-placeholder" aria-labelledby="login-title">
    <div class="entry-identity">${entryLogo()}</div>
    <p class="quote-eyebrow">C03 · TÀI KHOẢN KHÁCH HÀNG</p>
    <h1 id="login-title">Đăng nhập</h1>
    <p>Phiên bản thử nghiệm chưa yêu cầu tài khoản hoặc mã OTP.</p>
    <button type="button" data-enter-home>Tiếp tục vào HOME AI</button>
    <small>Không có dữ liệu đăng nhập nào được gửi hoặc lưu.</small>
  </section>`;
}
