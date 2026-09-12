import { createStringeeAccessToken, deriveStringeeUserId } from './stringee-token.js';

const allowedOrigins = new Set(['https://ngpcao-spec.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const respond = (origin, status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...jsonHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
});
const fail = (origin, status, code) => respond(origin, status, { error: { code } });

function parseBody(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT');
  if (Object.keys(value).some(key => key !== 'missionCallId')) throw new Error('INVALID_INPUT');
  if (value.missionCallId !== undefined && (typeof value.missionCallId !== 'string' || !uuidPattern.test(value.missionCallId))) {
    throw new Error('INVALID_INPUT');
  }
  return { missionCallId: value.missionCallId };
}

export function createIssueStringeeTokenHandler({ createClient, getEnv, logger = console }) {
  return async request => {
    const origin = request.headers.get('Origin') ?? '';
    if (!allowedOrigins.has(origin)) return fail('null', 403, 'ORIGIN_FORBIDDEN');
    const cors = {
      ...jsonHeaders,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || !request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      return fail(origin, 400, 'INVALID_REQUEST');
    }

    const authorization = request.headers.get('Authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) return fail(origin, 401, 'AUTH_REQUIRED');

    let input;
    try { input = parseBody(await request.json()); }
    catch { return fail(origin, 400, 'INVALID_INPUT'); }

    const authClient = createClient(getEnv('SUPABASE_URL') ?? '', getEnv('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return fail(origin, 401, 'AUTH_REQUIRED');

    const { data: profile, error: profileError } = await authClient.from('profiles')
      .select('role,status').eq('user_id', userData.user.id).maybeSingle();
    if (profileError || !profile || profile.status !== 'active' || !['customer', 'provider'].includes(profile.role)) {
      return fail(origin, 403, 'HOME_AI_USER_REQUIRED');
    }
    if (profile.role === 'provider') {
      const { data: provider, error: providerError } = await authClient.from('provider_profiles')
        .select('active').eq('provider_id', userData.user.id).maybeSingle();
      if (providerError || provider?.active !== true) return fail(origin, 403, 'HOME_AI_USER_REQUIRED');
    }
    logger.info(JSON.stringify({ component: 'issue-stringee-token', event: 'authenticated_user' }));

    try {
      const identitySecret = getEnv('STRINGEE_SIGNING_SECRET_KEY') ?? '';
      const userId = await deriveStringeeUserId(userData.user.id, identitySecret);
      let peerUserId;
      let participantRole;
      if (input.missionCallId) {
        const { data: missionCall, error: missionCallError } = await authClient.from('mission_calls')
          .select('id,caller_user_id,callee_user_id,status,expires_at')
          .eq('id', input.missionCallId).maybeSingle();
        if (missionCallError || !missionCall || !['ringing', 'active'].includes(missionCall.status)) {
          return fail(origin, 403, 'CALL_NOT_AUTHORIZED');
        }
        const isCaller = missionCall.caller_user_id === userData.user.id;
        const isCallee = missionCall.callee_user_id === userData.user.id;
        if (!isCaller && !isCallee) return fail(origin, 403, 'CALL_NOT_AUTHORIZED');
        if (missionCall.status === 'ringing' && new Date(missionCall.expires_at).getTime() <= Date.now()) {
          return fail(origin, 409, 'CALL_EXPIRED');
        }
        participantRole = isCaller ? 'caller' : 'callee';
        peerUserId = await deriveStringeeUserId(
          isCaller ? missionCall.callee_user_id : missionCall.caller_user_id,
          identitySecret,
        );
      }
      const issued = await createStringeeAccessToken({
        apiSid: getEnv('STRINGEE_API_SID_KEY') ?? '',
        apiSecret: getEnv('STRINGEE_API_SECRET_KEY') ?? '',
        stringeeUserId: userId,
      });
      logger.info(JSON.stringify({ component: 'issue-stringee-token', event: 'token_issued' }));
      return respond(origin, 200, {
        accessToken: issued.accessToken,
        userId,
        expiresAt: issued.expiresAt,
        ...(peerUserId ? { peerUserId, participantRole } : {}),
      });
    } catch {
      return fail(origin, 503, 'STRINGEE_CONFIGURATION_ERROR');
    }
  };
}
