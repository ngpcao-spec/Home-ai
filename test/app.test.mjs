import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHomeAiMarkup, foundations } from '../src/app.js';

describe('Home-ai landing page', () => {
  it('renders the project title and foundations', () => {
    const markup = createHomeAiMarkup();

    assert.match(markup, /Home-ai/);
    assert.match(markup, /Fondations incluses/);
    assert.equal(foundations.length, 3);
  });
});
