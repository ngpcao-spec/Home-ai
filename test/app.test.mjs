import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHomeAiMarkup, serviceCategories } from '../src/app.js';

describe('HOME AI C04 marketplace home page', () => {
  it('renders the Vietnamese service intake entry point', () => {
    const markup = createHomeAiMarkup();

    assert.match(markup, /HOME <strong>AI/);
    assert.match(markup, /Bạn cần sửa gì/);
    assert.match(markup, /Bắt đầu với AI/);
    assert.match(markup, /data-location/);
  });

  it('renders every MVP category', () => {
    const markup = createHomeAiMarkup();

    assert.deepEqual(serviceCategories.map(({ label }) => label), ['Điện', 'Nước', 'Điều hòa', 'Điện gia dụng']);
    serviceCategories.forEach(({ label }) => assert.match(markup, new RegExp(`>${label}<`)));
  });

  it('does not render content from the previous technical landing page', () => {
    const markup = createHomeAiMarkup();

    assert.doesNotMatch(markup, /assistant domestique intelligent|bases web|Node\.js|Fondations incluses/i);
  });
});
