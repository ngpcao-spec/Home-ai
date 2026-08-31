import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMockProviderLocationSource,
  createRealtimeProviderLocationSource,
  getProviderArrivalStatus,
} from '../src/tracking/location-stream.js';
import { createTrackingRouteSession } from '../src/tracking/route-session.js';
import { createInterventionQuote } from '../src/mission/intervention-quote.js';
import { createCompletionSummaryMarkup, createPaidExternalMarkup, createProviderReviewMarkup } from '../src/mission/completion-summary.js';
import {
  createInterventionQuoteMarkup,
  createInterventionProgressMarkup,
  createTrackingStageMarkup,
  updateInterventionQuotePresentation,
  updateInterventionPresentation,
  updateTrackingPresentation,
} from '../src/tracking/tracking-sheet.js';

const collectSource = (options) => {
  const callbacks = [];
  const cancelled = [];
  const positions = [];
  const source = createMockProviderLocationSource({
    ...options,
    scheduler(callback) { callbacks.push(callback); return 17; },
    cancel(timer) { cancelled.push(timer); },
  });
  const unsubscribe = source.subscribe((position) => positions.push(position));
  while (!positions.at(-1).arrived) callbacks[0]();
  return { source, positions, cancelled, unsubscribe };
};

describe('suivi C13', () => {
  it('expose une source de localisation abstraite remplaçable par le backend', () => {
    const subscribe = () => () => {};
    const source = createRealtimeProviderLocationSource({ subscribe });
    assert.equal(source.kind, 'backend-realtime');
    assert.equal(source.subscribe, subscribe);
  });

  it('fait progresser le technicien sur chaque segment de la géométrie routière', () => {
    const route = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
    ];
    const { source, positions } = collectSource({ providerId: 'provider-1', route, durationMinutes: 8, totalDistanceKm: 4, sampleCount: 8 });
    assert.equal(source.kind, 'mock-route');
    assert.equal(positions.length, 9);
    assert.ok(positions.every(({ latitude, longitude }) => Math.abs(latitude) < 1e-9 || Math.abs(longitude - 1) < 1e-9), 'aucun point ne coupe le virage en diagonale');
    assert.ok(positions.every((position, index) => !index || position.progress > positions[index - 1].progress));
  });

  it('met à jour distance et ETA de façon monotone puis signale l’arrivée exacte', () => {
    const route = [{ latitude: 12.2, longitude: 109.1 }, { latitude: 12.3, longitude: 109.2 }];
    const { positions, cancelled } = collectSource({ providerId: 'provider-1', route, durationMinutes: 6, totalDistanceKm: 3.2, sampleCount: 4 });
    assert.ok(positions.every((position, index) => !index || position.remainingDistanceKm < positions[index - 1].remainingDistanceKm));
    assert.ok(positions.every((position, index) => !index || position.etaMinutes <= positions[index - 1].etaMinutes));
    assert.deepEqual(positions.at(-1), {
      ...positions.at(-1),
      remainingDistanceKm: 0,
      etaMinutes: 0,
      arrived: true,
      status: 'Thợ đã đến',
      speed: 0,
    });
    assert.deepEqual(cancelled, [17]);
    assert.equal(getProviderArrivalStatus({ arrived: false, remainingDistanceKm: 0.4, etaMinutes: 4 }), 'Sắp đến nơi');
  });

  it('réutilise CalculateRoutes pour un même trajet et réessaie après une erreur', async () => {
    let routeCalls = 0;
    let fail = false;
    const route = { points: [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }] };
    const session = createTrackingRouteSession({ async route() { routeCalls += 1; if (fail) throw new Error('network'); return route; } });
    const origin = { id: 'p1', latitude: 1, longitude: 1 };
    const destination = { latitude: 2, longitude: 2 };
    assert.equal(await session.get(origin, destination), route);
    assert.equal(await session.get(origin, destination), route);
    assert.equal(routeCalls, 1);
    session.reset();
    fail = true;
    await assert.rejects(session.get(origin, destination), /network/);
    fail = false;
    assert.equal(await session.get(origin, destination), route);
    assert.equal(routeCalls, 3);
  });

  it('rend la bottom sheet C13 avec les informations et actions attendues', () => {
    const markup = createTrackingStageMarkup({ initials: 'NM', name: 'Nguyễn Văn Minh', rating: 4.9, reviewCount: 186, shortDescription: 'Thợ điện dân dụng' });
    ['Thợ đang đến', 'Thời gian đến', 'Quãng đường còn lại', 'Gọi thợ', 'Nhắn tin', 'Bắt đầu sửa chữa'].forEach((text) => assert.match(markup, new RegExp(text)));
  });

  it('affiche l’arrivée à zéro puis masque les métriques au démarrage manuel', () => {
    const nodes = new Map([
      ['[data-tracking-status]', { textContent: '' }],
      ['[data-tracking-eta]', { textContent: '' }],
      ['[data-tracking-distance]', { textContent: '' }],
      ['[data-start-repair]', { hidden: true }],
      ['[data-tracking-message]', { textContent: '', hidden: true }],
      ['[data-tracking-metrics]', { hidden: false }],
    ]);
    const container = { querySelector: (selector) => nodes.get(selector) };

    updateTrackingPresentation(container, { arrived: true, status: 'Thợ đã đến', etaMinutes: 0, remainingDistanceKm: 0 });
    assert.equal(nodes.get('[data-tracking-status]').textContent, 'Thợ đã đến');
    assert.equal(nodes.get('[data-tracking-eta]').textContent, '0 phút');
    assert.equal(nodes.get('[data-tracking-distance]').textContent, '0 m');
    assert.equal(nodes.get('[data-tracking-message]').textContent, 'Thợ đã đến địa điểm của bạn.');
    assert.equal(nodes.get('[data-start-repair]').hidden, false);

    updateInterventionPresentation(container);
    assert.equal(nodes.get('[data-tracking-status]').textContent, 'Đang sửa chữa');
    assert.equal(nodes.get('[data-tracking-message]').textContent, 'Thợ đang kiểm tra và sửa chữa thiết bị của bạn.');
    assert.equal(nodes.get('[data-tracking-metrics]').hidden, true);
    assert.equal(nodes.get('[data-start-repair]').hidden, true);
  });

  it('génère un devis C15 déterministe après le diagnostic', () => {
    const quote = createInterventionQuote(
      { summary: 'Ổ cắm điện bị hỏng' },
      { category: 'electricity', priceFrom: 150000 },
    );
    assert.deepEqual(quote, {
      diagnosis: 'Ổ cắm điện bị hỏng',
      recommendedWork: 'Kiểm tra mạch điện, thay ổ cắm bị hỏng và kiểm tra an toàn sau sửa chữa.',
      finding: 'Kiểm tra mạch điện, thay ổ cắm bị hỏng và kiểm tra an toàn sau sửa chữa.',
      recommendedTasks: ['Kiểm tra mạch điện, thay ổ cắm bị hỏng và kiểm tra an toàn sau sửa chữa.'],
      laborAmount: 150000,
      partsAmount: 120000,
      totalAmount: 270000,
      estimatedMinutes: 45,
      warrantyDays: 30,
    });
    const markup = createInterventionQuoteMarkup(quote);
    ['KẾT QUẢ CHẨN ĐOÁN', 'BÁO GIÁ SỬA CHỮA', '270.000đ', 'Chấp nhận báo giá', 'Từ chối báo giá'].forEach((text) => assert.match(markup, new RegExp(text)));
  });

  it('rend le diagnostic C15 accentué et la liste des travaux issus du modèle', () => {
    const quote = createInterventionQuote({
      summary: 'Điều hòa không lạnh',
      finding: 'Tụ điện máy nén hoạt động không ổn định và cần thay thế.',
      recommendedTasks: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'],
    }, { category: 'air-conditioning', priceFrom: 180000 });
    const markup = createInterventionQuoteMarkup(quote);
    ['Điều hòa không lạnh', 'Tụ điện máy nén hoạt động không ổn định và cần thay thế.', 'CÔNG VIỆC ĐỀ XUẤT', 'Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'].forEach((text) => assert.match(markup, new RegExp(text)));
    assert.doesNotMatch(markup, /dieu hoa khong lanh/);
    assert.equal(quote.totalAmount, 290000);
  });

  it('rend v1 et v2 C16 avec les montants et décisions explicites', () => {
    const v1 = Object.freeze({
      version: 1,
      status: 'accepted',
      totalAmount: 290000,
      warrantyDays: 30,
      recommendedTasks: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản'],
    });
    const v2 = Object.freeze({
      version: 2,
      status: 'supplement_pending',
      finding: 'Dây điện nguồn bị hư và cần thay thế.',
      additionalPartsAmount: 80000,
      additionalLaborAmount: 20000,
      supplementAmount: 100000,
      totalAmount: 390000,
    });
    const markup = createInterventionProgressMarkup({ quoteHistory: [v1, v2] });
    ['CÔNG VIỆC ĐÃ ĐƯỢC CHẤP NHẬN', '290.000đ', '30 ngày', 'Dây điện nguồn bị hư và cần thay thế.', '80.000đ', '20.000đ', '+100.000đ', '390.000đ', 'Đồng ý chi phí phát sinh', 'Từ chối', 'v1', 'v2', 'supplement_pending'].forEach((text) => assert.match(markup, new RegExp(text.replace('+', '\\+'))));
    assert.doesNotMatch(markup, /Hoàn thành sửa chữa/);
  });

  it('rend le récapitulatif C17 depuis la dernière version acceptée', () => {
    const completion = {
      missionId: 'mission-17',
      completedAt: '2026-08-31T10:00:00.000Z',
      completedWork: ['Thay tụ điện máy nén', 'Kiểm tra hệ thống', 'Vệ sinh cơ bản', 'Thay dây điện nguồn'],
      acceptedQuoteId: 'quote-v2',
      finalAuthorizedAmount: 390000,
      currency: 'VND',
      warrantyDays: 30,
    };
    const history = [
      { version: 1, status: 'accepted', totalAmount: 290000 },
      { version: 2, status: 'accepted', totalAmount: 390000, supplementAmount: 100000 },
    ];
    const markup = createCompletionSummaryMarkup(completion, history);
    ['Sửa chữa hoàn tất', 'Kỹ thuật viên đã hoàn thành công việc.', 'Thay dây điện nguồn', 'Giá ban đầu đã chấp nhận', '290.000đ', 'Chi phí phát sinh đã chấp nhận', '+100.000đ', 'TỔNG THANH TOÁN', '390.000đ', 'Bảo hành', '30 ngày', 'Tiếp tục thanh toán', 'v1', 'v2'].forEach((text) => assert.match(markup, new RegExp(text.replace('+', '\\+'))));
  });

  it('affiche brièvement le paiement externe puis l’évaluation sans PSP', () => {
    const completion = { finalAuthorizedAmount: 390000 };
    const paidMarkup = createPaidExternalMarkup(completion);
    assert.match(paidMarkup, /Đã thanh toán/);
    assert.match(paidMarkup, /390\.000đ/);
    const reviewMarkup = createProviderReviewMarkup(
      { initials: 'ĐK', name: 'Đặng Minh Khoa' },
      { completion, rating: 0, reviewSent: false },
    );
    ['Đã thanh toán', 'Đánh giá kỹ thuật viên', 'Đặng Minh Khoa', 'Gửi đánh giá'].forEach((text) => assert.match(reviewMarkup, new RegExp(text)));
    assert.doesNotMatch(`${paidMarkup}${reviewMarkup}`, /stripe|paypal|wallet|card number|api key/i);
  });

  it('rend le profil réel, les grandes étoiles et la fin de soumission C18', () => {
    const technician = {
      initials: 'ĐK',
      name: 'Đặng Minh Khoa',
      rating: 5,
      reviewCount: 203,
      shortDescription: 'Bảo dưỡng và sửa điều hòa dân dụng mọi thương hiệu.',
    };
    const submittedMarkup = createProviderReviewMarkup(technician, {
      completion: { finalAuthorizedAmount: 390000 },
      rating: 5,
      reviewComment: 'Dịch vụ rất tốt.',
      reviewSent: true,
      missionDetailTarget: null,
    });
    ['Đặng Minh Khoa', '⭐ 5 · 203 đánh giá', 'Bảo dưỡng và sửa điều hòa dân dụng mọi thương hiệu.', 'Cảm ơn bạn đã đánh giá!', 'Xem chi tiết chuyến'].forEach((text) => assert.match(submittedMarkup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.doesNotMatch(submittedMarkup, />ĐK</);
    assert.equal((submittedMarkup.match(/data-rating=/g) ?? []).length, 5);
    assert.equal((submittedMarkup.match(/disabled/g) ?? []).length, 5);
    assert.doesNotMatch(submittedMarkup, /data-send-review/);
  });

  it('présente distinctement attente, acceptation et refus sans retirer la fiche technicien', () => {
    const nodes = new Map([
      ['[data-tracking-status]', { textContent: '' }],
      ['[data-tracking-message]', { textContent: '', hidden: true }],
      ['[data-tracking-metrics]', { hidden: false }],
      ['[data-start-repair]', { hidden: false }],
      ['[data-intervention-quote]', { hidden: true, innerHTML: '' }],
    ]);
    const container = { querySelector: (selector) => nodes.get(selector) };
    const quote = createInterventionQuote({ summary: '<script>test</script>' }, { category: 'electricity', priceFrom: 150000 });
    const pending = { interventionPhase: 'quote_pending', quote };
    assert.equal(updateInterventionQuotePresentation(container, pending), 'Chờ xác nhận báo giá');
    assert.match(nodes.get('[data-intervention-quote]').innerHTML, /&lt;script&gt;test&lt;\/script&gt;/);
    assert.doesNotMatch(nodes.get('[data-intervention-quote]').innerHTML, /<script>/);

    const acceptedQuote = Object.freeze({ ...quote, version: 1, status: 'accepted' });
    assert.equal(updateInterventionQuotePresentation(container, { ...pending, quote: acceptedQuote, quoteHistory: [acceptedQuote], interventionPhase: 'repairing' }), 'Đang sửa chữa');
    assert.match(nodes.get('[data-intervention-quote]').innerHTML, /Bạn đã chấp nhận báo giá/);
    assert.equal(updateInterventionQuotePresentation(container, { ...pending, interventionPhase: 'quote_declined' }), 'Đã từ chối báo giá');
    assert.match(nodes.get('[data-intervention-quote]').innerHTML, /Việc sửa chữa chưa bắt đầu/);
  });
});
