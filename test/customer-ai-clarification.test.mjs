import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { initialiseHomePage } from '../src/app.js';

const diagnosis = (summary, missingQuestions) => ({
  categoryId: 'electricity',
  summary,
  understoodProblem: summary,
  confidence: 0.8,
  missingQuestions,
  source: 'openai',
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

async function answer(root, value) {
  const form = root.querySelector('[data-clarification-form]');
  form.elements.answer.value = value;
  form.dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

it('asks one Vietnamese clarification at a time and stops early when the AI has enough information', async () => {
  const state = setup([
    diagnosis('Cần thêm vị trí.', ['Ổ cắm ở phòng nào?', 'Thiết bị nào đã được thử?']),
    diagnosis('Cần biết biểu hiện.', ['Ổ cắm có điện chập chờn không?']),
    diagnosis('Ổ cắm phòng khách mất điện hoàn toàn.', []),
  ]);
  try {
    await submitInitial(state.root);
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, 'Ổ cắm ở phòng nào?');
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, true);
    await answer(state.root, 'Trong phòng khách');
    assert.equal(state.root.querySelector('[data-clarification-question]').textContent, 'Ổ cắm có điện chập chờn không?');
    await answer(state.root, 'Mất điện hoàn toàn');
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.root.querySelector('[data-result-summary]').textContent, 'Ổ cắm phòng khách mất điện hoàn toàn.');
    assert.deepEqual(state.calls[2].clarifications, [
      { question: 'Ổ cắm ở phòng nào?', answer: 'Trong phòng khách' },
      { question: 'Ổ cắm có điện chập chờn không?', answer: 'Mất điện hoàn toàn' },
    ]);
    assert.equal(state.calls.every(call => call.description === 'Ổ cắm điện không hoạt động'), true);
    assert.equal(state.missionConnections(), 0);
  } finally { state.dom.window.close(); }
});

it('ends clarification after three answers even when the AI still requests information', async () => {
  const state = setup([
    diagnosis('Tour initial', ['Câu hỏi 1?']),
    diagnosis('Tour 1', ['Câu hỏi 2?']),
    diagnosis('Tour 2', ['Câu hỏi 3?']),
    diagnosis('Diagnostic final après limite', ['Câu hỏi supplémentaire?']),
  ]);
  try {
    await submitInitial(state.root);
    await answer(state.root, 'Trả lời 1');
    await answer(state.root, 'Trả lời 2');
    await answer(state.root, 'Trả lời 3');
    assert.equal(state.calls.length, 4);
    assert.equal(state.calls[3].clarifications.length, 3);
    assert.equal(state.root.querySelector('[data-result-questions]').hidden, true);
    assert.equal(state.root.querySelector('[data-find-technician]').hidden, false);
    assert.equal(state.missionConnections(), 0);
  } finally { state.dom.window.close(); }
});
