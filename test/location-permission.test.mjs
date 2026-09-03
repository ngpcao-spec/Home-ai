import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyGeolocationError, getLocationPermissionState, mountLocationPermissionGate, renderLocationPermission, requestCurrentPosition } from '../src/location/location-permission.js';

describe('autorisation GPS réutilisable', () => {
  it('détecte granted, denied, prompt et indisponible sans déclencher le GPS', async () => {
    let gpsCalls = 0;
    const geolocation = { getCurrentPosition() { gpsCalls += 1; } };
    for (const state of ['granted', 'denied', 'prompt']) {
      assert.equal(await getLocationPermissionState({ geolocation, permissions: { query: async () => ({ state }) } }), state);
    }
    assert.equal(await getLocationPermissionState({ geolocation: null }), 'unavailable');
    assert.equal(gpsCalls, 0);
  });

  it('demande la position native avec précision et renvoie uniquement les coordonnées', async () => {
    let options;
    const position = await requestCurrentPosition({ getCurrentPosition(success, failure, received) { void failure; options = received; success({ coords: { latitude: 12.2388, longitude: 109.1967, accuracy: 8 } }); } });
    assert.deepEqual(position, { latitude: 12.2388, longitude: 109.1967 });
    assert.equal(options.enableHighAccuracy, true);
  });

  it('affiche les explications vietnamiennes et les réglages iPhone après refus', () => {
    assert.match(renderLocationPermission('prompt'), /Cho phép vị trí/);
    assert.match(renderLocationPermission('denied'), /Cài đặt → Safari → Vị trí/);
    assert.match(renderLocationPermission('denied'), /Thử lại/);
    assert.match(renderLocationPermission('unavailable'), /Dịch vụ định vị/);
    assert.match(renderLocationPermission('error'), /kiểm tra GPS/);
  });

  it('ne déclenche la demande native qu’après l’action et enregistre avant de continuer', async () => {
    let clickHandler; let gpsCalls = 0; const saved = [];
    const root = { innerHTML: '', addEventListener(type, handler) { if (type === 'click') clickHandler = handler; } };
    const gate = mountLocationPermissionGate(root, {
      geolocation: { getCurrentPosition(success) { gpsCalls += 1; success({ coords: { latitude: 12.2, longitude: 109.2 } }); } },
      onGranted: async (position) => { saved.push(position); },
    });
    assert.equal(gpsCalls, 0);
    clickHandler({ target: { closest: () => ({}) } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(gpsCalls, 1);
    assert.deepEqual(saved, [{ latitude: 12.2, longitude: 109.2 }]);
    assert.equal(gate.getState(), 'granted');
  });

  it('reste sur le composant avec un état sûr après refus ou erreur GPS', async () => {
    for (const [code, expected] of [[1, 'denied'], [2, 'unavailable'], [3, 'error']]) {
      const root = { innerHTML: '', addEventListener() {} };
      const gate = mountLocationPermissionGate(root, { geolocation: { getCurrentPosition(success, failure) { void success; failure({ code }); } }, onGranted: async () => {} });
      assert.equal(await gate.request(), null);
      assert.equal(gate.getState(), expected);
      assert.equal(classifyGeolocationError({ code }), expected);
    }
  });
});
