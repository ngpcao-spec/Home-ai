const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeEqual(left, right) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function createStringeeRequestSignature(requestUri, signingSecret) {
  if (typeof requestUri !== 'string' || !requestUri.startsWith('/')) throw new Error('INVALID_REQUEST_URI');
  if (typeof signingSecret !== 'string' || signingSecret.trim().length < 16) throw new Error('SIGNING_SECRET_MISSING');
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(signingSecret.trim()), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  return toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(requestUri))));
}

export async function verifyStringeeRequestSignature({ requestUri, signature, signingSecret }) {
  if (typeof signature !== 'string' || !signature) return false;
  const expected = await createStringeeRequestSignature(requestUri, signingSecret);
  return safeEqual(expected, signature.trim());
}
