import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { enforceIntakeCompleteness, getIntakeCompleteness, requiresIntakeClarification } from '../src/diagnostic/intake-completeness.js';

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

it('rechecks cumulative facts after Q1 and Q2 instead of treating one answer as completion', () => {
  const input = request('Tôi cần sửa điện trong nhà');
  assert.deepEqual(getIntakeCompleteness(input).missingFacts,
    ['target_or_work_area', 'observable_problem_or_concrete_action']);
  input.clarifications.push({ question: 'Bạn cần sửa gì?', answer: 'Sửa ổ cắm' });
  assert.deepEqual(getIntakeCompleteness(input).missingFacts, ['observable_problem_or_concrete_action']);
  assert.equal(requiresIntakeClarification(input), true);
  input.clarifications.push({ question: 'Có bao nhiêu ổ cắm?', answer: '2–3 cái' });
  assert.equal(getIntakeCompleteness(input).knownFacts.quantity, true);
  assert.equal(requiresIntakeClarification(input), true);
  input.clarifications.push({ question: 'Ổ cắm gặp vấn đề gì?', answer: 'Không có điện' });
  assert.equal(getIntakeCompleteness(input).complete, true);
  assert.equal(requiresIntakeClarification(input), false);
});

it('supports vague and detailed requests across current service categories', () => {
  for (const [vague, target, symptom] of [
    ['Tôi cần thợ điện', 'Ổ cắm', 'Không có điện'],
    ['Tôi cần sửa ống nước', 'Ống dưới bồn rửa', 'Bị rò'],
    ['Máy lạnh bị hỏng', 'Máy lạnh phòng ngủ', 'Không lạnh'],
    ['Máy giặt bị hỏng', 'Máy giặt', 'Không hoạt động'],
  ]) {
    const input = request(vague);
    assert.equal(requiresIntakeClarification(input), true, vague);
    input.clarifications.push({ question: 'Thiết bị hoặc khu vực nào?', answer: target });
    assert.equal(requiresIntakeClarification(input), true, target);
    input.clarifications.push({ question: 'Hiện tượng cụ thể là gì?', answer: symptom });
    assert.equal(requiresIntakeClarification(input), false, symptom);
  }
  assert.equal(requiresIntakeClarification(request('Ổ cắm phòng khách không có điện')), false);
  assert.equal(requiresIntakeClarification(request('Thay hai ổ cắm bị vỡ trong phòng ngủ')), false);
  assert.equal(requiresIntakeClarification(request('Bị rò nước')), true);
});

it('never accepts a repeated or already answered question as the next turn', async () => {
  const input = { description: 'Tôi cần sửa điện trong nhà', clarifications: [
    { question: 'Bạn cần sửa gì?', answer: 'Ổ cắm' },
    { question: 'Có bao nhiêu ổ cắm?', answer: '2 cái' },
  ] };
  let retries = 0;
  const result = await enforceIntakeCompleteness({
    input, diagnostic: diagnostic([{ ...question, question: 'Có bao nhiêu ổ cắm?' }]),
    retry: async () => { retries += 1; return diagnostic([{ ...question, question: 'Ổ cắm gặp hiện tượng gì?' }]); },
  });
  assert.equal(retries, 1);
  assert.equal(result.missingQuestions[0].question, 'Ổ cắm gặp hiện tượng gì?');
});

it('retains the maximum of three even when a fourth model question is returned', async () => {
  const input = { description: 'Tôi cần sửa điện trong nhà', clarifications: Array(3).fill({ question: 'Câu hỏi?', answer: 'Không biết' }) };
  const result = await enforceIntakeCompleteness({ input, diagnostic: diagnostic([question]), retry: async () => { throw new Error('retry not expected'); } });
  assert.deepEqual(result.missingQuestions, []);
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

it('keeps Q2 and Q3 for every simulated vague-electricity run when the model returns no question', async () => {
  for (let run = 0; run < 20; run++) {
    const input = request('Tôi cần sửa điện trong nhà');
    const first = await enforceIntakeCompleteness({
      input, diagnostic: diagnostic(run % 2 ? [] : [question]), retry: async () => diagnostic([question]),
    });
    assert.equal(first.missingQuestions.length, 1);
    input.clarifications.push({ question: first.missingQuestions[0].question, answer: 'Sửa ổ cắm' });
    const second = await enforceIntakeCompleteness({
      input, diagnostic: diagnostic([]), retry: async () => diagnostic([{ ...question, question: 'Có bao nhiêu ổ cắm?' }]),
    });
    assert.equal(second.missingQuestions.length, 1);
    input.clarifications.push({ question: second.missingQuestions[0].question, answer: '2–3 cái' });
    const third = await enforceIntakeCompleteness({
      input, diagnostic: diagnostic([]), retry: async () => diagnostic([{ ...question, question: 'Ổ cắm gặp vấn đề gì?' }]),
    });
    assert.equal(third.missingQuestions.length, 1);
    input.clarifications.push({ question: third.missingQuestions[0].question, answer: 'Không có điện' });
    assert.equal(requiresIntakeClarification(input), false);
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
