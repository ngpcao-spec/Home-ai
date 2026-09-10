import { createClient } from 'npm:@supabase/supabase-js@2';
import { providerActivitySchema, validateProviderActivity, validateProviderActivityRequest } from '../_shared/provider-activity-contract.ts';
import { providerActivityInstructions } from '../_shared/provider-activity-instructions.js';

const allowedOrigins = new Set(['https://ngpcao-spec.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (origin: string, status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...jsonHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
});
const fail = (origin: string, status: number, code: string) => respond(origin, status, { error: { code } });
const logStage = (event: string, details: Record<string, string | number> = {}) => {
  console.info(JSON.stringify({ component: 'classify-provider-activity', event, ...details }));
};

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown[] }).content;
    for (const part of Array.isArray(content) ? content : []) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        parts.push((part as { text: string }).text);
      }
    }
  }
  if (!parts.length) throw new Error('AI_INVALID_RESPONSE');
  return parts.join('\n');
}

Deno.serve(async request => {
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
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return fail(origin, 401, 'AUTH_REQUIRED');
  const { data: profile, error: profileError } = await authClient.from('profiles')
    .select('role,status').eq('user_id', userData.user.id).maybeSingle();
  if (profileError || profile?.role !== 'provider' || profile.status !== 'active') {
    return fail(origin, 403, 'PROVIDER_REQUIRED');
  }
  logStage('authenticated_provider_post_received');

  let input;
  try { input = validateProviderActivityRequest(await request.json()); }
  catch { return fail(origin, 400, 'INVALID_INPUT'); }

  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!apiKey) return fail(origin, 503, 'AI_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    logStage('openai_request_started');
    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini',
        reasoning: { effort: 'minimal' },
        max_output_tokens: 300,
        store: false,
        instructions: providerActivityInstructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        text: { format: { type: 'json_schema', name: 'provider_activity', strict: true, schema: providerActivitySchema } },
      }),
    });
    logStage('openai_response_received', { status: openAiResponse.status });
    if (openAiResponse.status === 429) return fail(origin, 429, 'AI_RATE_LIMIT');
    if (openAiResponse.status >= 500) return fail(origin, 503, 'AI_UNAVAILABLE');
    if (!openAiResponse.ok) return fail(origin, 502, 'AI_REQUEST_FAILED');
    const result = validateProviderActivity(JSON.parse(extractOutputText(await openAiResponse.json())));
    logStage('json_validated');
    return respond(origin, 200, result);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return fail(origin, 504, 'AI_TIMEOUT');
    return fail(origin, 502, 'AI_INVALID_RESPONSE');
  } finally {
    clearTimeout(timer);
  }
});
