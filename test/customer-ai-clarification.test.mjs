import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseHomePage } from '../src/app.js';

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
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com/' });
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
  await settle();
}

async function submitOther(root, value) {
  const form = root.querySelector('[data-clarification-form]');
  form.elements.answer.value = value;
  form.dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
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
    assert.equal(state.root.querySelector('[data-clarification-form]').hidden, true);
    await choose(state.root, 'Phòng khách');
    assert.deepEqual(state.calls[1].clarifications, [{ question: 'Ổ cắm ở phòng nào?', answer: 'Phòng khách' }]);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.missionConnections(), 0);
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
    await choose(state.root, 'Khác');
    assert.equal(form.hidden, false);
    assert.equal(state.calls.length, 1);
    await submitOther(state.root, 'Ngoài ban công');
    assert.equal(state.calls[1].clarifications[0].answer, 'Ngoài ban công');
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
