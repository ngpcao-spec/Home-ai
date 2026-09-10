import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { adaptAiDiagnostic, validateAiDiagnostic } from '../src/diagnostic/diagnostic-contract.js';
import { createSupabaseAiDiagnostic } from '../src/diagnostic/supabase-ai-diagnostic.js';

const valid = {
  serviceCategory: 'electricity',
  understoodProblem: 'Hệ thống điện trong nhà gặp sự cố.',
  confidence: 0.92,
  missingQuestions: ['Sự cố bắt đầu khi nào?'],
  vietnameseSummary: 'Cần thợ điện kiểm tra hệ thống trong nhà.',
};

const client = invoke => ({ functions: { invoke } });
const fallback = { analyse: async ({ description, preferredCategory }) => ({ categoryId: preferredCategory ?? 'appliances', summary: description }) };

it('adapts the strict Edge Function contract to the existing C05 diagnostic model', async () => {
  const calls = [];
  const logs = [];
  const diagnostic = createSupabaseAiDiagnostic({
    client: client(async (...args) => { calls.push(args); return { data: valid, error: null }; }),
    getVerifiedUserId: () => 'customer-1', fallback, logger: event => logs.push(event),
  });
  const result = await diagnostic.analyse({ description: 'Nhà bị mất điện', preferredCategory: 'electricity' });
  assert.equal(result.categoryId, 'electricity');
  assert.equal(result.summary, valid.vietnameseSummary);
  assert.equal(result.source, 'openai');
  assert.deepEqual(calls[0][1].body, { description: 'Nhà bị mất điện', preferredCategory: 'electricity' });
  assert.ok(calls[0][1].signal);
  assert.deepEqual(logs, [
    { event: 'edge_function_call_started', functionName: 'diagnose-home-request' },
    { event: 'edge_function_response_received', functionName: 'diagnose-home-request' },
    { event: 'edge_function_response_validated', source: 'AI' },
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /Nhà bị mất điện|customer-1|access_token|OPENAI_API_KEY/);
});

it('rejects unknown fields, categories and malformed AI output', () => {
  assert.throws(() => validateAiDiagnostic({ ...valid, extra: true }), /Invalid AI diagnostic/);
  assert.throws(() => adaptAiDiagnostic({ ...valid, serviceCategory: 'roofing' }), /Invalid AI diagnostic/);
  assert.throws(() => validateAiDiagnostic({ ...valid, confidence: 2 }), /Invalid AI diagnostic/);
});

it('uses the technical fallback for network, 429, 5xx and invalid JSON responses', async () => {
  const failures = [
    () => { throw new TypeError('network'); },
    () => ({ data: null, error: { context: { status: 429 } } }),
    () => ({ data: null, error: { context: { status: 503 } } }),
    () => ({ data: { serviceCategory: 'invalid' }, error: null }),
  ];
  for (const invoke of failures) {
    const diagnostic = createSupabaseAiDiagnostic({ client: client(invoke), getVerifiedUserId: () => 'customer-1', fallback });
    const result = await diagnostic.analyse({ description: 'Test', preferredCategory: 'plumbing' });
    assert.equal(result.source, 'fallback');
    assert.equal(result.categoryId, 'plumbing');
  }
});

it('aborts a slow invocation and falls back after the configured timeout', async () => {
  const diagnostic = createSupabaseAiDiagnostic({
    client: client((_name, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })),
    getVerifiedUserId: () => 'customer-1', fallback, timeoutMs: 2,
  });
  const result = await diagnostic.analyse({ description: 'Test timeout', preferredCategory: 'appliances' });
  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackReason, 'AI_TIMEOUT');
});

it('never falls back for a missing or rejected Supabase authentication', async () => {
  let fallbackCalls = 0;
  const guardedFallback = { analyse: async () => { fallbackCalls++; return {}; } };
  const noSession = createSupabaseAiDiagnostic({ client: client(async () => assert.fail()), getVerifiedUserId: () => null, fallback: guardedFallback });
  await assert.rejects(noSession.analyse({ description: 'Test' }), { code: 'AUTH_REQUIRED' });
  const rejected = createSupabaseAiDiagnostic({
    client: client(async () => ({ data: null, error: { context: { status: 401 } } })),
    getVerifiedUserId: () => 'customer-1', fallback: guardedFallback,
  });
  await assert.rejects(rejected.analyse({ description: 'Test' }), { code: 'AUTH_REQUIRED' });
  assert.equal(fallbackCalls, 0);
});

it('keeps the Edge Function authenticated, secret-only and strictly validated', async () => {
  const source = await readFile(new URL('../supabase/functions/diagnose-home-request/index.ts', import.meta.url), 'utf8');
  const contract = await readFile(new URL('../supabase/functions/_shared/diagnostic-contract.ts', import.meta.url), 'utf8');
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /Deno\.env\.get\('OPENAI_API_KEY'\)/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /authenticated_post_received/);
  assert.match(source, /openai_response_received/);
  assert.match(source, /json_validated/);
  assert.match(source, /reasoning: \{ effort: 'minimal' \}/);
  assert.match(source, /max_output_tokens: 400/);
  assert.match(source, /store: false/);
  assert.doesNotMatch(source, /logStage\([^\n]*(?:token|apiKey|description|userData)/);
  assert.match(source, /AbortController/);
  assert.match(source, /AI_TIMEOUT/);
  assert.match(contract, /additionalProperties: false/);
  assert.match(contract, /required: \['serviceCategory', 'understoodProblem', 'confidence', 'missingQuestions', 'vietnameseSummary'\]/);
  assert.match(config, /\[functions\.diagnose-home-request\][\s\S]*verify_jwt = true/);
  for (const category of ['electricity', 'plumbing', 'air-conditioning', 'appliances']) assert.match(contract, new RegExp(`'${category}'`));
});

it('keeps OPTIONS open and completes an authenticated POST before the unchanged timeout', async () => {
  const source = await readFile(new URL('../supabase/functions/diagnose-home-request/index.ts', import.meta.url), 'utf8');
  assert.match(source, /request\.method === 'OPTIONS'[\s\S]*status: 204/);
  const authenticated = source.indexOf("logStage('authenticated_post_received')");
  const openAiStarted = source.indexOf("logStage('openai_request_started')");
  const validated = source.indexOf("logStage('json_validated')");
  const success = source.indexOf('return response(origin, 200, result)');
  assert.ok(authenticated > source.indexOf('auth.getUser(token)'));
  assert.ok(openAiStarted > authenticated);
  assert.ok(validated > openAiStarted);
  assert.ok(success > validated);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
});

it('never exposes OPENAI_API_KEY through browser runtime configuration or Pages', async () => {
  const files = await Promise.all([
    readFile(new URL('../src/runtime-config.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'),
  ]);
  files.forEach(source => assert.doesNotMatch(source, /OPENAI_API_KEY/));
});
