import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { legalContent, supportFaqs } from '../src/customer/support.js';
import { createLegalMarkup, createSupportMarkup } from '../src/customer/support-view.js';

describe('C21 aide et support', () => {
  it('conserve les six questions dans le modèle FAQ', () => {
    assert.equal(supportFaqs.length, 6);
    [
      'Làm thế nào để đặt dịch vụ?', 'Tôi có thể hủy yêu cầu không?',
      'Giá dịch vụ được xác nhận như thế nào?', 'Nếu có chi phí phát sinh thì sao?',
      'Tôi có thể liên hệ kỹ thuật viên như thế nào?', 'Bảo hành hoạt động như thế nào?',
    ].forEach((question) => assert.ok(supportFaqs.some((faq) => faq.question === question)));
    assert.ok(Object.isFrozen(supportFaqs));
  });

  it('rend une FAQ accordéon et les deux actions simulées', () => {
    const markup = createSupportMarkup(supportFaqs);
    assert.equal((markup.match(/<details/g) ?? []).length, 6);
    ['Trợ giúp &amp; hỗ trợ', 'Gọi hỗ trợ', 'Nhắn tin hỗ trợ', 'data-back-profile'].forEach((text) => assert.match(markup, new RegExp(text)));
  });

  it('rend les deux documents légaux comme placeholders structurés', () => {
    const markup = createLegalMarkup(legalContent);
    ['Điều khoản sử dụng', 'Chính sách quyền riêng tư', 'chưa phải văn bản pháp lý chính thức', 'data-back-profile'].forEach((text) => assert.match(markup, new RegExp(text)));
  });

  it('affiche le résultat explicite d’une action support simulée', () => {
    const message = 'Không có dữ liệu nào được gửi.';
    assert.match(createSupportMarkup(supportFaqs, message), new RegExp(message));
  });
});
