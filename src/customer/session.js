export const customerSessionStorageKey = 'customerSession';
export const googleOAuthAttemptStorageKey = 'googleOAuthAttempt';
export const mockOtpCode = '123456';

const vietnameseMobilePattern = /^(3[2-9]|5[2689]|7[06-9]|8[1-689]|9[0-9])[0-9]{7}$/;

export function normalizeVietnamesePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const national = digits.startsWith('84')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  return vietnameseMobilePattern.test(national) ? `+84${national}` : null;
}

export function maskVietnamesePhone(phone) {
  const normalized = normalizeVietnamesePhone(phone);
  if (!normalized) return '';
  return `+84 ••• ••• ${normalized.slice(-3)}`;
}

export const isValidMockOtp = (value) => /^\d{6}$/.test(String(value ?? '')) && String(value) === mockOtpCode;

export function createMockCustomerSession(phone, createdAt = new Date().toISOString()) {
  const normalizedPhone = normalizeVietnamesePhone(phone);
  if (!normalizedPhone) return null;
  return Object.freeze({
    id: 'customer-demo-001',
    phone: normalizedPhone,
    kind: 'mock-customer-session',
    createdAt,
  });
}

export function readCustomerSession(storage) {
  try {
    const session = JSON.parse(storage?.getItem(customerSessionStorageKey) ?? 'null');
    if (session?.kind !== 'mock-customer-session' || !normalizeVietnamesePhone(session.phone)) return null;
    return Object.freeze({ ...session });
  } catch {
    return null;
  }
}

export function saveCustomerSession(storage, session) {
  if (!session || session.kind !== 'mock-customer-session') return false;
  try {
    storage?.setItem(customerSessionStorageKey, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearCustomerSession(storage) {
  try {
    storage?.removeItem(customerSessionStorageKey);
    return true;
  } catch {
    return false;
  }
}

export function markGoogleOAuthAttempt(storage) {
  try {
    storage?.setItem(googleOAuthAttemptStorageKey, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function clearGoogleOAuthAttempt(storage) {
  try {
    storage?.removeItem(googleOAuthAttemptStorageKey);
    return true;
  } catch {
    return false;
  }
}

export function resolveCustomerStartupSession(storage, oauthAuthenticated = false) {
  let oauthAttempted = false;
  try { oauthAttempted = Boolean(storage?.getItem(googleOAuthAttemptStorageKey)); } catch { /* Ignore unavailable storage. */ }

  if (oauthAuthenticated) {
    clearGoogleOAuthAttempt(storage);
    return Object.freeze({ authenticated: true, kind: 'supabase-google', oauthFailed: false });
  }
  if (oauthAttempted) {
    clearGoogleOAuthAttempt(storage);
    clearCustomerSession(storage);
    return Object.freeze({ authenticated: false, kind: null, oauthFailed: true });
  }
  const mockSession = readCustomerSession(storage);
  return Object.freeze({
    authenticated: Boolean(mockSession),
    kind: mockSession ? 'mock-phone' : null,
    oauthFailed: false,
  });
}
