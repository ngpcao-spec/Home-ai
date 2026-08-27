import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceMission,
  confirmCompletion,
  createMissionState,
  decideSupplement,
  getAcceptedSupplement,
  missionStatuses,
  requestSupplement,
  submitReview,
} from '../src/mission/tracker.js';

describe('suivi local de mission', () => {
  it('conserve l’ordre attendu et avance sans dépasser la fin', () => {
    assert.deepEqual(missionStatuses.map(({ label }) => label), ['Đã nhận yêu cầu', 'Đang di chuyển', 'Đã đến nơi', 'Đang sửa chữa', 'Hoàn thành']);
    let state = createMissionState();
    for (let index = 0; index < 8; index += 1) state = advanceMission(state);
    assert.equal(state.statusIndex, 4);
  });

  it('n’applique jamais un supplément sans demande et accord explicite', () => {
    const initial = createMissionState();
    assert.equal(getAcceptedSupplement(initial), 0);
    assert.equal(decideSupplement(initial, 'accepted'), initial);
    const requested = requestSupplement(initial);
    assert.equal(getAcceptedSupplement(requested), 0);
    assert.equal(getAcceptedSupplement(decideSupplement(requested, 'accepted')), 120000);
  });

  it('maintient le supplément à zéro après refus', () => {
    const declined = decideSupplement(requestSupplement(createMissionState()), 'declined');
    assert.equal(declined.supplement.decision, 'declined');
    assert.equal(getAcceptedSupplement(declined), 0);
  });

  it('autorise la confirmation uniquement à la fin', () => {
    const initial = createMissionState();
    assert.equal(confirmCompletion(initial).completionConfirmed, false);
    const completed = { ...initial, statusIndex: 4 };
    assert.equal(confirmCompletion(completed).completionConfirmed, true);
  });

  it('accepte uniquement une évaluation entière de 1 à 5 étoiles', () => {
    const ready = { ...createMissionState(), statusIndex: 4, completionConfirmed: true };
    [0, 6, 2.5].forEach((rating) => assert.equal(submitReview(ready, rating).reviewSent, false));
    [1, 2, 3, 4, 5].forEach((rating) => assert.deepEqual(submitReview(ready, rating), { ...ready, rating, reviewSent: true }));
  });
});
