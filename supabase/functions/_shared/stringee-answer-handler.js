import { deriveStringeeUserId } from './stringee-token.js';
import { verifyStringeeRequestSignature } from './stringee-signature.js';

const opaqueIdentityPattern = /^ha_[0-9a-f]{28}$/;
const opaqueRoomPattern = /^call_[0-9a-f]{32}$/;
const callableMissionStatuses = new Set([
  'accepted', 'travelling', 'arrived', 'quote_pending', 'in_progress',
  'supplement_pending', 'completed_pending_payment',
]);
const responseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: responseHeaders });
const fail = (status, code) => json(status, { error: { code } });

function requestUri(request) {
  const url = new URL(request.url);
  // Supabase's gateway strips /functions/v1 before forwarding to the worker.
  // Stringee signs the public REQUEST_URI, not this internal runtime path.
  const path = url.pathname === '/stringee-answer'
    ? '/functions/v1/stringee-answer' : url.pathname;
  return `${path}${url.search}`.replace(/ /g, '%20');
}

function parseAnswerRequest(request) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const userId = url.searchParams.get('userId') ?? '';
  const custom = url.searchParams.get('custom') ?? '';
  const fromInternal = url.searchParams.get('fromInternal');
  if (fromInternal !== 'true' || !opaqueIdentityPattern.test(from) || !opaqueIdentityPattern.test(to)
      || userId !== from || !opaqueRoomPattern.test(custom)) {
    throw new Error('INVALID_ANSWER_REQUEST');
  }
  return { from, to, custom };
}

export function createStringeeAnswerHandler({ createClient, getEnv, logger = console, now = () => Date.now() }) {
  return async request => {
    const fail = (status, code) => {
      logger.info(JSON.stringify({ component: 'stringee-answer', event: 'request_rejected', code,
        signaturePresent: Boolean(request.headers.get('X-STRINGEE-SIGNATURE')),
        gatewayPathRewritten: new URL(request.url).pathname === '/stringee-answer' }));
      return json(status, { error: { code } });
    };
    if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED');

    const signingSecret = getEnv('STRINGEE_SIGNING_SECRET_KEY') ?? '';
    let signatureValid = false;
    try {
      signatureValid = await verifyStringeeRequestSignature({
        requestUri: requestUri(request),
        signature: request.headers.get('X-STRINGEE-SIGNATURE') ?? '',
        signingSecret,
      });
    } catch {
      return fail(503, 'STRINGEE_CONFIGURATION_ERROR');
    }
    if (!signatureValid) {
      return fail(403, 'INVALID_STRINGEE_SIGNATURE');
    }

    let input;
    try { input = parseAnswerRequest(request); }
    catch { return fail(400, 'INVALID_ANSWER_REQUEST'); }

    const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) return fail(503, 'STRINGEE_CONFIGURATION_ERROR');
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: missionCall, error } = await adminClient.from('mission_calls')
      .select('id,status,expires_at,caller_user_id,callee_user_id,mission:missions!inner(status)')
      .eq('room_name', input.custom).maybeSingle();
    const missionStatus = Array.isArray(missionCall?.mission) ? missionCall.mission[0]?.status : missionCall?.mission?.status;
    if (error) logger.info(JSON.stringify({ component: 'stringee-answer', event: 'lookup_failed',
      databaseCode: /^[A-Z0-9]{5,12}$/.test(error.code ?? '') ? error.code : 'UNKNOWN' }));
    if (error || !missionCall) return fail(403, 'CALL_NOT_AUTHORIZED');
    if (missionCall.status !== 'ringing' || new Date(missionCall.expires_at).getTime() <= now()
        || !callableMissionStatuses.has(missionStatus)) {
      return fail(409, 'CALL_NOT_RINGING');
    }

    let expectedCaller;
    let expectedCallee;
    try {
      expectedCaller = await deriveStringeeUserId(missionCall.caller_user_id, signingSecret);
      expectedCallee = await deriveStringeeUserId(missionCall.callee_user_id, signingSecret);
    } catch {
      return fail(503, 'STRINGEE_CONFIGURATION_ERROR');
    }
    if (input.from !== expectedCaller || input.to !== expectedCallee) {
      return fail(403, 'CALL_PARTICIPANTS_MISMATCH');
    }

    logger.info(JSON.stringify({ component: 'stringee-answer', event: 'call_authorized' }));
    return json(200, [{
      action: 'connect',
      from: { type: 'internal', number: expectedCaller, alias: expectedCaller },
      to: { type: 'internal', number: expectedCallee, alias: expectedCallee },
    }]);
  };
}
