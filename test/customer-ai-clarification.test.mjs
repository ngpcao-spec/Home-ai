import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { initialiseHomePage } from '../src/app.js';

const customerStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const question = (text, suggestedAnswers = ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C'], allowUnknown = false) => ({
  question: text, suggestedAnswers, allowUnknown,
});
const diagnosis = (summary, missingQuestions) => ({
  categoryId: 'electricity', summary, understoodProblem: summary, confidence: 0.8, missingQuestions, source: 'openai',
});
const settle = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise(resolve => setImmediate(resolve));
};

function setup(responses) {
  const dom = new JSDOM(`<style>${customerStyles}</style><div id="root"></div>`, { url: 'https://example.com/' });
  const root = dom.window.document.querySelector('#root');
  const calls = [];
  let missionConnections = 0;
  initialiseHomePage(
    root,
    undefined,
    { analyse: async request => { calls.push(structuredClone(request)); return responses[calls.length - 1]; } },
    undefined,
    () => 1,
    undefined,
    () => ({ setClientLocation() {}, render() {} }),
    undefined,
    undefined,
    undefined,
    async () => { missionConnections += 1; return { source: 'mock' }; },
  );
  return { dom, root, calls, missionConnections: () => missionConnections };
}

async function submitInitial(root) {
  root.querySelector('#service-request').value = 'Ổ cắm điện không hoạt động';
  root.querySelector('[data-request-form]').dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

async function choose(root, label) {
  const button = [...root.querySelectorAll('[data-clarification-options] button')].find(item => item.textContent === label);
  assert.ok(button, `Option missing: ${label}`);
  button.click();
  if (label !== 'Khác') await new Promise(resolve => setTimeout(resolve, 1050));
  await settle();
}

async function submitOther(root, value) {
  const form = root.querySelector('[data-clarification-form]');
  form.elements.answer.value = value;
  form.dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 1050));
  await settle();
}

it('submits a proposed answer and stops early when no question remains', async () => {
  const state = setup([
    diagnosis('Cần thêm vị trí.', [question('Ổ cắm ở phòng nào?', ['Phòng khách', 'Phòng ngủ', 'Nhà bếp'])]),
    diagnosis('Ổ cắm phòng khách mất điện.', []),
  ]);
  try {
    await submitInitial(state.root);
    const summary = state.root.querySelector('[data-diagnostic-summary]');
    const result = state.root.querySelector('[data-diagnostic-result]');
    assert.equal(summary.hidden, true);
    assert.equal(state.dom.window.getComputedStyle(summary).display, 'none');
    assert.equal(result.classList.contains('is-clarifying'), true);
    assert.equal(state.root.querySelector('[data-result-questions] > .clarification-heading strong').textContent.trim(), 'Cần bổ sung');
    assert.equal(state.root.querySelector('.clarification-hint').textContent, 'Chọn mô tả phù hợp nhất để thợ hiểu rõ hơn');
    assert.deepEqual([...state.root.querySelectorAll('[data-clarification-options] button')].map(item => item.textContent),
      ['Phòng khách', 'Phòng ngủ', 'Nhà bếp', 'Khác']);
    const form = state.root.querySelector('[data-clarification-form]');
    assert.equal(form.hidden, true);
    assert.equal(state.dom.window.getComputedStyle(form).display, 'none');
    await choose(state.root, 'Phòng khách');
    assert.deepEqual(state.calls[1].clarifications, [{ question: 'Ổ cắm ở phòng nào?', answer: 'Phòng khách' }]);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(summary.hidden, false);
    assert.equal(result.classList.contains('is-clarifying'), false);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.missionConnections(), 0);
  } finally { state.dom.window.close(); }
});

it('confirms the initial AI request immediately and prevents duplicate submissions', async () => {
  let resolveAnalysis;
  const state = setup([new Promise(resolve => { resolveAnalysis = resolve; })]);
  try {
    const form = state.root.querySelector('[data-request-form]');
    form.elements.request.value = 'Ổ cắm điện không hoạt động';
    form.dispatchEvent(new state.dom.window.Event('submit', {bubbles:true,cancelable:true}));
    const button = form.querySelector('[type="submit"]');
    assert.equal(button.querySelector('span').textContent, '✓ Đã gửi');
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    const status = state.root.querySelector('[data-form-status]');
    assert.equal(status.textContent, 'AI đang phân tích vấn đề của bạn...');
    assert.equal(status.classList.contains('is-ai-loading'), true);
    assert.equal(form.getAttribute('aria-busy'), 'true');
    assert.match(customerStyles, /\.form-status\.is-ai-loading::before[^}]*animation: ai-wait-spin/);
    form.dispatchEvent(new state.dom.window.Event('submit', {bubbles:true,cancelable:true}));
    assert.equal(state.calls.length, 1);
    resolveAnalysis(diagnosis('Đã hiểu.', []));
    await settle();
    assert.equal(button.querySelector('span').textContent, 'Bắt đầu với AI');
    assert.equal(button.disabled, false);
    assert.equal(status.classList.contains('is-ai-loading'), false);
    assert.equal(form.hasAttribute('aria-busy'), false);
  } finally { state.dom.window.close(); }
});

it('restores the initial AI button after an analysis error', async () => {
  let rejectAnalysis;
  const state = setup([new Promise((_resolve, reject) => { rejectAnalysis = reject; })]);
  try {
    const form = state.root.querySelector('[data-request-form]');
    form.elements.request.value = 'Ổ cắm điện không hoạt động';
    form.dispatchEvent(new state.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(state.root.querySelector('[data-form-status]').classList.contains('is-ai-loading'), true);
    rejectAnalysis(new Error('network'));
    await settle();
    const button = state.root.querySelector('[data-request-form] [type="submit"]');
    assert.equal(button.querySelector('span').textContent, 'Bắt đầu với AI');
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute('aria-pressed'), false);
    assert.match(state.root.querySelector('[data-form-status]').textContent, /Không thể phân tích/);
    assert.equal(state.root.querySelector('[data-form-status]').classList.contains('is-ai-loading'), false);
    assert.equal(form.hasAttribute('aria-busy'), false);
  } finally { state.dom.window.close(); }
});

it('shows a compact accessible spinner for each Q1→Q2→Q3→summary analysis', async () => {
  let resolveQ2;
  let resolveQ3;
  let resolveSummary;
  const state = setup([
    diagnosis('Cần bổ sung.', [question('Câu hỏi 1?')]),
    new Promise(resolve => { resolveQ2 = resolve; }),
    new Promise(resolve => { resolveQ3 = resolve; }),
    new Promise(resolve => { resolveSummary = resolve; }),
  ]);
  const feedback = state.root.querySelector('[data-clarification-feedback]');
  try {
    await submitInitial(state.root);
    for (const [answer, resolve, next] of [
      ['Lựa chọn A', resolveQ2, question('Câu hỏi 2?')],
      ['Lựa chọn B', resolveQ3, question('Câu hỏi 3?')],
      ['Lựa chọn C', resolveSummary, null],
    ]) {
      const button = [...state.root.querySelectorAll('[data-clarification-options] button')]
        .find(item => item.textContent === answer);
      button.click();
      assert.equal(feedback.textContent, `✓ Đã chọn: ${answer}`);
      assert.equal(feedback.classList.contains('is-ai-loading'), false);
      await new Promise(resolveWait => setTimeout(resolveWait, 1050));
      await settle();
      assert.equal(feedback.textContent, 'AI đang phân tích...');
      assert.equal(feedback.classList.contains('is-ai-loading'), true);
      assert.equal(state.root.querySelector('[data-diagnostic-result]').getAttribute('aria-busy'), 'true');
      assert.equal(state.root.querySelector('[data-form-status]').classList.contains('is-ai-loading'), false);
      resolve(diagnosis(next ? 'Question suivante.' : 'Diagnostic terminé.', next ? [next] : []));
      await settle();
      assert.equal(feedback.classList.contains('is-ai-loading'), false);
      assert.equal(feedback.hidden, true);
      assert.equal(state.root.querySelector('[data-diagnostic-result]').hasAttribute('aria-busy'), false);
    }
    assert.equal(state.calls.length, 4);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.match(customerStyles, /@media \(prefers-reduced-motion: reduce\)[^}]*animation: none/);
    assert.match(customerStyles, /\.clarification \.clarification-feedback\.is-ai-loading::before/);
  } finally { state.dom.window.close(); }
});

it('removes the in-card spinner and keeps the existing retry error after a clarification failure', async () => {
  let rejectAnalysis;
  const state = setup([
    diagnosis('Cần bổ sung.', [question('Câu hỏi 1?')]),
    new Promise((_resolve, reject) => { rejectAnalysis = reject; }),
  ]);
  try {
    await submitInitial(state.root);
    state.root.querySelector('[data-clarification-answer="Lựa chọn A"]').click();
    await new Promise(resolve => setTimeout(resolve, 1050));
    await settle();
    const feedback = state.root.querySelector('[data-clarification-feedback]');
    assert.equal(feedback.classList.contains('is-ai-loading'), true);
    rejectAnalysis(new Error('network'));
    await settle();
    assert.equal(feedback.classList.contains('is-ai-loading'), false);
    assert.equal(feedback.hidden, true);
    assert.equal(state.root.querySelector('[data-diagnostic-result]').hasAttribute('aria-busy'), false);
    assert.match(state.root.querySelector('[data-form-status]').textContent, /Không thể phân tích/);
  } finally { state.dom.window.close(); }
});

it('offers and submits Không biết only when the AI marks it relevant', async () => {
  const state = setup([
    diagnosis('Cần kiểm tra.', [question('Cầu dao có bị ngắt không?', ['Có', 'Không', 'Không chắc'], true)]),
    diagnosis('Cần thợ điện kiểm tra.', []),
  ]);
  try {
    await submitInitial(state.root);
    await choose(state.root, 'Không biết');
    assert.equal(state.calls[1].clarifications[0].answer, 'Không biết');
  } finally { state.dom.window.close(); }
});

it('reveals free text only after choosing Khác and submits the custom answer', async () => {
  const state = setup([
    diagnosis('Cần vị trí.', [question('Ổ cắm ở đâu?', ['Phòng khách', 'Phòng ngủ', 'Nhà bếp'])]),
    diagnosis('Ổ cắm ngoài ban công mất điện.', []),
  ]);
  try {
    await submitInitial(state.root);
    const form = state.root.querySelector('[data-clarification-form]');
    assert.equal(form.hidden, true);
    assert.equal(state.dom.window.getComputedStyle(form).display, 'none');
    await choose(state.root, 'Khác');
    assert.equal(form.hidden, false);
    assert.equal(state.dom.window.getComputedStyle(form).display, 'grid');
    assert.equal(state.calls.length, 1);
    assert.equal(state.root.querySelector('[data-clarification-feedback]').hidden, true);
    await submitOther(state.root, 'Ngoài ban công');
    assert.equal(state.calls[1].clarifications[0].answer, 'Ngoài ban công');
  } finally { state.dom.window.close(); }
});

it('immediately confirms a choice, locks double clicks and advances once after one second', async () => {
  const state = setup([
    diagnosis('Cần số lượng.', [question('Bao nhiêu ổ cắm?', ['1 cái', '2 cái', '3–4 cái'])]),
    diagnosis('Cần hành động.', [question('Bạn muốn làm gì?')]),
  ]);
  try {
    await submitInitial(state.root);
    const button = state.root.querySelector('[data-clarification-answer="2 cái"]');
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.disabled, true);
    const feedback = state.root.querySelector('[data-clarification-feedback]');
    assert.equal(feedback.hidden, false);
    assert.equal(feedback.textContent, '✓ Đã chọn: 2 cái');
    assert.match(customerStyles, /aria-pressed="true".*\{ border-color: #087b61; background: #dff2eb/);
    assert.match(customerStyles, /content: '✓'/);
    button.click();
    button.dispatchEvent(new state.dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(state.calls.length, 1);
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, 'Bao nhiêu ổ cắm?');
    await new Promise(resolve => setTimeout(resolve, 250));
    await settle();
    assert.equal(state.calls.length, 2);
    assert.deepEqual(state.calls[1].clarifications, [{question:'Bao nhiêu ổ cắm?',answer:'2 cái'}]);
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, 'Bạn muốn làm gì?');
    assert.equal(feedback.hidden, true);
  } finally { state.dom.window.close(); }
});

it('keeps a long dynamic question and a variable answer count inside the compact responsive card', async () => {
  const longQuestion = 'Thiết bị điện nào cần sửa và hiện tượng bạn nhìn thấy cụ thể là gì?';
  const answers = ['Ổ cắm không hoạt động', 'Đèn chớp liên tục', 'Cầu dao thường xuyên bị ngắt', 'Có mùi khét gần dây điện', 'Thiết bị khác'];
  const state = setup([diagnosis('Cần bổ sung.', [question(longQuestion, answers)])]);
  try {
    await submitInitial(state.root);
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, longQuestion);
    assert.deepEqual([...state.root.querySelectorAll('[data-clarification-options] button')].map(item => item.textContent), [...answers, 'Khác']);
    assert.match(customerStyles, /@media \(max-width: 480px\)[\s\S]*\.diagnostic-result\.is-clarifying \{ padding: 15px/);
    assert.match(customerStyles, /@media \(max-width: 480px\)[\s\S]*\.clarification h2 \{ font-size: clamp\(17px, 5vw, 21px\)/);
    assert.match(customerStyles, /\.clarification h2 \{[^}]*overflow-wrap: anywhere/);
    assert.match(customerStyles, /\.clarification-options button \{[^}]*grid-template-columns: minmax\(0, 1fr\) 16px[^}]*min-height: 52px[^}]*overflow-wrap: anywhere/);
    assert.match(customerStyles, /\.clarification-options button::before \{ display: none; \}/);
    assert.doesNotMatch(customerStyles, /content: '＋'/);
  } finally { state.dom.window.close(); }
});

it('continues the conversation correctly after a custom Khác answer', async () => {
  const state = setup([
    diagnosis('Cần vị trí.', [question('Ổ cắm ở đâu?')]),
    diagnosis('Cần biểu hiện.', [question('Ổ cắm mất điện thế nào?', ['Hoàn toàn', 'Chập chờn', 'Có mùi khét'], true)]),
    diagnosis('Đã đủ thông tin.', []),
  ]);
  try {
    await submitInitial(state.root);
    await choose(state.root, 'Khác');
    await submitOther(state.root, 'Ngoài ban công');
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, 'Ổ cắm mất điện thế nào?');
    await choose(state.root, 'Hoàn toàn');
    assert.deepEqual(state.calls[2].clarifications, [
      { question: 'Ổ cắm ở đâu?', answer: 'Ngoài ban công' },
      { question: 'Ổ cắm mất điện thế nào?', answer: 'Hoàn toàn' },
    ]);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
  } finally { state.dom.window.close(); }
});

it('keeps all answers through Q1, Q2 and Q3, then stops at the three-question ceiling', async () => {
  const state = setup([
    diagnosis('Tour initial', [question('Câu hỏi 1?')]),
    diagnosis('Tour 1', [question('Câu hỏi 2?')]),
    diagnosis('Tour 2', [question('Câu hỏi 3?')]),
    diagnosis('Diagnostic final après limite', [question('Câu hỏi supplémentaire?')]),
  ]);
  try {
    await submitInitial(state.root);
    assert.equal(state.root.querySelector('[data-clarification-progress]').textContent, 'Câu hỏi 1/3');
    await choose(state.root, 'Lựa chọn A');
    assert.equal(state.root.querySelector('[data-clarification-progress]').textContent, 'Câu hỏi 2/3');
    await choose(state.root, 'Lựa chọn B');
    assert.equal(state.root.querySelector('[data-clarification-progress]').textContent, 'Câu hỏi 3/3');
    await choose(state.root, 'Lựa chọn C');
    assert.equal(state.calls.length, 4);
    assert.equal(state.calls[3].clarifications.length, 3);
    assert.deepEqual(state.calls[3].clarifications.map(item => item.answer), ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C']);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.missionConnections(), 0);
  } finally { state.dom.window.close(); }
});
