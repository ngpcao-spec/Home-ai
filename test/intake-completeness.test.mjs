import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { enforceIntakeCompleteness, requiresIntakeClarification } from '../src/diagnostic/intake-completeness.js';

const request = description => ({ description, clarifications: [] });
const diagnostic = missingQuestions => ({ confidence: 0.99, missingQuestions });
const question = { question: 'Cần sửa gì cụ thể?', suggestedAnswers: ['Ổ cắm', 'Công tắc', 'Đèn'], allowUnknown: false };

it('keeps the Edge and browser safety guards identical', async () => {
  const browser = await readFile(new URL('../src/diagnostic/intake-completeness.js', import.meta.url), 'utf8');
  const edge = await readFile(new URL('../supabase/functions/_shared/intake-completeness.js', import.meta.url), 'utf8');
  assert.equal(edge, browser);
});

it('requires clarification for vague trade or broken-item requests regardless of confidence', () => {
  for (const description of [
    'Tôi cần sửa điện trong nhà', 'Tôi cần thợ điện', 'Máy lạnh bị hỏng',
    'Tôi cần sửa ống nước', 'Máy giặt bị hỏng',
  ]) assert.equal(requiresIntakeClarification(request(description)), true, description);
});

it('does not force questions for concrete work and observable problems', () => {
  for (const description of [
    'Ổ cắm phòng khách không có điện', 'Một vòi nước dưới bồn rửa bị rò',
    'Hai máy lạnh treo tường không mát', 'Máy giặt không hoạt động',
  ]) assert.equal(requiresIntakeClarification(request(description)), false, description);
});

it('uses customer clarifications and respects the three-turn maximum', () => {
  assert.equal(requiresIntakeClarification({ description: 'Tôi cần sửa điện trong nhà', clarifications: [{ answer: 'Ổ cắm phòng khách không có điện' }] }), false);
  assert.equal(requiresIntakeClarification({ description: 'Tôi cần sửa điện trong nhà', clarifications: [{ answer: 'Không biết' }] }), true);
  assert.equal(requiresIntakeClarification({ description: 'Tôi cần sửa điện trong nhà', clarifications: Array(3).fill({ answer: 'Không biết' }) }), false);
});

it('preserves model questions even when its clarification flag would disagree', async () => {
  let retried = 0;
  const original = diagnostic([question]);
  const result = await enforceIntakeCompleteness({ input: request('Tôi cần sửa điện trong nhà'), diagnostic: original, retry: async () => { retried++; return diagnostic([]); } });
  assert.equal(result, original);
  assert.equal(retried, 0);
});

it('never silently skips a question for repeated identical vague requests', async () => {
  for (let run = 0; run < 20; run++) {
    const result = await enforceIntakeCompleteness({
      input: request('Tôi cần sửa điện trong nhà'),
      diagnostic: diagnostic(run % 2 ? [] : [question]),
      retry: async () => diagnostic([question]),
    });
    assert.equal(result.missingQuestions.length, 1);
  }
});

it('signals a missing AI question instead of returning a false completed intake', async () => {
  await assert.rejects(enforceIntakeCompleteness({
    input: request('Tôi cần sửa ống nước'), diagnostic: diagnostic([]), retry: async () => diagnostic([]),
  }), { code: 'CLARIFICATION_REQUIRED' });
});

it('keeps already detailed intakes at the minimum sufficient number of turns', async () => {
  let retried = false;
  const result = await enforceIntakeCompleteness({
    input: request('Ổ cắm phòng khách không có điện'), diagnostic: diagnostic([]), retry: async () => { retried = true; return diagnostic([question]); },
  });
  assert.equal(result.missingQuestions.length, 0);
  assert.equal(retried, false);
});

it('keeps the existing model settings and prevents Edge fallback from silently completing vague intake', async () => {
  const source = await readFile(new URL('../supabase/functions/diagnose-home-request/index.ts', import.meta.url), 'utf8');
  assert.match(source, /model: 'gpt-5-mini'/);
  assert.match(source, /reasoning: \{ effort: 'minimal' \}/);
  assert.match(source, /max_output_tokens: 400/);
  assert.match(source, /invalid_response_retry/);
  assert.match(source, /enforceIntakeCompleteness/);
  assert.match(source, /failure\(origin, 422, 'CLARIFICATION_REQUIRED'\)/);
});
