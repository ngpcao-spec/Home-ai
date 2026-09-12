import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARRIVAL_RADIUS_KM, prepareProviderNavigation, renderProviderNavigation, usesDemoNavigationAdapters } from '../src/provider/provider-navigation.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';
import { initialiseProviderApp, renderProviderDashboard } from '../src/provider/provider-app.js';
import { JSDOM } from 'jsdom';

describe('navigation Provider App après acceptation', () => {
  it('calcule un itinéraire, une distance, un ETA et la position GPS', async () => {
    const assignment = (await createMockProviderAppRepository().accept('offer-demo-1')).assignment;
    const navigation = await prepareProviderNavigation(assignment, { source: 'mock', geolocation: null });
    assert.ok(navigation.route.points.length > 1);
    assert.ok(navigation.route.distanceKm > 0);
    assert.ok(navigation.route.durationMinutes > 0);
    assert.equal(navigation.providerLocation.source, 'fallback');
    assert.equal(navigation.route.distanceKm.toFixed(1), '1.3');
    assert.equal(navigation.route.durationMinutes, 5);
  });

  it('réutilise Amazon Location configuré même avec les données de démonstration', () => {
    assert.equal(usesDemoNavigationAdapters('mock', { AMAZON_LOCATION_API_KEY: 'browser-key' }), false);
    assert.equal(usesDemoNavigationAdapters('mock', { AMAZON_LOCATION_API_KEY: '' }), true);
  });

  it('fournit au marqueur mock une distance et un ETA définis', async () => {
    let rendered;
    const navigation={map:{setClientLocation(){},async render(_container,view){rendered=view;}},route:{distanceKm:1.3,durationMinutes:5,points:[]},providerLocation:{latitude:12.2,longitude:109.2},destination:{latitude:12.21,longitude:109.21}};
    await renderProviderNavigation({},navigation,{id:'p1',name:'Minh'});
    assert.equal(rendered.technicians[0].estimatedArrivalMinutes,5);
    assert.equal(rendered.technicians[0].distanceKm,1.3);
    assert.doesNotMatch(JSON.stringify(rendered),/undefined/);
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

  it('n’affiche la simulation d’arrivée que dans un mode test explicite',()=>{
    const state={provider:{name:'Minh'},status:{},offers:[],assignment:{id:'m1',serviceCategory:'electricity',request:'Test',address:'Nha Trang',status:'travelling',clientLocation:{latitude:12.2,longitude:109.2}}};
    assert.doesNotMatch(renderProviderDashboard(state),/TEST — Giả lập đã đến|data-test-provider-arrival/);
    assert.match(renderProviderDashboard(state,{testMode:true}),/data-test-provider-arrival[^>]*>TEST — Giả lập đã đến/);
    assert.doesNotMatch(renderProviderDashboard({...state,assignment:{...state.assignment,status:'accepted'}},{testMode:true}),/data-test-provider-arrival/);
  });

  it('refuse le mode arrivée simulée à tout autre provider même lorsqu’il est activé en production',async()=>{
    const clientLocation={latitude:12.2315,longitude:109.1902};
    const repository=createMockProviderAppRepository({provider:{id:'p1',name:'Provider Test Nha Trang'},status:{online:true,available:false},offers:[],assignment:{id:'m1',serviceCategory:'electricity',request:'Test',address:'Nha Trang',status:'travelling',clientLocation}});
    const navigation={map:{setClientLocation(){},async render(){}},route:{distanceKm:1,durationMinutes:4,points:[]},providerLocation:{latitude:12.24,longitude:109.2},destination:clientLocation,arrived:false};
    const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});const root=dom.window.document.querySelector('#provider-root');
    const app=await initialiseProviderApp(root,async()=>repository,async()=>navigation,{enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}),undefined,{PROVIDER_TEST_MODE:true,PROVIDER_TEST_PROVIDER_ID:'2040840f-10c6-4acf-a800-1640e1520f4b',SUPABASE_REQUIRED:true});
    try{assert.equal(root.querySelector('[data-test-provider-arrival]'),null);}
    finally{app.stop();dom.window.close();}
  });

  it('simule la proximité puis suit le vrai workflow travelling vers arrived',async()=>{
    const clientLocation={latitude:12.2315,longitude:109.1902};
    const seed={provider:{id:'2040840f-10c6-4acf-a800-1640e1520f4b',name:'Provider Test Nha Trang'},status:{online:true,available:false},offers:[],assignment:{id:'m1',serviceCategory:'electricity',request:'Test',address:'Nha Trang',status:'travelling',clientLocation}};
    const base=createMockProviderAppRepository(seed);let sentPosition;
    const repository={...base,async updateMissionProgress(id,status,position){sentPosition=position;return base.updateMissionProgress(id,status,position);}};
    const navigation={map:{setClientLocation(){},async render(){}},route:{distanceKm:1,durationMinutes:4,points:[]},providerLocation:{latitude:12.24,longitude:109.2},destination:clientLocation,arrived:false};
    const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});const root=dom.window.document.querySelector('#provider-root');
    const app=await initialiseProviderApp(root,async()=>repository,async()=>navigation,{enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}),undefined,{PROVIDER_TEST_MODE:true,PROVIDER_TEST_PROVIDER_ID:'2040840f-10c6-4acf-a800-1640e1520f4b',SUPABASE_REQUIRED:true});
    try{
      root.querySelector('[data-test-provider-arrival]').click();
      for(let index=0;index<5;index+=1)await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(sentPosition,clientLocation);
      assert.equal(app.getState().assignment.status,'arrived');
      assert.ok(root.querySelector('[data-start-diagnosis]'));
    }finally{app.stop();dom.window.close();}
  });

  it('rend le détail premium depuis la navigation réelle sans action fictive', () => {
    const state={provider:{name:'Minh'},status:{online:true,available:false},offers:[],assignment:{id:'m1',serviceCategory:'electricity',request:'Mất điện trong nhà',address:'Vĩnh Hải, Nha Trang',status:'accepted',clientLocation:{latitude:12.25,longitude:109.19}}};
    const navigation={route:{distanceKm:2.1,durationMinutes:6,points:[]},providerLocation:{latitude:12.23,longitude:109.18},destination:{latitude:12.25,longitude:109.19},arrived:false};
    const html=renderProviderDashboard(state,{source:'supabase',navigation});
    for(const text of ['Chi tiết nhiệm vụ','Vị trí của bạn','Mất điện trong nhà','Vĩnh Hải, Nha Trang','2.1 km','ETA 6 phút','Mở bản đồ','BẮT ĐẦU DI CHUYỂN'])assert.match(html,new RegExp(text));
    assert.match(html,/maps\.apple\.com\/\?daddr=12\.25,109\.19/);
    assert.match(html,/Gọi khách hàng/);
    assert.doesNotMatch(html,/Nhắn tin|Giá tham khảo/);
  });

  it('affiche uniquement un prix réellement accepté et le statut travelling', () => {
    const assignment={id:'m1',serviceCategory:'electricity',request:'Test',address:'Nha Trang',status:'travelling',quote:{status:'accepted',totalAmount:300000}};
    const navigation={route:{distanceKm:.8,durationMinutes:3},providerLocation:{latitude:12.2,longitude:109.2},destination:{latitude:12.21,longitude:109.21},arrived:false};
    const html=renderProviderDashboard({provider:{name:'Minh'},status:{},offers:[],assignment},{navigation});
    assert.match(html,/Đang di chuyển/);
    assert.match(html,/Giá đã chấp nhận/);
    assert.match(html,/300\.000đ/);
    assert.doesNotMatch(html,/data-start-travel/);
  });

  it('remplace un chargement de trajet en échec par une erreur et Réessayer',()=>{
    const assignment={id:'m1',serviceCategory:'electricity',request:'Test',address:'Nha Trang',status:'accepted'};
    const html=renderProviderDashboard({provider:{name:'Minh'},status:{},offers:[],assignment},{navigationError:'Hết thời gian chờ Amazon Location.'});
    assert.match(html,/Không thể tải chi tiết lộ trình/);
    assert.match(html,/Hết thời gian chờ Amazon Location/);
    assert.match(html,/data-retry-provider-navigation>Thử lại/);
    assert.doesNotMatch(html,/mission-accepted-confirmation/);
  });

  it('ne place l’adresse et les coordonnées exactes que dans la mission assignée', () => {
    const state={provider:{name:'Minh'},status:{online:true,available:true},offers:[{id:'o',serviceCategory:'electricity',request:'Test',approximateAddress:'Khu vực Nha Trang',distanceKm:1,etaMinutes:3}],assignment:null};
    assert.doesNotMatch(renderProviderDashboard(state),/12 Nguyễn Trãi|clientLocation|109\.1902/);
  });
});
