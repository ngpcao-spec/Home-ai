import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  connectSupabaseCustomerMissions,
  createAssignedCustomerTechnician,
  createCustomerMissionDraft,
  createCustomerMissionStateFromServer,
  createCustomerMissionSynchronizer,
} from '../src/customer/supabase-mission.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';

const runtime = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

describe('missions client Supabase', () => {
  it('construit les données essentielles sans provider ni statut contrôlé par le navigateur', () => {
    const draft = createCustomerMissionDraft({
      diagnosis: { summary: 'Điều hòa không lạnh' },
      problemDescription: 'Máy lạnh không hoạt động',
      serviceCategory: 'air-conditioning', address: 'Nha Trang',
      location: { latitude: 12.24, longitude: 109.19 }, scheduledFor: null,
    });
    assert.equal(draft.problemDescription, 'Máy lạnh không hoạt động');
    assert.equal(draft.clientLocation.longitude, 109.19);
    assert.equal('providerId' in draft, false);
    assert.equal('status' in draft, false);
  });

  it('reste en fallback mock sans session Supabase', async () => {
    const result = await connectSupabaseCustomerMissions({
      runtimeConfig: runtime,
      repositoryLoader: async () => ({ profiles: { getCurrentUserId: async () => null } }),
    });
    assert.equal(result.source, 'mock');
    assert.equal(result.reason, 'no-session');
  });

  it('lit la mission active avant toute création', async () => {
    const activeMission = { id: 'm1', status: 'searching' };
    const repository = { getActiveCurrent: async () => activeMission };
    const result = await connectSupabaseCustomerMissions({
      runtimeConfig: runtime,
      repositoryLoader: async () => ({
        profiles: { getCurrentUserId: async () => 'customer-1' }, missions: repository, providers: { getById() {} },
      }),
    });
    assert.equal(result.source, 'supabase');
    assert.equal(result.activeMission, activeMission);
    assert.equal(result.repository, repository);
    assert.equal(typeof result.providerRepository.getById, 'function');
  });

  it('crée la mission et les offres sans masquer une erreur serveur', async () => {
    const calls = [];
    const missionRepository = {
      createCurrent: async () => { calls.push('mission'); return { id: 'm1', providerId: null }; },
      createOffers: async () => { calls.push('offers'); throw new Error('offers failed'); },
      getById: async () => null,
      getQuoteHistory: async () => [],
    };
    const synchronizer = createCustomerMissionSynchronizer({
      missionRepository,
      providerRepository: { getById: async () => null },
    });
    await assert.rejects(() => synchronizer.create({}), /offers failed/);
    assert.deepEqual(calls, ['mission', 'offers']);
  });

  it('persiste la mission avant le matching et recharge les offres réellement créées', async () => {
    const calls = [];
    const offers = [{ id: 'o1', mission_id: 'm1', provider_id: 'p1', status: 'pending' }];
    const synchronizer = createCustomerMissionSynchronizer({
      missionRepository: {
        createCurrent: async () => { calls.push('mission'); return { id: 'm1', providerId: null }; },
        createOffers: async () => { calls.push('matching'); return offers; },
        getById: async () => { calls.push('load-mission'); return { id: 'm1', providerId: null }; },
        getQuoteHistory: async () => [],
        getOffers: async () => { calls.push('load-offers'); return offers; },
      },
      providerRepository: { getById: async () => null },
    });
    const snapshot = await synchronizer.create({});
    assert.deepEqual(calls, ['mission', 'matching', 'load-mission', 'load-offers']);
    assert.equal(snapshot.offers[0].provider_id, 'p1');
  });

  it('annule une ancienne recherche avant de créer et matcher une nouvelle demande', async () => {
    const calls=[];
    const previous={id:'old',status:'searching',version:3};
    const synchronizer=createCustomerMissionSynchronizer({
      missionRepository:{
        cancelCurrent:async mission=>{calls.push(['cancel',mission.id]);return{...mission,status:'cancelled'};},
        createCurrent:async()=>{calls.push(['create']);return{id:'new',providerId:null};},
        createOffers:async id=>{calls.push(['offers',id]);return[];},
        getById:async()=>({id:'new',providerId:null,status:'searching'}),
        getQuoteHistory:async()=>[],getOffers:async()=>[],
      },providerRepository:{getById:async()=>null},
    });
    await synchronizer.create({}, {replaceMission:previous});
    assert.deepEqual(calls,[['cancel','old'],['create'],['offers','new']]);
  });

  it('refuse de remplacer côté client une mission déjà attribuée', async () => {
    const synchronizer=createCustomerMissionSynchronizer({
      missionRepository:{cancelCurrent:async()=>assert.fail('cancel must not run')},
      providerRepository:{getById:async()=>null},
    });
    await assert.rejects(()=>synchronizer.create({}, {replaceMission:{id:'m1',status:'accepted'}}),/déjà attribuée/);
  });

  it('relit les offres avec les noms de colonnes réels du schéma', async () => {
    const calls = [];
    const query = {
      select(columns) { calls.push(['select', columns]); return this; },
      eq(column, value) { calls.push(['eq', column, value]); return this; },
      order(column, options) { calls.push(['order', column, options]); return Promise.resolve({ data: [{ id: 'o1', match_rank: 1, straight_line_distance_km: 0.066 }], error: null }); },
    };
    const repository = createSupabaseMissionsRepository({ from(table) { assert.equal(table, 'mission_offers'); return query; }, rpc() {} });
    const offers = await repository.getOffers('m1');
    assert.equal(offers[0].match_rank, 1);
    assert.match(calls[0][1], /straight_line_distance_km/);
    assert.match(calls[0][1], /match_rank/);
    assert.deepEqual(calls.at(-1), ['order', 'match_rank', { ascending: true }]);
  });

  it('synchronise mission, provider assigné et devis serveur puis décide via RPC', async () => {
    const mission = { id: 'm1', providerId: 'p1', status: 'quote_pending', paymentStatus: 'unpaid', serviceCategory: 'electricity' };
    const provider = { id: 'p1', name: 'Nguyễn Văn An', specialty: 'Thợ điện', verified: true };
    const pending = { id: 'q1', missionId: 'm1', version: 1, status: 'pending', diagnosis: 'Dây cháy', recommendedTasks: ['Thay dây'], totalAmount: 200000 };
    const accepted = { ...pending, status: 'accepted' };
    let quotes = [pending];
    const decisions = [];
    const synchronizer = createCustomerMissionSynchronizer({
      missionRepository: {
        getById: async () => mission,
        getQuoteHistory: async () => quotes,
        decideCurrentQuote: async (quoteId, decision) => { decisions.push([quoteId, decision]); quotes = [accepted]; return accepted; },
      },
      providerRepository: { getById: async () => provider },
    });
    const loaded = await synchronizer.load('m1');
    assert.equal(loaded.provider, provider);
    assert.equal(loaded.quotes[0].status, 'pending');
    const decided = await synchronizer.decideQuote('q1', 'accepted');
    assert.deepEqual(decisions, [['q1', 'accepted']]);
    assert.equal(decided.quotes[0].status, 'accepted');
    assert.equal(createAssignedCustomerTechnician(provider, mission).id, 'p1');
    assert.equal(createCustomerMissionStateFromServer(loaded).interventionPhase, 'quote_pending');
    assert.equal(createCustomerMissionStateFromServer(decided).interventionPhase, 'quote_accepted');
  });

  it('poll Supabase signale les erreurs sans produire de snapshot mock', async () => {
    const scheduled = [];
    const errors = [];
    const states = [];
    const synchronizer = createCustomerMissionSynchronizer({
      missionRepository: {
        getById: async () => { throw new Error('network down'); },
        getQuoteHistory: async () => [],
      },
      providerRepository: { getById: async () => null },
      scheduleTask: (task) => { scheduled.push(task); return scheduled.length; },
      clearTask: () => {},
    });
    const stop = synchronizer.poll('m1', (state) => states.push(state), (error) => errors.push(error));
    await scheduled.shift()();
    stop();
    assert.equal(states.length, 0);
    assert.match(errors[0].message, /network down/);
  });

  it('utilise uniquement les RPC server-owned pour créer et annuler', async () => {
    const calls = [];
    const client = {
      from() { return {}; },
      rpc(name, args) {
        calls.push([name, args]);
        if (name === 'create_current_customer_mission_offers') {
          return Promise.resolve({ data: [{ id: 'o1', mission_id: 'm1' }], error: null });
        }
        return Promise.resolve({ data: {
          id: 'm1', client_id: 'c1', provider_id: null, service_category: 'hvac',
          problem_description: 'Test', address_text: 'Nha Trang', client_latitude: 12.24,
          client_longitude: 109.19, status: name.startsWith('cancel_') ? 'cancelled' : 'searching',
          version: name.startsWith('cancel_') ? 2 : 1, currency: 'VND', payment_status: 'unpaid',
          requested_at: '2026-09-01T00:00:00Z',
        }, error: null });
      },
    };
    const repository = createSupabaseMissionsRepository(client);
    const mission = await repository.createCurrent({
      serviceCategory: 'hvac', problemDescription: 'Test', diagnosticSummary: 'HVAC',
      address: 'Nha Trang', clientLocation: { latitude: 12.24, longitude: 109.19 },
    });
    await repository.cancelCurrent(mission);
    await repository.createOffers(mission.id);
    await repository.decideCurrentQuote('q1', 'accepted');
    assert.deepEqual(calls.map(([name]) => name), ['create_current_customer_mission', 'cancel_current_customer_mission', 'create_current_customer_mission_offers', 'decide_current_customer_quote']);
    assert.equal('client_id' in calls[0][1], false);
    assert.equal('provider_id' in calls[0][1], false);
    assert.equal('status' in calls[0][1], false);
    assert.equal('provider_id' in calls[2][1], false);
    assert.deepEqual(calls[3][1], { target_quote_id: 'q1', new_decision: 'accepted' });
  });
});
