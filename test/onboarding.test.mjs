import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createLoginMarkup,
  createOnboardingMarkup,
  createSplashMarkup,
  isOnboardingCompleted,
  onboardingPages,
  onboardingStorageKey,
  saveOnboardingCompleted,
} from '../src/onboarding/flow.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

describe('C01/C02 démarrage et onboarding', () => {
  it('rend le splash C01 avec la marque et la promesse', () => {
    const markup = createSplashMarkup();
    assert.match(markup, /HOME <strong>AI/);
    assert.match(markup, /Dịch vụ gia đình, thông minh hơn/);
    assert.match(markup, /Đang tải/);
  });

  it('définit les trois pages C02 dans le bon ordre', () => {
    assert.deepEqual(onboardingPages.map(({ title, description }) => ({ title, description })), [
      { title: 'Mô tả vấn đề', description: 'AI hiểu nhu cầu của bạn.' },
      { title: 'Tìm đúng kỹ thuật viên', description: 'Tìm thợ phù hợp gần bạn.' },
      { title: 'Theo dõi và hoàn thành', description: 'Theo dõi dịch vụ từ đầu đến cuối.' },
    ]);
  });

  it('rend Bỏ qua, Tiếp tục puis Bắt đầu sur la dernière page', () => {
    const first = createOnboardingMarkup(0);
    const last = createOnboardingMarkup(2);
    assert.match(first, /Bỏ qua/);
    assert.match(first, /Tiếp tục/);
    assert.doesNotMatch(first, />Bắt đầu</);
    assert.match(last, /Bỏ qua/);
    assert.match(last, />Bắt đầu</);
    assert.equal((last.match(/onboarding-dots/g) ?? []).length, 1);
  });

  it('persiste uniquement onboardingCompleted et relit sa valeur', () => {
    const storage = createStorage();
    assert.equal(isOnboardingCompleted(storage), false);
    assert.equal(saveOnboardingCompleted(storage), true);
    assert.equal(storage.getItem(onboardingStorageKey), 'true');
    assert.equal(isOnboardingCompleted(storage), true);
  });

  it('reste fonctionnel lorsque le stockage local est indisponible', () => {
    const unavailableStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    assert.equal(isOnboardingCompleted(unavailableStorage), false);
    assert.equal(saveOnboardingCompleted(unavailableStorage), false);
  });

  it('prépare la saisie téléphone puis l’étape OTP de C03', () => {
    const phoneMarkup = createLoginMarkup();
    ['Chào mừng bạn', 'Nhập số điện thoại để tiếp tục', '+84', 'Số điện thoại', 'Tiếp tục'].forEach((text) => assert.match(phoneMarkup, new RegExp(text.replace('+', '\\+'))));
    const otpMarkup = createLoginMarkup({ step: 'otp', phone: '+84 ••• ••• 789' });
    ['Nhập mã xác thực', '+84 ••• ••• 789', 'Xác nhận', 'Gửi lại mã'].forEach((text) => assert.match(otpMarkup, new RegExp(text.replace('+', '\\+'))));
    assert.doesNotMatch(`${phoneMarkup}${otpMarkup}`, /password|api key|access token/i);
  });
});
