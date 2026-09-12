import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createStringeeAccessToken, deriveStringeeUserId } from '../supabase/functions/_shared/stringee-token.js';
import { createIssueStringeeTokenHandler } from '../supabase/functions/_shared/stringee-token-handler.js';
import { createStringeeAnswerHandler } from '../supabase/functions/_shared/stringee-answer-handler.js';
import { createStringeeRequestSignature } from '../supabase/functions/_shared/stringee-signature.js';
import { createMissionCallRepository, createStringeeTokenProvider } from '../src/calls/mission-call-repository.js';
import { createStringeeAudioClient } from '../src/calls/stringee-client.js';

const authUserA = '59000000-0000-4000-8000-000000000001';
const authUserB = '59000000-0000-4000-8000-000000000002';
const identitySecret = 'synthetic-identity-secret-for-tests';
const apiSecret = 'synthetic-api-secret-for-tests';
const apiSid = 'synthetic-api-sid';

function queryReturning(value, error = null) {
  const query = {
    select() { return query; },
    eq() { return query; },
    async maybeSingle() { return { data: value, error }; },
  };
  return query;
}

function fakeEdgeClient({ user = null, profile = null, provider = null, missionCall = null } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'invalid' } }) },
    from(table) {
      return queryReturning({ profiles: profile, provider_profiles: provider, mission_calls: missionCall }[table] ?? null);
    },
  };
}

function edgeRequest(body = {}, authorization = 'Bearer synthetic-supabase-jwt') {
  return new Request('https://example.invalid/functions/v1/issue-stringee-token', {
    method: 'POST',
    headers: {
      Origin: 'https://ngpcao-spec.github.io',
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

const edgeEnvironment = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_ANON_KEY: 'synthetic-anon-key',
  STRINGEE_API_SID_KEY: apiSid,
  STRINGEE_API_SECRET_KEY: apiSecret,
  STRINGEE_SIGNING_SECRET_KEY: identitySecret,
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key-for-tests',
};

async function signedAnswerRequest({
  from,
  to,
  roomName = `call_${'3'.repeat(32)}`,
  signature = null,
} = {}) {
  const query = new URLSearchParams({
    from,
    to,
    fromInternal: 'true',
    userId: from,
    projectId: '1234',
    callId: 'call-vn-synthetic',
    custom: roomName,
  });
  const path = `/functions/v1/stringee-answer?${query}`;
  const validSignature = await createStringeeRequestSignature(path, identitySecret);
  return new Request(`https://synthetic.supabase.co${path}`, {
    headers: { 'X-STRINGEE-SIGNATURE': signature ?? validSignature },
  });
}

function answerHandlerFor(missionCall, logs = []) {
  return createStringeeAnswerHandler({
    createClient: () => ({ from: () => queryReturning(missionCall) }),
    getEnv: name => edgeEnvironment[name],
    logger: { info: value => logs.push(JSON.parse(value)) },
    now: () => 1_800_000_000_000,
  });
}

async function ringingAnswerFixture(overrides = {}) {
  const from = await deriveStringeeUserId(authUserA, identitySecret);
  const to = await deriveStringeeUserId(authUserB, identitySecret);
  return {
    from,
    to,
    missionCall: {
      id: '59000000-0000-4000-8000-000000000099',
      status: 'ringing',
      expires_at: '2027-01-15T09:01:00.000Z',
      caller_user_id: authUserA,
      callee_user_id: authUserB,
      mission: { status: 'accepted' },
      ...overrides,
    },
  };
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8'));
}

class Emitter {
  events = new Map();
  on(name, listener) { this.events.set(name, listener); return this; }
  emit(name, value) { this.events.get(name)?.(value); }
}

class FakeClient extends Emitter {
  static last;
  tokens = [];
  constructor() { super(); FakeClient.last = this; }
  connect(token) { this.tokens.push(token); }
  disconnect() { this.disconnected = true; }
}

class FakeCall extends Emitter {
  static made = [];
  constructor(client, from, to, video) {
    super(); Object.assign(this, { client, from, to, video, muted: false }); FakeCall.made.push(this);
  }
  makeCall(callback) { this.made = true; callback({ r: 0 }); }
  answer(callback) { this.answered = true; callback({ r: 0 }); this.emit('signalingstate', { code: 3 }); }
  reject(callback) { this.rejected = true; callback({ r: 0 }); this.emit('signalingstate', { code: 5 }); }
  hangup(callback) { this.ended = true; callback({ r: 0 }); this.emit('signalingstate', { code: 6 }); }
  mute(value) { this.muted = value; }
}

const sdk = { StringeeClient: FakeClient, StringeeCall: FakeCall };
const token = (role, userId = `ha_${'a'.repeat(28)}`, peerUserId = `ha_${'b'.repeat(28)}`) => ({
  accessToken: 'header.payload.signature', userId, peerUserId, participantRole: role, expiresAt: 2_000_000_000,
});

describe('Stringee App-to-App audio foundation', () => {
  it('creates stable opaque identities and a short Stringee HS256 client token', async () => {
    const userId = await deriveStringeeUserId(authUserA, identitySecret);
    assert.match(userId, /^ha_[0-9a-f]{28}$/);
    assert.equal(userId.length, 31, 'Stringee identities must stay below the gateway length limit');
    assert.equal(userId, await deriveStringeeUserId(authUserA, identitySecret));
    assert.notEqual(userId, await deriveStringeeUserId(authUserB, identitySecret));
    assert.doesNotMatch(userId, /59000000|@|\+84/);

    const issued = await createStringeeAccessToken({
      apiSid, apiSecret, stringeeUserId: userId, nowSeconds: 1_800_000_000,
      ttlSeconds: 900, nonce: 'syntheticnonce',
    });
    const [headerPart, payloadPart, signaturePart] = issued.accessToken.split('.');
    assert.deepEqual(decodePart(headerPart), { typ: 'JWT', alg: 'HS256', cty: 'stringee-api;v=1' });
    assert.deepEqual(decodePart(payloadPart), {
      jti: `${apiSid}_1800000000_syntheticnonce`, iss: apiSid,
      exp: 1_800_000_900, userId,
    });
    assert.ok(signaturePart.length > 20);
    assert.equal(issued.expiresAt, 1_800_000_900);
  });

  it('rejects the legacy 43-character identity that the live Stringee gateway refused', async () => {
    await assert.rejects(createStringeeAccessToken({
      apiSid, apiSecret, stringeeUserId: `ha_${'a'.repeat(40)}`,
    }), /INVALID_STRINGEE_USER_ID/);
    const provider = createStringeeTokenProvider({ functions: { invoke: async () => ({
      data: { accessToken: 'header.payload.signature', userId: `ha_${'a'.repeat(40)}`, expiresAt: 2_000_000_000 },
      error: null,
    }) } });
    await assert.rejects(provider.issue(), /Invalid Stringee token response/);
  });

  it('requires Supabase auth, validates HOME AI membership and exposes no Stringee secret', async () => {
    const entrySource = await readFile(new URL('../supabase/functions/issue-stringee-token/index.ts', import.meta.url), 'utf8');
    const source = await readFile(new URL('../supabase/functions/_shared/stringee-token-handler.js', import.meta.url), 'utf8');
    const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    assert.match(config, /\[functions\.issue-stringee-token\][\s\S]*verify_jwt = true/);
    assert.match(entrySource, /createIssueStringeeTokenHandler/);
    assert.match(source, /if \(!token\) return fail\(origin, 401, 'AUTH_REQUIRED'\)/);
    assert.match(source, /auth\.getUser\(token\)/);
    assert.match(source, /\['customer', 'provider'\]\.includes\(profile\.role\)/);
    assert.match(source, /provider\?\.active !== true/);
    assert.match(source, /from\('mission_calls'\)/);
    assert.match(source, /!\['ringing', 'active'\]\.includes\(missionCall\.status\)/);
    assert.match(source, /!isCaller && !isCallee/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|phone|email|display_name|cccd|nationality/i);
    assert.match(source, /event: 'authenticated_user'/);
    assert.match(source, /event: 'token_issued'/);
  });

  it('rejects missing JWT before creating a Supabase client', async () => {
    let clientsCreated = 0;
    const handler = createIssueStringeeTokenHandler({
      createClient: () => { clientsCreated += 1; return fakeEdgeClient(); },
      getEnv: name => edgeEnvironment[name],
    });
    const response = await handler(edgeRequest({}, ''));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'AUTH_REQUIRED' } });
    assert.equal(clientsCreated, 0);
  });

  it('issues only an authorized participant route and keeps logs metadata-only', async () => {
    const logs = [];
    const callId = '59000000-0000-4000-8000-000000000099';
    const handler = createIssueStringeeTokenHandler({
      createClient: () => fakeEdgeClient({
        user: { id: authUserA },
        profile: { role: 'customer', status: 'active' },
        missionCall: {
          id: callId,
          caller_user_id: authUserA,
          callee_user_id: authUserB,
          status: 'ringing',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
      getEnv: name => edgeEnvironment[name],
      logger: { info: value => logs.push(JSON.parse(value)) },
    });
    const response = await handler(edgeRequest({ missionCallId: callId }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.match(body.userId, /^ha_[0-9a-f]{28}$/);
    assert.match(body.peerUserId, /^ha_[0-9a-f]{28}$/);
    assert.notEqual(body.userId, body.peerUserId);
    assert.equal(body.participantRole, 'caller');
    assert.deepEqual(logs, [
      { component: 'issue-stringee-token', event: 'authenticated_user' },
      { component: 'issue-stringee-token', event: 'token_issued' },
    ]);
  });

  it('refuses a valid HOME AI user who is not a mission call participant', async () => {
    const callId = '59000000-0000-4000-8000-000000000099';
    const handler = createIssueStringeeTokenHandler({
      createClient: () => fakeEdgeClient({
        user: { id: authUserA },
        profile: { role: 'customer', status: 'active' },
        missionCall: {
          id: callId,
          caller_user_id: authUserB,
          callee_user_id: '59000000-0000-4000-8000-000000000003',
          status: 'ringing',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
      getEnv: name => edgeEnvironment[name],
      logger: { info() {} },
    });
    const response = await handler(edgeRequest({ missionCallId: callId }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'CALL_NOT_AUTHORIZED' } });
  });

  it('keeps every Stringee secret out of browser config, builds and GitHub Pages', async () => {
    const browserFiles = await Promise.all([
      readFile(new URL('../src/runtime-config.js', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'),
    ]);
    for (const source of browserFiles) {
      assert.doesNotMatch(source, /STRINGEE_(?:API_SID|API_SECRET|SIGNING_SECRET)_KEY/);
    }
  });

  it('uses mission_calls RPCs as the only browser mutation authority', async () => {
    const calls = [];
    const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'call-1' }, error: null }; } };
    const repository = createMissionCallRepository(client);
    await repository.start('mission-1');
    await repository.current('mission-1');
    await repository.answer('call-1');
    await repository.decline('call-1');
    await repository.end('call-1');
    assert.deepEqual(calls.map(item => item[0]), [
      'start_mission_call', 'get_current_mission_call', 'answer_mission_call',
      'decline_mission_call', 'end_mission_call',
    ]);
  });

  it('requests peer routing only after a mission call exists', async () => {
    const invocations = [];
    const provider = createStringeeTokenProvider({ functions: { invoke: async (name, options) => {
      invocations.push([name, options]); return { data: token('caller'), error: null };
    } } });
    const result = await provider.issue('59000000-0000-4000-8000-000000000099');
    assert.equal(result.participantRole, 'caller');
    assert.deepEqual(invocations, [['issue-stringee-token', { body: { missionCallId: '59000000-0000-4000-8000-000000000099' } }]]);
  });

  it('starts authorized audio only, maps ended once and never enables video', async () => {
    FakeCall.made.length = 0;
    const operations = [];
    const missionCall = { id: 'call-1', status: 'ringing', room_name: `call_${'1'.repeat(32)}` };
    const authority = {
      start: async id => { operations.push(`start:${id}`); return missionCall; },
      end: async id => { operations.push(`end:${id}`); return { ...missionCall, status: 'ended' }; },
      answer: async () => {}, decline: async () => {}, current: async () => missionCall,
    };
    const tokens = { issue: async id => id ? token('caller') : token(undefined) };
    const audio = createStringeeAudioClient({ sdk, missionCalls: authority, tokens });
    await audio.connect();
    await audio.startAudioCall('mission-1');
    const call = FakeCall.made.at(-1);
    assert.deepEqual(operations, ['start:mission-1']);
    assert.equal(call.video, false);
    assert.equal(call.custom, missionCall.room_name);
    assert.equal(call.made, true);
    call.emit('signalingstate', { code: 6 });
    call.emit('signalingstate', { code: 6 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(operations, ['start:mission-1', 'end:call-1']);
  });

  it('receives, answers, rejects, hangs up and mutes through idempotent mappings', async () => {
    const operations = [];
    const missionCall = { id: 'call-2', status: 'ringing', room_name: `call_${'2'.repeat(32)}` };
    const authority = {
      start: async () => missionCall,
      current: async id => { operations.push(`current:${id}`); return missionCall; },
      answer: async id => { operations.push(`answer:${id}`); return { ...missionCall, status: 'active' }; },
      decline: async id => { operations.push(`decline:${id}`); return { ...missionCall, status: 'declined' }; },
      end: async id => { operations.push(`end:${id}`); return { ...missionCall, status: 'ended' }; },
    };
    const self = `ha_${'b'.repeat(28)}`;
    const peer = `ha_${'a'.repeat(28)}`;
    const tokens = { issue: async id => id ? token('callee', self, peer) : token(undefined, self) };
    const audio = createStringeeAudioClient({ sdk, missionCalls: authority, tokens });
    await audio.connect();
    const incoming = new FakeCall(FakeClient.last, peer, self, false);
    incoming.fromNumber = peer;
    FakeClient.last.emit('incomingcall', incoming);
    await audio.answerIncoming('mission-2');
    audio.mute(true);
    assert.equal(incoming.answered, true);
    assert.equal(incoming.muted, true);
    assert.equal(operations.filter(item => item === 'answer:call-2').length, 1);
    await audio.hangup();
    assert.equal(operations.filter(item => item === 'end:call-2').length, 1);

    const second = new FakeCall(FakeClient.last, peer, self, false);
    second.fromNumber = peer;
    FakeClient.last.emit('incomingcall', second);
    await audio.rejectIncoming('mission-2');
    assert.equal(second.rejected, true);
    assert.equal(operations.filter(item => item === 'decline:call-2').length, 1);
  });

  it('renews an expired SDK connection token without exposing it to callbacks', async () => {
    let issued = 0;
    const tokens = { issue: async () => { issued += 1; return token(undefined); } };
    const authority = { start: async () => {}, current: async () => {}, answer: async () => {}, decline: async () => {}, end: async () => {} };
    const audio = createStringeeAudioClient({ sdk, missionCalls: authority, tokens });
    await audio.connect();
    FakeClient.last.emit('requestnewtoken');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(issued, 2);
    assert.equal(FakeClient.last.tokens.length, 2);
  });
});

describe('Stringee signed Answer URL', () => {
  it('verifies the public URI when Supabase forwards a rewritten worker path', async () => {
    const fixture = await ringingAnswerFixture();
    const publicRequest = await signedAnswerRequest(fixture);
    const workerUrl = publicRequest.url.replace('/functions/v1/stringee-answer', '/stringee-answer');
    const response = await answerHandlerFor(fixture.missionCall)(new Request(workerUrl, { headers: publicRequest.headers }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal((await response.json())[0].to.type, 'internal');
  });

  it('accepts an official HMAC-SHA1 signature and returns only App-to-App SCCO', async () => {
    const fixture = await ringingAnswerFixture();
    const logs = [];
    const response = await answerHandlerFor(fixture.missionCall, logs)(await signedAnswerRequest(fixture));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, [{
      action: 'connect',
      from: { type: 'internal', number: fixture.from, alias: fixture.from },
      to: { type: 'internal', number: fixture.to, alias: fixture.to },
    }]);
    assert.doesNotMatch(JSON.stringify(body), /external|record|phone|@|59000000/i);
    assert.deepEqual(logs, [{ component: 'stringee-answer', event: 'call_authorized' }]);
  });

  it('refuses an invalid or missing Stringee signature before querying Supabase', async () => {
    const fixture = await ringingAnswerFixture();
    let queried = false;
    const handler = createStringeeAnswerHandler({
      createClient: () => { queried = true; return { from: () => queryReturning(fixture.missionCall) }; },
      getEnv: name => edgeEnvironment[name],
    });
    const response = await handler(await signedAnswerRequest({ ...fixture, signature: 'invalid-signature' }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_STRINGEE_SIGNATURE' } });
    assert.equal(queried, false);
  });

  it('refuses an unknown mission_call route', async () => {
    const fixture = await ringingAnswerFixture();
    const response = await answerHandlerFor(null)(await signedAnswerRequest(fixture));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'CALL_NOT_AUTHORIZED' } });
  });

  it('refuses a caller or callee not derived from the mission participants', async () => {
    const fixture = await ringingAnswerFixture();
    const other = await deriveStringeeUserId('59000000-0000-4000-8000-000000000003', identitySecret);
    const response = await answerHandlerFor(fixture.missionCall)(await signedAnswerRequest({
      ...fixture,
      to: other,
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'CALL_PARTICIPANTS_MISMATCH' } });
  });

  it('refuses a mission_call that is no longer ringing', async () => {
    const fixture = await ringingAnswerFixture({ status: 'active' });
    const response = await answerHandlerFor(fixture.missionCall)(await signedAnswerRequest(fixture));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'CALL_NOT_RINGING' } });
  });

  it('refuses a ringing call after the mission became terminal', async () => {
    const fixture = await ringingAnswerFixture({ mission: { status: 'completed' } });
    const response = await answerHandlerFor(fixture.missionCall)(await signedAnswerRequest(fixture));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'CALL_NOT_RINGING' } });
  });

  it('rejects expired ringing calls and never logs request parameters', async () => {
    const fixture = await ringingAnswerFixture({ expires_at: '2027-01-15T07:59:59.000Z' });
    const logs = [];
    const response = await answerHandlerFor(fixture.missionCall, logs)(await signedAnswerRequest(fixture));
    assert.equal(response.status, 409);
    assert.deepEqual(logs, [{ component: 'stringee-answer', event: 'request_rejected',
      code: 'CALL_NOT_RINGING', signaturePresent: true, gatewayPathRewritten: false }]);
  });
});
