import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearCustomerSession,
  createMockCustomerSession,
  customerSessionStorageKey,
  isValidMockOtp,
  maskVietnamesePhone,
  mockOtpCode,
  normalizeVietnamesePhone,
  readCustomerSession,
  saveCustomerSession,
} from '../src/customer/session.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe('C03 session client mock', () => {
  it('valide et normalise des numéros mobiles vietnamiens plausibles', () => {
    assert.equal(normalizeVietnamesePhone('091 234 5678'), '+84912345678');
    assert.equal(normalizeVietnamesePhone('912345678'), '+84912345678');
    assert.equal(normalizeVietnamesePhone('+84 912 345 678'), '+84912345678');
    ['123', '0212345678', '09123456789', 'abc'].forEach((phone) => assert.equal(normalizeVietnamesePhone(phone), null));
    assert.equal(maskVietnamesePhone('0912345678'), '+84 ••• ••• 678');
  });

  it('accepte uniquement le code OTP MVP exact à six chiffres', () => {
    assert.equal(mockOtpCode, '123456');
    assert.equal(isValidMockOtp('123456'), true);
    ['12345', '1234567', 'abcdef', '654321'].forEach((otp) => assert.equal(isValidMockOtp(otp), false));
  });

  it('crée, persiste et relit une session client mock', () => {
    const storage = createStorage();
    const session = createMockCustomerSession('0912345678', '2026-08-31T10:00:00.000Z');
    assert.deepEqual(session, {
      id: 'customer-demo-001',
      phone: '+84912345678',
      kind: 'mock-customer-session',
      createdAt: '2026-08-31T10:00:00.000Z',
    });
    assert.equal(saveCustomerSession(storage, session), true);
    assert.equal(JSON.parse(storage.getItem(customerSessionStorageKey)).phone, '+84912345678');
    assert.deepEqual(readCustomerSession(storage), session);
  });

  it('supprime seulement la session lors de la déconnexion', () => {
    const storage = createStorage();
    storage.setItem('onboardingCompleted', 'true');
    saveCustomerSession(storage, createMockCustomerSession('0912345678'));
    assert.equal(clearCustomerSession(storage), true);
    assert.equal(readCustomerSession(storage), null);
    assert.equal(storage.getItem('onboardingCompleted'), 'true');
  });

  it('rejette une session corrompue et tolère un stockage indisponible', () => {
    const storage = createStorage();
    storage.setItem(customerSessionStorageKey, '{broken');
    assert.equal(readCustomerSession(storage), null);
    const unavailable = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    assert.equal(readCustomerSession(unavailable), null);
    assert.equal(saveCustomerSession(unavailable, createMockCustomerSession('0912345678')), false);
    assert.equal(clearCustomerSession(unavailable), false);
  });
});
