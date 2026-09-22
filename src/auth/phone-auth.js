const vietnamMobile = /^(3[2-9]|5[2689]|7[06-9]|8[1-689]|9[0-9])[0-9]{7}$/;

export function normalizeVietnamPhone(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:\+?84|0)?[\d\s.-]+$/.test(raw)) return null;
  const compact = raw.replace(/[\s.-]/g, '');
  const national = compact.startsWith('+84') ? compact.slice(3)
    : compact.startsWith('84') ? compact.slice(2)
      : compact.startsWith('0') ? compact.slice(1) : compact;
  return vietnamMobile.test(national) ? `+84${national}` : null;
}

export async function sendPhoneOtp(client, phone) {
  // TODO: Link a phone to an existing Google UUID only from that user's authenticated session.
  // A phone OTP login with a different auth.users.id must remain a separate account.
  const normalized = normalizeVietnamPhone(phone);
  if (!normalized) throw new Error('INVALID_PHONE');
  const { error } = await client.auth.signInWithOtp({ phone: normalized });
  if (error) throw error;
  return normalized;
}

export async function verifyPhoneOtp(client, phone, token) {
  const normalized = normalizeVietnamPhone(phone);
  if (!normalized || !/^\d{6}$/.test(String(token))) throw new Error('INVALID_OTP');
  const { data, error } = await client.auth.verifyOtp({ phone: normalized, token: String(token), type: 'sms' });
  if (error) throw error;
  if (!data?.session?.user?.id) throw new Error('INVALID_OTP');
  return data.session;
}

export function phoneOtpErrorMessage(error, stage = 'verify') {
  const code = String(error?.code ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  if (error?.message === 'INVALID_PHONE') return 'Số điện thoại không hợp lệ';
  if (/rate|too_many|over_request|429/.test(`${code} ${message}`) || error?.status === 429) return 'Vui lòng thử lại sau';
  if (/expir|otp_expired|token_expired/.test(`${code} ${message}`)) return 'Mã xác nhận đã hết hạn';
  if (stage === 'send') return 'Không thể gửi mã xác nhận. Vui lòng thử lại.';
  return 'Mã xác nhận không đúng';
}

export function createPhoneOtpCooldown(now = Date.now, durationMs = 60000) {
  let nextSendAt = 0;
  return Object.freeze({
    markSent() { nextSendAt = now() + durationMs; },
    secondsRemaining() { return Math.max(0, Math.ceil((nextSendAt - now()) / 1000)); },
  });
}
