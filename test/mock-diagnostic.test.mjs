import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDiagnostic, detectCategory } from '../src/diagnostic/mock-diagnostic.js';

describe('moteur de diagnostic local', () => {
  it('détecte les quatre catégories à partir de descriptions vietnamiennes', () => {
    assert.equal(detectCategory('Ổ điện không hoạt động'), 'electricity');
    assert.equal(detectCategory('Vòi nước bị rò'), 'plumbing');
    assert.equal(detectCategory('Máy lạnh không lạnh'), 'air-conditioning');
    assert.equal(detectCategory('Máy giặt không khởi động'), 'appliances');
  });

  it('utilise la catégorie choisie en absence de mot-clé', () => {
    assert.equal(detectCategory('Có vấn đề lạ cần kiểm tra', 'plumbing'), 'plumbing');
  });

  it('retourne un contrat indépendant du fournisseur de diagnostic', async () => {
    const result = await createMockDiagnostic({ delay: 0 }).analyse({
      description: '  Điều hòa phát ra tiếng ồn  ',
    });

    assert.deepEqual(result, {
      categoryId: 'air-conditioning',
      summary: 'Điều hòa phát ra tiếng ồn',
    });
  });
});
