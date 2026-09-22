import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {createSendAuthSmsHandler, mapVietnamPhoneForSpeedSms, verifyStandardWebhook} from '../supabase/functions/_shared/auth-sms-handler.js';

const secretBytes = Buffer.from('home-ai-test-hook-secret-32-bytes!!');
const secrets = {
  SEND_SMS_HOOK_SECRET: `v1,whsec_${secretBytes.toString('base64')}`,
  SPEEDSMS_ACCESS_TOKEN: 'test-speed-sms-token',
};
const otp = '123456';
const phone = '+84912345678';
const body = JSON.stringify({user: {phone}, sms: {otp}});
const now = 1_790_000_000_000;
const timestamp = String(now / 1000);
const signature = (payload = body, time = timestamp) =>
  `v1,${createHmac('sha256', secretBytes).update(`msg_test.${time}.${payload}`).digest('base64')}`;
const signedRequest = (payload = body, options = {}) => new Request('https://example.test/send-auth-sms', {
  method: options.method ?? 'POST',
  headers: {
    'webhook-id': 'msg_test',
    'webhook-timestamp': options.timestamp ?? timestamp,
    'webhook-signature': options.signature ?? signature(payload, options.timestamp ?? timestamp),
  },
  body: options.method === 'GET' ? undefined : payload,
});
const success = () => new Response(JSON.stringify({status: 'success', code: '00', data: {tranId: 12345, totalSMS: 1, invalidPhone: []}}), {status: 200});
const fixture = (fetchImpl = async () => success()) => {
  const logs = [];
  const requests = [];
  const handler = createSendAuthSmsHandler({
    getSecret: (name) => secrets[name],
    fetchImpl: async (...args) => {
      requests.push(args);
      return fetchImpl(...args);
    },
    log: (...args) => logs.push(args),
    now: () => now,
    timeoutMs: 10,
  });
  return {handler, logs, requests};
};

test('Vietnam E.164 maps to SpeedSMS domestic format only', () => {
  assert.equal(mapVietnamPhoneForSpeedSms(phone), '0912345678');
  for (const invalid of ['0912345678', '+841234', '+33123456789', '+8491234567', '+849123456789']) {
    assert.throws(() => mapVietnamPhoneForSpeedSms(invalid));
  }
});

test('only POST is accepted and never sends SMS for GET', async () => {
  const {handler, requests} = fixture();
  assert.equal((await handler(signedRequest(body, {method: 'GET'}))).status, 405);
  assert.equal(requests.length, 0);
});

test('Standard Webhooks signature validates raw payload and rejects tampering, missing and stale signatures', async () => {
  assert.equal(await verifyStandardWebhook(signedRequest().headers, body, secrets.SEND_SMS_HOOK_SECRET, now), true);
  const {handler, requests} = fixture();
  assert.equal((await handler(signedRequest(body, {signature: 'v1,invalid'}))).status, 401);
  assert.equal((await handler(new Request('https://example.test/send-auth-sms', {method: 'POST', body}))).status, 401);
  assert.equal((await handler(signedRequest(body.replace(phone, '+84987654321'), {signature: signature(body)}))).status, 401);
  assert.equal((await handler(signedRequest(body, {timestamp: String(now / 1000 - 301)}))).status, 401);
  assert.equal(requests.length, 0);
});

test('valid hook sends exactly one generic SpeedSMS message with Notify type 4', async () => {
  const {handler, requests, logs} = fixture();
  const response = await handler(signedRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{}');
  assert.equal(requests.length, 1);
  const [url, options] = requests[0];
  assert.equal(url, 'https://api.speedsms.vn/index.php/sms/send');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, `Basic ${Buffer.from('test-speed-sms-token:x').toString('base64')}`);
  assert.deepEqual(JSON.parse(options.body), {
    to: ['0912345678'],
    content: 'HOME AI: Ma xac nhan cua ban la 123456.',
    sms_type: 4,
  });
  assert.equal(logs.length, 0);
});

test('invalid phone or OTP is rejected after signature verification', async () => {
  const {handler, requests} = fixture();
  for (const payload of [
    JSON.stringify({user: {phone: '+33123456789'}, sms: {otp}}),
    JSON.stringify({user: {phone}, sms: {otp: '123'}}),
  ]) {
    assert.equal((await handler(signedRequest(payload))).status, 400);
  }
  assert.equal(requests.length, 0);
});

test('SpeedSMS error, invalid number and HTTP failure are sanitized', async () => {
  const responses = [
    new Response(JSON.stringify({status: 'error', code: '300', message: `secret ${otp} ${phone}`}), {status: 200}),
    new Response(JSON.stringify({status: 'success', code: '00', data: {totalSMS: 0, invalidPhone: ['0912345678']}}), {status: 200}),
    new Response('server error', {status: 503}),
  ];
  for (const speedSmsResponse of responses) {
    const {handler, logs} = fixture(async () => speedSmsResponse);
    const response = await handler(signedRequest());
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '{}');
    assert.doesNotMatch(JSON.stringify(logs), /123456|0912345678|\+84912345678|test-speed-sms-token|secret/);
  }
});

test('SpeedSMS timeout returns sanitized failure without retry', async () => {
  const {handler, requests, logs} = fixture((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(`secret ${otp} ${phone}`)));
  }));
  const response = await handler(signedRequest());
  assert.equal(response.status, 502);
  assert.equal(requests.length, 1);
  assert.deepEqual(logs, [['send-auth-sms: provider unavailable', {reason: 'timeout'}]]);
});
