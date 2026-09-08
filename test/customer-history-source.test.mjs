import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { createMissionDetailMarkup, createMissionHistoryMarkup, getClientMissionHistory } from '../src/mission/history.js';

describe('C19 avec une session Supabase', () => {
  const completed = {
    missionId: 'mission-real-1', problem: 'Sua dien', service: 'electricity',
    completedAt: '2026-09-08T05:00:00Z', address: 'Nha Trang', statusLabel: 'Hoan thanh',
    technician: { name: 'Provider Test Nha Trang', rating: 5, reviewCount: 1, shortDescription: 'Electricite' },
    quoteHistory: [
      { id: 'q1', version: 1, status: 'accepted', totalAmount: 200000 },
      { id: 'q2', version: 2, status: 'accepted', totalAmount: 300000 },
    ],
    finalAuthorizedAmount: 300000, currency: 'VND', paymentStatus: 'paid_external',
    warrantyDays: 30, completedWork: ['Diagnostic', 'Reparation'],
    review: { rating: 5, comment: 'Tres bon service' },
  };

  it('n ajoute jamais les trois missions mock a une liste Supabase', () => {
    const history = getClientMissionHistory(null, [completed]);
    assert.deepEqual(history.map(item => item.missionId), ['mission-real-1']);
    assert.doesNotMatch(createMissionHistoryMarkup(history), /HOMEAI-HISTORY-/);
  });

  it('rend le vrai provider, le montant final, V1 V2, date, garantie et review', () => {
    const detail = createMissionDetailMarkup(completed);
    for (const expected of ['Provider Test Nha Trang', '300.000', 'v1', 'v2', '30', '5/5', 'Tres bon service']) {
      assert.match(detail, new RegExp(expected));
    }
  });

  it('charge Supabase independamment de la restauration de mission et refuse le fallback mock sur erreur', async () => {
    const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
    assert.match(app, /const ensureSupabaseMissionBackend = async/);
    assert.match(app, /requiresSupabaseSession \|\| supabaseMissionMode \|\| Boolean\(verifiedCustomerUserId\)/);
    assert.match(app, /connection\.source !== 'supabase'.*throw/s);
    assert.match(app, /Impossible|Không thể tải lịch sử Supabase/);
  });

  it('identifie une session expiree avant toute requete et redemande Google', async () => {
    const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
    assert.match(app, /connection\.reason === 'no-session'/);
    assert.match(app, /SUPABASE_SESSION_REQUIRED/);
    assert.match(app, /Phiên đăng nhập đã hết hạn/);
    assert.doesNotMatch(app.match(/SUPABASE_SESSION_REQUIRED[\s\S]*?return;/)?.[0] ?? '', /mockMissionHistory/);
  });
});
