const encoder = new TextEncoder();

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function requireSecret(value, name) {
  if (typeof value !== 'string' || value.trim().length < 16) throw new Error(`${name}_MISSING`);
  return value.trim();
}

export async function deriveStringeeUserId(authUserId, identitySecret) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authUserId ?? '')) {
    throw new Error('INVALID_AUTH_USER_ID');
  }
  const digest = await sign(`home-ai:stringee-user:v1:${authUserId.toLowerCase()}`, requireSecret(identitySecret, 'STRINGEE_IDENTITY_SECRET'));
  // Keep the opaque identity within 32 characters: the live Stringee gateway
  // rejects the previous 43-character identity with USER_ID_TOO_LONG.
  return `ha_${Array.from(digest.slice(0, 14), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function createStringeeAccessToken({
  apiSid,
  apiSecret,
  stringeeUserId,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = 900,
  nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 16),
}) {
  const sid = requireSecret(apiSid, 'STRINGEE_API_SID_KEY');
  const secret = requireSecret(apiSecret, 'STRINGEE_API_SECRET_KEY');
  if (!/^ha_[0-9a-f]{28}$/.test(stringeeUserId ?? '')) throw new Error('INVALID_STRINGEE_USER_ID');
  if (!Number.isInteger(nowSeconds) || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error('INVALID_TOKEN_LIFETIME');
  }
  const header = { typ: 'JWT', alg: 'HS256', cty: 'stringee-api;v=1' };
  const payload = {
    jti: `${sid}_${nowSeconds}_${String(nonce).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}`,
    iss: sid,
    exp: nowSeconds + ttlSeconds,
    userId: stringeeUserId,
  };
  const encodedHeader = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = encodeBase64Url(await sign(unsigned, secret));
  return { accessToken: `${unsigned}.${signature}`, expiresAt: payload.exp };
}
