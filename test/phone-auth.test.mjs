import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { createPhoneOtpCooldown, normalizeVietnamPhone, phoneOtpErrorMessage, sendPhoneOtp, verifyPhoneOtp } from '../src/auth/phone-auth.js';
import { createGoogleCustomerAuth } from '../src/customer/google-auth.js';
import { createProviderGoogleAuth } from '../src/provider/provider-auth.js';
import { initialiseProviderApp, renderProviderLogin } from '../src/provider/provider-app.js';
import { initialiseHomePage } from '../src/app.js';
import { createLoginMarkup } from '../src/onboarding/flow.js';

const runtime = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Supabase Phone OTP Client et Provider', () => {
  it('normalise les formats vietnamiens sans accepter de lettres ou de numéros invalides', () => {
    for (const input of ['0912345678', '912345678', '+84912345678', '091 234 5678']) {
      assert.equal(normalizeVietnamPhone(input), '+84912345678');
    }
    for (const input of ['abc0912345678', '091234567x', '123', '0212345678', '09123456789', '+84912345678x']) {
      assert.equal(normalizeVietnamPhone(input), null);
    }
  });

  it('envoie puis valide un SMS avec le numéro E.164 et le type sms sans exposer les jetons', async () => {
    const calls = [];
    const session = { user: { id: 'phone-user' } };
    const client = { auth: {
      signInWithOtp: async input => { calls.push(['send', input]); return { error: null }; },
      verifyOtp: async input => { calls.push(['verify', input]); return { data: { session }, error: null }; },
    } };
    assert.equal(await sendPhoneOtp(client, '0912345678'), '+84912345678');
    assert.equal(await verifyPhoneOtp(client, '912345678', '123456'), session);
    assert.deepEqual(calls, [
      ['send', { phone: '+84912345678' }],
      ['verify', { phone: '+84912345678', token: '123456', type: 'sms' }],
    ]);
    await assert.rejects(sendPhoneOtp(client, 'abc'), /INVALID_PHONE/);
    await assert.rejects(verifyPhoneOtp(client, '0912345678', '12345'), /INVALID_OTP/);
    assert.equal(calls.length, 2);
  });

  it('traduit les erreurs OTP, expiration, envoi et limites sans afficher le détail technique', () => {
    assert.equal(phoneOtpErrorMessage({ code: 'otp_expired', message: 'secret detail' }), 'Mã xác nhận đã hết hạn');
    assert.equal(phoneOtpErrorMessage({ code: 'otp_disabled', message: 'secret detail' }), 'Mã xác nhận không đúng');
    assert.equal(phoneOtpErrorMessage({ code: 'over_request_rate_limit' }), 'Vui lòng thử lại sau');
    assert.equal(phoneOtpErrorMessage({ message: 'secret detail' }, 'send'), 'Không thể gửi mã xác nhận. Vui lòng thử lại.');
  });

  it('bloque le renvoi jusqu’à la fin du cooldown', () => {
    let now = 1000;
    const cooldown = createPhoneOtpCooldown(() => now);
    cooldown.markSent();
    assert.equal(cooldown.secondsRemaining(), 60);
    now += 59000; assert.equal(cooldown.secondsRemaining(), 1);
    now += 1000; assert.equal(cooldown.secondsRemaining(), 0);
  });

  it('restaure une session téléphone Client existante sans recréer le profil et conserve Google', async () => {
    let saves = 0;
    const user = { id: 'phone-user', phone: '+84912345678' };
    const profile = { role: 'customer' };
    const calls = [];
    const auth = createGoogleCustomerAuth(runtime, () => ({ enabled: true,
      client: { auth: {
        getSession: async () => ({ data: { session: { user } }, error: null }),
        getUser: async () => ({ data: { user }, error: null }),
        signInWithOtp: async input => { calls.push(input); return { error: null }; },
        verifyOtp: async () => ({ data: { session: { user } }, error: null }),
        signInWithOAuth: async input => { calls.push(input); return { data: {}, error: null }; },
      } }, profiles: { getById: async () => profile, saveCurrent: async () => { saves += 1; } },
    }));
    await auth.sendPhoneOtp('0912345678'); await auth.verifyPhoneOtp('0912345678', '123456');
    assert.equal((await auth.resume()).profile, profile);
    await auth.signIn();
    assert.equal(saves, 0);
    assert.deepEqual(calls[0], { phone: '+84912345678' });
    assert.equal(calls[1].provider, 'google');
  });

  it('réutilise la session Provider et le provisioning existant sans introduire un autre rôle', async () => {
    const user = { id: 'phone-provider' };
    const client = { auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: { user } }, error: null }),
    } };
    const auth = createProviderGoogleAuth(runtime, () => ({ enabled: true, client }));
    await auth.sendPhoneOtp('0912345678'); await auth.verifyPhoneOtp('0912345678', '123456');
    assert.equal((await auth.getSession()).user.id, user.id);
    assert.match(renderProviderLogin(), /data-provider-phone-form/);
    assert.match(renderProviderLogin(), /data-provider-google-login/);
    assert.match(createLoginMarkup({ realOtp: true, step: 'otp', cooldown: 45 }), /data-change-phone/);
    assert.doesNotMatch(createLoginMarkup({ realOtp: true }), /OTP thử nghiệm/);
  });

  it('Provider : auto-submit au sixième chiffre, erreur localisée, renvoi verrouillé et retour numéro', async () => {
    const dom = new JSDOM('<div id="provider-root"></div>');
    const root = dom.window.document.querySelector('#provider-root');
    const calls = [];
    const auth = { enabled: true, getSession: async () => null, signIn: async () => {},
      sendPhoneOtp: async phone => { calls.push(['send', phone]); },
      verifyPhoneOtp: async (phone, token) => { calls.push(['verify', phone, token]); throw { code: 'otp_expired' }; },
    };
    const app = await initialiseProviderApp(root, async () => { throw new Error('Must not provision before verification'); }, undefined, auth);
    const phone = root.querySelector('[name="phone"]'); phone.value = '0912345678';
    phone.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(calls, [['send', '+84912345678']]);
    assert.ok(root.querySelector('[data-provider-resend]').disabled);
    const otp = root.querySelector('[name="otp"]'); otp.value = '123456';
    otp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
    assert.deepEqual(calls[1], ['verify', '+84912345678', '123456']);
    assert.match(root.textContent, /Mã xác nhận đã hết hạn/);
    root.querySelector('[data-provider-change-phone]').click();
    assert.ok(root.querySelector('[data-provider-phone-form]'));
    app.stop(); dom.window.close();
  });

  it('Client : envoi réel, auto-submit et reprise de session sans deuxième provisioning', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
    const root = dom.window.document.querySelector('#root');
    const tasks = []; const calls = []; let verified = false; let resumes = 0;
    const auth = { enabled: true,
      resume: async () => { resumes += 1; return verified ? { authenticated: true, session: { user: { id: 'customer-1' } }, profile: { role: 'customer' } } : null; },
      sendPhoneOtp: async phone => { calls.push(['send', phone]); },
      verifyPhoneOtp: async (phone, token) => { calls.push(['verify', phone, token]); verified = true; },
    };
    initialiseHomePage(root, undefined, undefined, undefined, fn => { tasks.push(fn); return tasks.length; }, undefined,
      () => ({ setClientLocation() {}, async render() {} }), undefined, undefined,
      async () => ({ name: 'Customer' }), async () => ({ source: 'mock' }), auth);
    await tasks[0]();
    root.querySelector('[data-skip-onboarding]').click();
    const phone = root.querySelector('[data-login-phone-form] [name="phone"]'); phone.value = '0912345678';
    phone.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(calls, [['send', '+84912345678']]);
    assert.ok(root.querySelector('[data-resend-otp]').disabled);
    const otp = root.querySelector('[data-login-otp-form] [name="otp"]'); otp.value = '123456';
    otp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
    assert.deepEqual(calls[1], ['verify', '+84912345678', '123456']);
    assert.equal(resumes, 2);
    assert.equal(root.querySelector('[data-app-shell]').hidden, false);
    dom.window.close();
  });
});
