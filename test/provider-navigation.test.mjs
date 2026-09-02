import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARRIVAL_RADIUS_KM, prepareProviderNavigation } from '../src/provider/provider-navigation.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';
import { renderProviderDashboard } from '../src/provider/provider-app.js';

describe('navigation Provider App après acceptation', () => {
  it('calcule un itinéraire, une distance, un ETA et la position GPS', async () => {
    const assignment = (await createMockProviderAppRepository().accept('offer-demo-1')).assignment;
    const navigation = await prepareProviderNavigation(assignment, { source: 'mock', geolocation: null });
    assert.ok(navigation.route.points.length > 1);
    assert.ok(navigation.route.distanceKm > 0);
    assert.ok(navigation.route.durationMinutes > 0);
    assert.equal(navigation.providerLocation.source, 'fallback');
  });

  it('respecte les transitions accepted vers travelling vers arrived', async () => {
    const repository = createMockProviderAppRepository();
    const accepted = await repository.accept('offer-demo-1');
    const travelling = await repository.updateMissionProgress(accepted.assignment.id, 'travelling', accepted.assignment.clientLocation);
    const arrived = await repository.updateMissionProgress(accepted.assignment.id, 'arrived', accepted.assignment.clientLocation);
    assert.equal(travelling.assignment.status, 'travelling');
    assert.equal(arrived.assignment.status, 'arrived');
    await assert.rejects(repository.updateMissionProgress(accepted.assignment.id, 'travelling', accepted.assignment.clientLocation), /Invalid/);
  });

  it('n’active Tôi đã đến que dans le rayon d’arrivée', () => {
    const state = { provider:{name:'Minh'}, status:{online:true,available:false}, offers:[], assignment:{id:'m1',serviceCategory:'electricity',request:'Test',address:'Adresse assignée',status:'travelling'} };
    const base = { route:{distanceKm:1,durationMinutes:4}, providerLocation:{latitude:12.2,longitude:109.2} };
    assert.match(renderProviderDashboard(state,{navigation:{...base,arrived:false}}), /data-mark-arrived disabled/);
    assert.doesNotMatch(renderProviderDashboard(state,{navigation:{...base,arrived:true}}), /data-mark-arrived disabled/);
    assert.equal(ARRIVAL_RADIUS_KM, .15);
  });

  it('ne place l’adresse et les coordonnées exactes que dans la mission assignée', () => {
    const state={provider:{name:'Minh'},status:{online:true,available:true},offers:[{id:'o',serviceCategory:'electricity',request:'Test',approximateAddress:'Khu vực Nha Trang',distanceKm:1,etaMinutes:3}],assignment:null};
    assert.doesNotMatch(renderProviderDashboard(state),/12 Nguyễn Trãi|clientLocation|109\.1902/);
  });
});
