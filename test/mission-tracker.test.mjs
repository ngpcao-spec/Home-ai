import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceMission,
  confirmCompletion,
  createMissionState,
  decideRepairQuote,
  decideSupplement,
  getAcceptedSupplement,
  getMissionProgress,
  markMissionArrived,
  missionStatuses,
  requestSupplement,
  startMissionDiagnosis,
  startMissionRepair,
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

  it('passe explicitement du suivi à l’arrivée avec la troisième étape active', () => {
    const travelling = advanceMission(createMissionState());
    const arrived = markMissionArrived(travelling);
    assert.equal(missionStatuses[arrived.statusIndex].id, 'arrived');
    assert.deepEqual(getMissionProgress(arrived).map(({ progress }) => progress), ['done', 'done', 'active', 'pending', 'pending']);
    assert.equal(markMissionArrived(arrived), arrived);
  });

  it('démarre la réparation uniquement après une action explicite à l’arrivée', () => {
    const travelling = advanceMission(createMissionState());
    assert.equal(startMissionRepair(travelling), travelling);
    const inProgress = startMissionRepair(markMissionArrived(travelling));
    assert.equal(missionStatuses[inProgress.statusIndex].id, 'in_progress');
    assert.deepEqual(getMissionProgress(inProgress).map(({ progress }) => progress), ['done', 'done', 'done', 'active', 'pending']);
  });

  it('impose diagnostic et devis avant le démarrage réel de la réparation', () => {
    const quote = { diagnosis: 'Ổ cắm hỏng', totalAmount: 270000 };
    const travelling = advanceMission(createMissionState());
    assert.equal(startMissionDiagnosis(travelling, quote), travelling);

    const arrived = markMissionArrived(travelling);
    const pending = startMissionDiagnosis(arrived, quote);
    assert.equal(missionStatuses[pending.statusIndex].id, 'in_progress');
    assert.equal(pending.interventionPhase, 'quote_pending');
    assert.equal(pending.quote.decision, 'pending');
    assert.equal(decideRepairQuote(createMissionState(), 'accepted').interventionPhase, 'idle');

    const accepted = decideRepairQuote(pending, 'accepted');
    assert.equal(accepted.interventionPhase, 'repairing');
    assert.equal(accepted.quote.decision, 'accepted');
  });

  it('un refus de devis ne démarre jamais la réparation', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, { diagnosis: 'Thiết bị hỏng', totalAmount: 300000 });
    const declined = decideRepairQuote(pending, 'declined');
    assert.equal(declined.interventionPhase, 'quote_declined');
    assert.equal(declined.quote.decision, 'declined');
    assert.equal(decideRepairQuote(declined, 'accepted'), declined);
  });

  it('accepte uniquement une évaluation entière de 1 à 5 étoiles', () => {
    const ready = { ...createMissionState(), statusIndex: 4, completionConfirmed: true };
    [0, 6, 2.5].forEach((rating) => assert.equal(submitReview(ready, rating).reviewSent, false));
    [1, 2, 3, 4, 5].forEach((rating) => assert.deepEqual(submitReview(ready, rating), { ...ready, rating, reviewSent: true }));
  });
});
