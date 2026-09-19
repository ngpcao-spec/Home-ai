import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createAiIntakeTiming } from '../src/diagnostic/ai-intake-timing.js';
import { createSupabaseAiDiagnostic } from '../src/diagnostic/supabase-ai-diagnostic.js';
import { diagnosticInstructions } from '../supabase/functions/_shared/diagnostic-instructions.js';
import { diagnosticInstructionsFast } from '../supabase/functions/_shared/diagnostic-instructions-fast.js';

it('uses the FAST production prompt while preserving the model, contract and safety rules', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../supabase/functions/diagnose-home-request/index.ts', import.meta.url), 'utf8');
  assert.match(source, /instructions: diagnosticInstructionsFast/);
  assert.match(source, /model: 'gpt-5-mini'/);
  assert.match(source, /max_output_tokens: 400/);
  assert.ok(diagnosticInstructionsFast.length < diagnosticInstructions.length * 0.6);
  for (const term of ['serviceCategory', 'missingQuestions', 'suggestedAnswers', 'allowUnknown',
    'understoodProblem', 'vietnameseSummary', 'confidence', 'quantity', 'scope', 'Vietnamese', 'provider',
    'Khác', 'Không biết', 'technical cause', 'budget', 'price', 'Never invent']) {
    assert.match(diagnosticInstructionsFast, new RegExp(term, 'i'));
  }
  assert.match(diagnosticInstructionsFast, /short natural Vietnamese suitable for a phone screen/i);
  assert.match(diagnosticInstructionsFast, /ask only the question/i);
});

it('records only opt-in timing stages and never includes request contents', async () => {
  let clock = 100;
  const events = [];
  const timing = createAiIntakeTiming({ enabled: true, now: () => clock, logger: event => events.push(event) });
  const runId = timing.start();
  const diagnostic = createSupabaseAiDiagnostic({
    client: { functions: { invoke: async () => {
      clock = 145;
      return { data: {
        serviceCategory: 'electricity', understoodProblem: 'Ổ cắm hỏng', confidence: 0.8,
        missingQuestions: [{ question: 'Có bao nhiêu ổ cắm?', suggestedAnswers: ['1', '2', '3'], allowUnknown: false }],
        vietnameseSummary: 'Ổ cắm hỏng',
      }, error: null };
    } } },
    getVerifiedUserId: () => 'private-user-id',
    logger: () => {}, timing,
  });
  await diagnostic.analyse({ description: 'private problem text' });
  clock = 150;
  timing.firstQuestionRendered(runId);
  timing.firstQuestionRendered(runId);
  assert.deepEqual(events, [
    { stage: 'click', elapsedMs: 0 },
    { stage: 'request_sent', elapsedMs: 0 },
    { stage: 'response_received', elapsedMs: 45 },
    { stage: 'first_question_rendered', elapsedMs: 50 },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private problem text|private-user-id|Ổ cắm hỏng|Có bao nhiêu ổ cắm\?|access_token/i);
});

it('ignores a late paint callback from an earlier intake run', () => {
  const events = [];
  const timing = createAiIntakeTiming({ enabled: true, now: () => 100, logger: event => events.push(event) });
  const earlier = timing.start();
  const current = timing.start();
  timing.firstQuestionRendered(earlier);
  timing.firstQuestionRendered(current);
  assert.equal(events.filter(event => event.stage === 'first_question_rendered').length, 1);
});

it('does not emit timing when opt-in is absent', () => {
  const events = [];
  const timing = createAiIntakeTiming({ enabled: false, now: () => 10, logger: event => events.push(event) });
  timing.start();
  timing.mark('request_sent');
  timing.firstQuestionRendered();
  assert.deepEqual(events, []);
});
