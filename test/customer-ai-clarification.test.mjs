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
    assert.deepEqual([...state.root.querySelectorAll('[data-clarification-options] button')].map(item => item.textContent),
      ['Phòng khách', 'Phòng ngủ', 'Nhà bếp', 'Khác']);
    const form = state.root.querySelector('[data-clarification-form]');
    assert.equal(form.hidden, true);
    assert.equal(state.dom.window.getComputedStyle(form).display, 'none');
    await choose(state.root, 'Phòng khách');
    assert.deepEqual(state.calls[1].clarifications, [{ question: 'Ổ cắm ở phòng nào?', answer: 'Phòng khách' }]);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
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
    assert.equal(state.root.querySelector('[data-form-status]').textContent, 'AI đang phân tích vấn đề của bạn...');
    form.dispatchEvent(new state.dom.window.Event('submit', {bubbles:true,cancelable:true}));
    assert.equal(state.calls.length, 1);
    resolveAnalysis(diagnosis('Đã hiểu.', []));
    await settle();
    assert.equal(button.querySelector('span').textContent, 'Bắt đầu với AI');
    assert.equal(button.disabled, false);
  } finally { state.dom.window.close(); }
});

it('restores the initial AI button after an analysis error', async () => {
  const state = setup([Promise.reject(new Error('network'))]);
  try {
    await submitInitial(state.root);
    const button = state.root.querySelector('[data-request-form] [type="submit"]');
    assert.equal(button.querySelector('span').textContent, 'Bắt đầu với AI');
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute('aria-pressed'), false);
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
    assert.match(customerStyles, /content: '✓ '/);
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

it('ends clarification after three answers even when the AI still requests information', async () => {
  const state = setup([
    diagnosis('Tour initial', [question('Câu hỏi 1?')]),
    diagnosis('Tour 1', [question('Câu hỏi 2?')]),
    diagnosis('Tour 2', [question('Câu hỏi 3?')]),
    diagnosis('Diagnostic final après limite', [question('Câu hỏi supplémentaire?')]),
  ]);
  try {
    await submitInitial(state.root);
    await choose(state.root, 'Lựa chọn A');
    await choose(state.root, 'Lựa chọn B');
    await choose(state.root, 'Lựa chọn C');
    assert.equal(state.calls.length, 4);
    assert.equal(state.calls[3].clarifications.length, 3);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.missionConnections(), 0);
  } finally { state.dom.window.close(); }
});
