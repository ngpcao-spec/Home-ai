const defaultCopy = Object.freeze({
  eyebrow: 'VỊ TRÍ CỦA BẠN', title: 'Cho phép HOME AI truy cập vị trí',
  reason: 'Vị trí chính xác giúp bạn nhận các nhiệm vụ phù hợp ở gần và tính quãng đường đến khách hàng.',
  allow: 'Cho phép vị trí', retry: 'Thử lại',
});

export function classifyGeolocationError(error) {
  if (error?.code === 1) return 'denied';
  if (error?.code === 2) return 'unavailable';
  return 'error';
}

export async function getLocationPermissionState({ geolocation = globalThis.navigator?.geolocation, permissions = globalThis.navigator?.permissions } = {}) {
  if (!geolocation?.getCurrentPosition) return 'unavailable';
  if (!permissions?.query) return 'prompt';
  try {
    const result = await permissions.query({ name: 'geolocation' });
    return ['granted', 'denied', 'prompt'].includes(result?.state) ? result.state : 'prompt';
  } catch { return 'prompt'; }
}

export function requestCurrentPosition(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation?.getCurrentPosition) return Promise.reject(Object.assign(new Error('Geolocation unavailable'), { code: 2 }));
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(
    ({ coords }) => resolve(Object.freeze({ latitude: coords.latitude, longitude: coords.longitude })), reject,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
  ));
}

export function renderLocationPermission(state = 'prompt', copy = defaultCopy) {
  const denied = state === 'denied'; const unavailable = state === 'unavailable'; const error = state === 'error'; const loading = state === 'requesting';
  const explanation = denied
    ? 'Quyền vị trí đang bị từ chối. Trên iPhone, mở Cài đặt → Safari → Vị trí, chọn Cho phép rồi quay lại và thử lại.'
    : unavailable ? 'Thiết bị hoặc trình duyệt chưa cung cấp vị trí. Hãy bật Dịch vụ định vị trong phần Cài đặt rồi thử lại.'
      : error ? 'Chưa thể xác định vị trí. Hãy kiểm tra GPS và kết nối, sau đó thử lại.' : copy.reason;
  return `<main class="location-permission" data-location-state="${state}"><div class="location-brand"><span>H</span><strong>HOME AI</strong></div><div class="location-pin" aria-hidden="true">⌖</div><p>${copy.eyebrow}</p><h1>${copy.title}</h1><p class="location-explanation">${explanation}</p><button type="button" data-request-location ${loading ? 'disabled' : ''}>${loading ? 'Đang xác định vị trí…' : (denied || unavailable || error) ? copy.retry : copy.allow}</button>${denied ? '<small>Safari chỉ hiển thị lại yêu cầu hệ thống sau khi quyền đã được thay đổi trong Cài đặt.</small>' : ''}</main>`;
}

export function mountLocationPermissionGate(root, { initialState = 'prompt', geolocation = globalThis.navigator?.geolocation, onGranted, copy = defaultCopy } = {}) {
  let state = initialState;
  const draw = () => { root.innerHTML = renderLocationPermission(state, copy); };
  const request = async () => {
    state = 'requesting'; draw();
    try { const position = await requestCurrentPosition(geolocation); await onGranted(position); state = 'granted'; return position; }
    catch (error) { state = classifyGeolocationError(error); draw(); return null; }
  };
  root.addEventListener('click', (event) => { if (event.target.closest?.('[data-request-location]')) void request(); });
  draw();
  return Object.freeze({ request, getState: () => state });
}

export const providerLocationPermissionCopy = defaultCopy;
