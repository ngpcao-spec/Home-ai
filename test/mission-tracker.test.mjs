import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceMission,
  confirmCompletion,
  completeMissionRepair,
  completeExternalPayment,
  createMissionState,
  decideMissionSupplement,
  decideRepairQuote,
  decideSupplement,
  getAcceptedSupplement,
  getAuthorizedMissionTotal,
  getMissionProgress,
  markMissionArrived,
  missionStatuses,
  openProviderReview,
  prepareMissionDetail,
  requestSupplement,
  discoverMissionSupplement,
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
    assert.equal(pending.quote.status, 'pending');
    assert.equal(decideRepairQuote(createMissionState(), 'accepted').interventionPhase, 'idle');

    const accepted = decideRepairQuote(pending, 'accepted');
    assert.equal(accepted.interventionPhase, 'repairing');
    assert.equal(accepted.quote.status, 'accepted');
  });

  it('un refus de devis ne démarre jamais la réparation', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, { diagnosis: 'Thiết bị hỏng', totalAmount: 300000 });
    const declined = decideRepairQuote(pending, 'declined');
    assert.equal(declined.interventionPhase, 'quote_declined');
    assert.equal(declined.quote.status, 'declined');
    assert.equal(decideRepairQuote(declined, 'accepted'), declined);
  });

  it('crée v2 sans modifier v1 et autorise 390.000đ après accord', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, {
      diagnosis: 'Điều hòa không lạnh',
      recommendedTasks: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'],
      totalAmount: 290000,
      warrantyDays: 30,
    });
    const repairing = decideRepairQuote(pending, 'accepted');
    const acceptedV1 = repairing.quoteHistory[0];
    const supplemented = discoverMissionSupplement(repairing);

    assert.equal(Object.isFrozen(acceptedV1), true);
    assert.equal(supplemented.quoteHistory[0], acceptedV1);
    assert.deepEqual(supplemented.quoteHistory.map(({ version, status, totalAmount }) => ({ version, status, totalAmount })), [
      { version: 1, status: 'accepted', totalAmount: 290000 },
      { version: 2, status: 'supplement_pending', totalAmount: 390000 },
    ]);
    assert.equal(supplemented.quoteHistory[1].supplementAmount, 100000);
    assert.equal(getAuthorizedMissionTotal(supplemented), 290000);

    const accepted = decideMissionSupplement(supplemented, 'accepted');
    assert.equal(accepted.quoteHistory[0], acceptedV1);
    assert.equal(accepted.quoteHistory[1].status, 'accepted');
    assert.equal(getAuthorizedMissionTotal(accepted), 390000);
  });

  it('conserve v1 et v2 après refus avec un prix autorisé de 290.000đ', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, { diagnosis: 'Điều hòa không lạnh', recommendedTasks: [], totalAmount: 290000, warrantyDays: 30 });
    const supplemented = discoverMissionSupplement(decideRepairQuote(pending, 'accepted'));
    const rejected = decideMissionSupplement(supplemented, 'rejected');
    assert.deepEqual(rejected.quoteHistory.map(({ version, status }) => ({ version, status })), [
      { version: 1, status: 'accepted' },
      { version: 2, status: 'rejected' },
    ]);
    assert.equal(getAuthorizedMissionTotal(rejected), 290000);
    assert.equal(decideMissionSupplement(rejected, 'accepted'), rejected);
  });

  it('termine l’intervention sur l’étape 5 avec 390.000đ issus de v2 accepté', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, {
      diagnosis: 'Điều hòa không lạnh',
      recommendedTasks: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'],
      totalAmount: 290000,
      warrantyDays: 30,
    });
    const supplemented = discoverMissionSupplement(decideRepairQuote(pending, 'accepted'));
    assert.equal(completeMissionRepair(supplemented), supplemented, 'impossible de terminer avec v2 en attente');
    const accepted = decideMissionSupplement(supplemented, 'accepted');
    const completed = completeMissionRepair(accepted, { missionId: 'mission-17', completedAt: '2026-08-31T10:00:00.000Z' });

    assert.equal(missionStatuses[completed.statusIndex].id, 'completed_pending_payment');
    assert.deepEqual(getMissionProgress(completed).map(({ progress }) => progress), ['done', 'done', 'done', 'done', 'active']);
    assert.deepEqual(completed.completion, {
      missionId: 'mission-17',
      completedAt: '2026-08-31T10:00:00.000Z',
      completedWork: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản', 'Thay dây điện nguồn'],
      acceptedQuoteId: 'quote-v2',
      finalAuthorizedAmount: 390000,
      currency: 'VND',
      warrantyDays: 30,
    });
    assert.deepEqual(completed.quoteHistory.map(({ id, status }) => ({ id, status })), [
      { id: 'quote-v1', status: 'accepted' },
      { id: 'quote-v2', status: 'accepted' },
    ]);
  });

  it('termine à 290.000đ après refus et n’inclut pas le travail non autorisé', () => {
    const arrived = markMissionArrived(advanceMission(createMissionState()));
    const pending = startMissionDiagnosis(arrived, {
      diagnosis: 'Điều hòa không lạnh',
      recommendedTasks: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'],
      totalAmount: 290000,
      warrantyDays: 30,
    });
    const rejected = decideMissionSupplement(discoverMissionSupplement(decideRepairQuote(pending, 'accepted')), 'rejected');
    const completed = completeMissionRepair(rejected, { missionId: 'mission-17-refused', completedAt: '2026-08-31T11:00:00.000Z' });
    assert.equal(completed.completion.acceptedQuoteId, 'quote-v1');
    assert.equal(completed.completion.finalAuthorizedAmount, 290000);
    assert.deepEqual(completed.completion.completedWork, ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản']);
    assert.deepEqual(completed.quoteHistory.map(({ status }) => status), ['accepted', 'rejected']);
  });

  it('termine la mission avec un paiement externe sans modifier le montant final', () => {
    const completion = Object.freeze({ finalAuthorizedAmount: 390000, currency: 'VND' });
    const pendingPayment = {
      ...createMissionState(),
      statusIndex: 4,
      missionStatus: 'completed_pending_payment',
      completion,
    };
    const paid = completeExternalPayment(pendingPayment, { paidAt: '2026-08-31T12:00:00.000Z' });
    assert.equal(paid.missionStatus, 'completed');
    assert.equal(paid.paymentStatus, 'paid_external');
    assert.equal(paid.paidAt, '2026-08-31T12:00:00.000Z');
    assert.equal(paid.completion, completion);
    assert.equal(paid.completion.finalAuthorizedAmount, 390000);
    assert.equal(paid.reviewStage, 'payment_confirmed');
    assert.equal(openProviderReview(paid).reviewStage, 'rating');
    const initial = createMissionState();
    assert.equal(completeExternalPayment(initial), initial);
  });

  it('accepte uniquement une évaluation entière de 1 à 5 étoiles', () => {
    const ready = { ...createMissionState(), statusIndex: 4, completionConfirmed: true };
    [0, 6, 2.5].forEach((rating) => assert.equal(submitReview(ready, rating).reviewSent, false));
    [1, 2, 3, 4, 5].forEach((rating) => assert.deepEqual(submitReview(ready, rating), { ...ready, rating, reviewSent: true }));
  });

  it('enregistre une seule évaluation avec commentaire et prépare le détail de mission', () => {
    const ready = {
      ...createMissionState(),
      missionStatus: 'completed',
      paymentStatus: 'paid_external',
      reviewStage: 'rating',
      completion: { finalAuthorizedAmount: 390000 },
    };
    const submitted = submitReview(ready, 5, '  Dịch vụ rất tốt.  ');
    assert.equal(submitted.rating, 5);
    assert.equal(submitted.reviewComment, 'Dịch vụ rất tốt.');
    assert.equal(submitted.reviewSent, true);
    assert.equal(submitReview(submitted, 1, 'Tentative de modification'), submitted);
    assert.equal(prepareMissionDetail(submitted).missionDetailTarget, 'mission_detail');
    assert.equal(prepareMissionDetail(ready), ready);
  });
});
