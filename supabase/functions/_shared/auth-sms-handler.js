const SPEEDSMS_URL = 'https://api.speedsms.vn/index.php/sms/send';
const encoder = new TextEncoder();

export function mapVietnamPhoneForSpeedSms(phone) {
  if (typeof phone !== 'string' || !/^\+84[35789]\d{8}$/.test(phone)) {
    throw new Error('INVALID_PHONE');
  }
  return `0${phone.slice(3)}`;
}

function decodeBase64(value) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function webhookKey(secret) {
  const normalized = secret?.replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = normalized && decodeBase64(normalized);
  return key?.length >= 16 ? key : null;
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyStandardWebhook(headers, rawBody, secret, now = Date.now()) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  const keyBytes = webhookKey(secret);
  if (!id || id.includes('.') || !timestamp || !/^\d{10}$/.test(timestamp) || !signatures || !keyBytes) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > 300_000) return false;

  const key = await crypto.subtle.importKey('raw', keyBytes, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${rawBody}`)));
  return signatures.split(' ').some((entry) => {
    if (!entry.startsWith('v1,')) return false;
    return constantTimeEqual(expected, decodeBase64(entry.slice(3)));
  });
}

function safeProviderCode(value) {
  return typeof value === 'string' && /^\d{2,3}$/.test(value) ? value : undefined;
}

function safeTransactionId(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value)) ? value : undefined;
}

export function createSendAuthSmsHandler({getSecret, fetchImpl = fetch, log = console.warn, timeoutMs = 4000, now = () => Date.now()}) {
  return async function handleSendAuthSms(request) {
    if (request.method !== 'POST') return new Response('{}', {status: 405, headers: {allow: 'POST'}});

    const hookSecret = getSecret('SEND_SMS_HOOK_SECRET');
    const speedSmsToken = getSecret('SPEEDSMS_ACCESS_TOKEN');
    if (!hookSecret || !speedSmsToken) {
      log('send-auth-sms: configuration missing');
      return new Response('{}', {status: 503});
    }

    let rawBody;
    try {
      rawBody = await request.text();
      if (!await verifyStandardWebhook(request.headers, rawBody, hookSecret, now())) {
        return new Response('{}', {status: 401});
      }
    } catch {
      return new Response('{}', {status: 401});
    }

    let phone;
    let otp;
    try {
      const event = JSON.parse(rawBody);
      phone = mapVietnamPhoneForSpeedSms(event?.user?.phone);
      otp = event?.sms?.otp;
      if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) throw new Error('INVALID_OTP');
    } catch {
      log('send-auth-sms: invalid hook payload');
      return new Response('{}', {status: 400});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(SPEEDSMS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${btoa(`${speedSmsToken}:x`)}`,
        },
        body: JSON.stringify({
          to: [phone],
          content: `HOME AI: Ma xac nhan cua ban la ${otp}.`,
          sms_type: 4,
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      const code = safeProviderCode(result?.code);
      const tranId = safeTransactionId(result?.data?.tranId);
      if (!response.ok || result?.status !== 'success' || result?.code !== '00' ||
          result?.data?.invalidPhone?.length || !(Number(result?.data?.totalSMS) >= 1)) {
        log('send-auth-sms: provider rejected', {status: response.status, code, tranId});
        return new Response('{}', {status: 502});
      }
      return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}});
    } catch (error) {
      log('send-auth-sms: provider unavailable', {reason: controller.signal.aborted ? 'timeout' : 'network'});
      return new Response('{}', {status: 502});
    } finally {
      clearTimeout(timer);
    }
  };
}
