import { createClient } from 'npm:@supabase/supabase-js@2';
import { diagnosticSchema, validateDiagnostic, validateRequest } from '../_shared/diagnostic-contract.ts';
import { diagnosticInstructionsFast } from '../_shared/diagnostic-instructions-fast.js';
import { enforceIntakeCompleteness, requiresIntakeClarification } from '../_shared/intake-completeness.js';

const allowedOrigins = new Set(['https://ngpcao-spec.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const logStage = (event: string, details: Record<string, string | number> = {}) => {
  console.info(JSON.stringify({ component: 'diagnose-home-request', event, ...details }));
};

const response = (origin: string, status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...jsonHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
});
const failure = (origin: string, status: number, code: string) => response(origin, status, { error: { code } });

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== 'object') continue;
    for (const content of Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []) {
      if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
        parts.push((content as { text: string }).text);
      }
    }
  }
  if (!parts.length) throw new Error('AI_INVALID_RESPONSE');
  return parts.join('\n');
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? '';
  if (!allowedOrigins.has(origin)) return failure('null', 403, 'ORIGIN_FORBIDDEN');
  const cors = {
    ...jsonHeaders,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST' || !request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return failure(origin, 400, 'INVALID_REQUEST');
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return failure(origin, 401, 'AUTH_REQUIRED');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return failure(origin, 401, 'AUTH_REQUIRED');
  logStage('authenticated_post_received');

  let input;
  try { input = validateRequest(await request.json()); }
  catch { return failure(origin, 400, 'INVALID_INPUT'); }

  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!apiKey) return failure(origin, 503, 'AI_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const callOpenAi = async (requireQuestion: boolean) => {
      logStage('openai_request_started');
      const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gpt-5-mini',
          reasoning: { effort: 'minimal' },
          max_output_tokens: 400,
          store: false,
          instructions: diagnosticInstructionsFast,
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({
            initialProblem: input.description,
            clarificationHistory: input.clarifications,
            ...(requireQuestion ? { intakeRequirement: 'clarification_required' } : {}),
          }) }] }],
          text: { format: { type: 'json_schema', name: 'home_ai_diagnostic', strict: true, schema: diagnosticSchema } },
        }),
      });
      logStage('openai_response_received', { status: openAiResponse.status });
      if (!openAiResponse.ok) throw Object.assign(new Error('AI_REQUEST_FAILED'), { status: openAiResponse.status });
      const payload = await openAiResponse.json();
      if (payload.status === 'incomplete') {
        const reason = payload.incomplete_details?.reason === 'max_output_tokens' ? 'max_output_tokens' : 'other';
        logStage('openai_response_incomplete', { reason });
      }
      return validateDiagnostic(JSON.parse(extractOutputText(payload)));
    };
    const requiresQuestion = requiresIntakeClarification(input);
    let initialResult;
    try {
      initialResult = await callOpenAi(requiresQuestion);
    } catch (error) {
      if (!requiresQuestion || (error instanceof Error && 'status' in error)
          || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      logStage('invalid_response_retry');
      initialResult = await callOpenAi(true);
    }
    const result = await enforceIntakeCompleteness({
      input,
      diagnostic: initialResult,
      retry: () => callOpenAi(true),
    });
    logStage('json_validated');
    return response(origin, 200, result);
  } catch (error) {
    if (requiresIntakeClarification(input)) {
      logStage('clarification_question_unavailable');
      return failure(origin, 422, 'CLARIFICATION_REQUIRED');
    }
    if (error instanceof Error && 'code' in error && error.code === 'CLARIFICATION_REQUIRED') {
      logStage('clarification_question_missing');
      return failure(origin, 422, 'CLARIFICATION_REQUIRED');
    }
    if (error instanceof Error && 'status' in error) {
      if (error.status === 429) return failure(origin, 429, 'AI_RATE_LIMIT');
      if (typeof error.status === 'number' && error.status >= 500) return failure(origin, 503, 'AI_UNAVAILABLE');
      return failure(origin, 502, 'AI_REQUEST_FAILED');
    }
    if (error instanceof DOMException && error.name === 'AbortError') return failure(origin, 504, 'AI_TIMEOUT');
    return failure(origin, 502, 'AI_INVALID_RESPONSE');
  } finally {
    clearTimeout(timer);
  }
});
