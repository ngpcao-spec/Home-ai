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

it('shows C08 cancellation only while the real mission is searching or offered', () => {
  for (const status of ['searching', 'offered']) {
    assert.match(renderCustomerDispatchState({ mission: { status }, offers: [] }), /data-cancel-provider-search[^>]*>Hủy tìm thợ/);
  }
  for (const status of ['requested', 'accepted', 'cancelled']) {
    assert.doesNotMatch(renderCustomerDispatchState({ mission: { status }, offers: [] }), /data-cancel-provider-search/);
  }
});

it('reloads authoritative accepted state when cancellation loses to provider acceptance', async () => {
  const mission = { id: 'm1', status: 'offered', providerId: null, version: 2 };
  const accepted = { ...mission, status: 'accepted', providerId: 'p1', version: 3 };
  const sync = createCustomerMissionSynchronizer({
    missionRepository: {
      cancelCurrent: async () => { const error = new Error('Mission changed concurrently.'); error.code = '40001'; throw error; },
      getById: async () => accepted, getQuoteHistory: async () => [], getOffers: async () => [{ id: 'o1', status: 'accepted' }],
    },
    providerRepository: { getById: async () => ({ id: 'p1', name: 'Provider Test' }) },
  });
  const result = await sync.cancelSearch(mission);
  assert.equal(result.cancelled, false);
  assert.equal(result.snapshot.mission.status, 'accepted');
  assert.equal(result.snapshot.provider.id, 'p1');
});

it('loads the mission-scoped professional profile only after server acceptance', async () => {
  let mission = { id: 'm1', status: 'offered', providerId: null, version: 1 };
  const calls = [];
  const sync = createCustomerMissionSynchronizer({
    missionRepository: { getById: async () => mission, getQuoteHistory: async () => [], getOffers: async () => [] },
    providerRepository: {
      getProfessionalProfile: async (providerId) => {
        calls.push(['profile', providerId]);
        return { id: providerId, providerId, name: 'Provider Test', verified: true,
          rating: 5, reviewCount: 4, experienceYears: 7, introduction: 'Thợ điện dân dụng.',
          activities: [{ serviceCategory: 'electricity', name: 'Thợ điện' }] };
      },
      getAssignedContact: async providerId => { calls.push(['contact', providerId]); return { phone: '+84901234567' }; },
    },
  });
  assert.equal((await sync.load('m1')).provider, null);
  assert.deepEqual(calls, []);
  mission = { ...mission, status: 'accepted', providerId: 'p1', serviceCategory: 'electricity', version: 2 };
  const snapshot = await sync.load('m1');
  assert.deepEqual(calls, [['profile', 'p1'], ['contact', 'p1']]);
  const technician = createAssignedCustomerTechnician(snapshot.provider, mission);
  assert.equal(technician.activityName, 'Thợ điện');
  assert.equal(technician.phone, '+84901234567');
  assert.equal(technician.experienceYears, 7);
  assert.equal(technician.introduction, 'Thợ điện dân dụng.');
});
