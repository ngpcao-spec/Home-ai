import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { adaptAiDiagnostic, validateAiDiagnostic } from '../src/diagnostic/diagnostic-contract.js';
import { createSupabaseAiDiagnostic } from '../src/diagnostic/supabase-ai-diagnostic.js';
import { diagnosticInstructions } from '../supabase/functions/_shared/diagnostic-instructions.js';

const valid = {
  serviceCategory: 'electricity',
  understoodProblem: 'Hệ thống điện trong nhà gặp sự cố.',
  confidence: 0.92,
  missingQuestions: [{
    question: 'Sự cố bắt đầu khi nào?',
    suggestedAnswers: ['Hôm nay', 'Vài ngày trước', 'Hơn một tuần trước'],
    allowUnknown: true,
  }],
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
  assert.deepEqual(calls[0][1].body, { description: 'Nhà bị mất điện', preferredCategory: 'electricity', clarifications: [] });
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
  assert.throws(() => validateAiDiagnostic({ ...valid, missingQuestions: [{ ...valid.missingQuestions[0], suggestedAnswers: ['Một', 'Hai'] }] }), /Invalid AI diagnostic/);
  assert.throws(() => validateAiDiagnostic({ ...valid, missingQuestions: [valid.missingQuestions[0], valid.missingQuestions[0]] }), /Invalid AI diagnostic/);
});

it('prioritizes provider-useful clarification without a rigid category questionnaire', () => {
  assert.match(diagnosticInstructions, /not a technical diagnostician/i);
  assert.match(diagnosticInstructions, /single missing fact has the highest real value for the provider/i);
  for (const criterion of ['quantity', 'requested action', 'scope', 'duration', 'date or time', 'logistics', 'required equipment']) {
    assert.match(diagnosticInstructions, new RegExp(criterion, 'i'));
  }
  assert.match(diagnosticInstructions, /future services such as drivers, car rental, furniture repair, cleaning/i);
  assert.match(diagnosticInstructions, /Never apply a rigid category-specific questionnaire/i);
});

it('asks quantity first for multiple outlets and multiple bulbs', () => {
  assert.match(diagnosticInstructions, /Cần thay nhiều ổ cắm điện[\s\S]*Bao nhiêu ổ cắm cần thay\?/);
  assert.match(diagnosticInstructions, /Cần thay nhiều bóng đèn[\s\S]*Bao nhiêu bóng đèn cần thay\?/);
  assert.match(diagnosticInstructions, /“1”, “2”, “3”, “4 trở lên”/);
});

it('guides plumbing and air-conditioning questions toward useful work information', () => {
  assert.match(diagnosticInstructions, /For a plumbing request[\s\S]*requested work[\s\S]*quantity[\s\S]*scope\/symptom/);
  assert.match(diagnosticInstructions, /For an air-conditioning request[\s\S]*number\/type of units[\s\S]*observable symptom/);
});

it('never repeats supplied facts or invents location and detailed answer options', () => {
  assert.match(diagnosticInstructions, /Never ask again for information already present/i);
  assert.match(diagnosticInstructions, /without inventing facts or overly precise details/i);
  assert.match(diagnosticInstructions, /Do not ask which room each outlet is in/i);
  assert.doesNotMatch(diagnosticInstructions, /Phòng khách - tường bên phải|Phòng ngủ - cạnh giường/);
});

it('keeps Khác in the UI, allows Không biết when useful, and produces a provider summary', () => {
  assert.match(diagnosticInstructions, /Do not put “Khác” or “Không biết” in suggestedAnswers/);
  assert.match(diagnosticInstructions, /allowUnknown=true only when not knowing is a meaningful response/);
  assert.match(diagnosticInstructions, /vietnameseSummary is primarily for the provider/i);
  assert.match(diagnosticInstructions, /short, factual and actionable/i);
  assert.match(diagnosticInstructions, /Never invent quantity, fault, materials, price, duration, urgency, diagnosis, cause, repair, safety claim, location/);
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
  assert.match(source, /instructions: diagnosticInstructions/);
  assert.doesNotMatch(source, /logStage\([^\n]*(?:token|apiKey|description|userData)/);
  assert.match(source, /AbortController/);
  assert.match(source, /AI_TIMEOUT/);
  assert.match(contract, /additionalProperties: false/);
  assert.match(contract, /missingQuestions: \{[\s\S]*maxItems: 1/);
  assert.match(contract, /rawClarifications\.length > 3/);
  assert.match(source, /initialProblem: input\.description/);
  assert.match(source, /clarificationHistory: input\.clarifications/);
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
