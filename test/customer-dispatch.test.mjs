import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getCustomerDispatchState, renderCustomerDispatchState } from '../src/customer/dispatch-state.js';
import { createCustomerMissionSynchronizer, createCustomerMissionStateFromServer, createAssignedCustomerTechnician } from '../src/customer/supabase-mission.js';

for (const outcome of ['accepted', 'declined', 'expired']) {
  it(`follows pending → ${outcome} → server dispatch through realtime and polling`, async () => {
    let mission = { id: 'm1', status: 'offered', providerId: null, version: 2 };
    let offers = [{ id: 'o1', provider_id: 'p1', status: 'pending' }];
    let realtime;
    let poll;
    const received = [];
    const sync = createCustomerMissionSynchronizer({
      missionRepository: {
        getById: async () => mission, getQuoteHistory: async () => [], getOffers: async () => offers,
        subscribeMission(id, callback) { assert.equal(id, 'm1'); realtime = callback; return () => {}; },
      },
      providerRepository: { getById: async id => ({ id, name: 'Provider' }) },
      scheduleTask: callback => { poll = callback; return 1; }, clearTask() {},
    });
    const initial = await sync.load('m1');
    assert.equal(getCustomerDispatchState(initial).phase, 'waiting');
    assert.match(renderCustomerDispatchState(initial), /Đang chờ thợ xác nhận/);
    assert.doesNotMatch(renderCustomerDispatchState(initial), /Đã kết nối thành công/);
    assert.equal(createCustomerMissionStateFromServer(initial).statusIndex, -1);
    assert.equal(createAssignedCustomerTechnician({ id: 'p1' }, mission), null);
    const stopRealtime = sync.subscribe('m1', state => received.push(state), error => { throw error; });
    const stopPoll = sync.poll('m1', state => received.push(state), error => { throw error; });
    try {
      offers = [{ ...offers[0], status: outcome }];
      if (outcome === 'accepted') mission = { ...mission, status: 'accepted', providerId: 'p1', version: 3 };
      await realtime({ new: { status: outcome } });
      assert.equal(getCustomerDispatchState(received.at(-1)).phase, outcome === 'accepted' ? 'accepted' : 'searching');
      if (outcome === 'accepted') {
        assert.match(renderCustomerDispatchState(received.at(-1)), /Đã kết nối thành công/);
        assert.equal(createAssignedCustomerTechnician(received.at(-1).provider, mission).id, 'p1');
      } else {
        offers = [...offers, { id: 'o2', provider_id: 'p2', status: 'pending' }];
        // No realtime notification: polling must discover backend rematching.
        await poll();
        assert.equal(getCustomerDispatchState(received.at(-1)).phase, 'waiting');
        assert.equal(received.at(-1).offers.at(-1).provider_id, 'p2');
        assert.doesNotMatch(renderCustomerDispatchState(received.at(-1)), /Đã kết nối thành công/);
      }
    } finally { stopRealtime(); stopPoll(); }
  });
}

it('does not treat an accepted offer alone or a provider id on an offered mission as acceptance', () => {
  const mission = { status: 'offered', providerId: 'p1' };
  assert.notEqual(getCustomerDispatchState({ mission, offers: [{ status: 'accepted' }] }).phase, 'accepted');
  assert.equal(createAssignedCustomerTechnician({ id: 'p1' }, mission), null);
});
