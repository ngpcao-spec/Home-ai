import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readInitialQuoteForm, renderInitialQuoteForm, updateInitialQuoteForm } from '../src/provider/initial-quote-form.js';

function form(values = {}) {
  const fields = {
    '[data-quote-diagnosis]': { value: values.diagnosis ?? '' },
    '[data-quote-labor]': { value: values.labor ?? '200000' },
    '[data-quote-parts]': { value: values.parts ?? '0' },
    '[data-quote-warranty]': { value: values.warranty ?? '' },
    '[data-quote-total]': { textContent: '' },
    '[data-send-quote]': { disabled: false },
  };
  return { querySelector: selector => fields[selector] ?? null, fields };
}

it('allows V1 without diagnosis or warranty and includes zero-value parts', () => {
  const root = form();
  const result = updateInitialQuoteForm(root, true, false);
  assert.equal(result.valid, true);
  assert.deepEqual(result.draft, {
    diagnosis: '', laborAmount: 200000, partsAmount: 0, warrantyDays: 0,
    laborDescription: 'Công kiểm tra và sửa chữa', partsDescription: 'Linh kiện dự kiến',
  });
  assert.equal(result.total, 200000);
  assert.equal(root.fields['[data-quote-total]'].textContent, '200.000đ');
  assert.equal(root.fields['[data-send-quote]'].disabled, false);
});

it('updates the visible total without rebuilding the form and rejects an empty price', () => {
  const root = form({ labor: '125000', parts: '75000' });
  const formNode = root.fields;
  updateInitialQuoteForm(root, true, false);
  assert.equal(root.fields, formNode);
  assert.equal(root.fields['[data-quote-total]'].textContent, '200.000đ');
  root.fields['[data-quote-labor]'].value = '';
  const invalid = readInitialQuoteForm(root);
  updateInitialQuoteForm(root, true, false);
  assert.equal(invalid.valid, false);
  assert.equal(root.fields['[data-send-quote]'].disabled, true);
});

it('labels optional fields and keeps explicit client acceptance protection visible', () => {
  const html = renderInitialQuoteForm();
  assert.match(html, /Kết quả chẩn đoán <small>\(không bắt buộc\)/);
  assert.match(html, /Bảo hành <small>\(không bắt buộc\)/);
  assert.match(html, /data-quote-total/);
  assert.match(html, /sau khi khách hàng chấp nhận rõ ràng/);
});
