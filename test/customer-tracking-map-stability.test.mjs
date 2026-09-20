import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initialiseHomePage } from '../src/app.js';

const settle=async(count=20)=>{for(let index=0;index<count;index+=1)await new Promise(resolve=>setImmediate(resolve));};

test('Client keeps one map, container and Provider marker through GPS, polling and a late route',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test',pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#root');const tasks=[];
  const mission={id:'m1',providerId:'p1',status:'travelling',version:2,serviceCategory:'electricity',problemDescription:'Synthetic',address:'Test',clientLocation:{latitude:12.25,longitude:109.2},paymentStatus:'unpaid'};
  const provider={id:'p1',name:'Synthetic Provider',category:'electricity',verified:true,rating:5,reviewCount:1};
  let gps={missionId:'m1',providerId:'p1',latitude:12.245,longitude:109.19,recordedAt:'2026-09-13T01:00:01Z'};
  let receive;let routeCalls=0;let finishLateRoute;
  const routing={route(origin,destination){
    routeCalls+=1;const result={source:'amazon-location',distanceKm:1,durationMinutes:4,points:[origin,destination]};
    if(routeCalls===2)return new Promise(resolve=>{finishLateRoute=()=>resolve(result);});
    return Promise.resolve(result);
  }};
  let mapCreateCount=0;let providerMarkerCreateCount=0;let providerMarkerMoveCount=0;let renderCount=0;let routeUpdateCount=0;let resizeCount=0;let mapContainer=null;let marker=null;
  const mapProvider={
    setClientLocation(){},
    async render(container,state){
      renderCount+=1;
      if(mapContainer!==container){mapContainer=container;mapCreateCount+=1;}
      if(!marker){marker=container.ownerDocument.createElement('i');marker.dataset.providerMarker='';container.append(marker);providerMarkerCreateCount+=1;}
      marker.dataset.latitude=String(state.technicians[0].latitude);marker.dataset.longitude=String(state.technicians[0].longitude);
    },
    moveProvider(_id,position){
      if(!marker?.isConnected)return false;
      const changed=marker.dataset.latitude!==String(position.latitude)||marker.dataset.longitude!==String(position.longitude);
      marker.dataset.latitude=String(position.latitude);marker.dataset.longitude=String(position.longitude);
      if(changed)providerMarkerMoveCount+=1;
      return true;
    },
    setRoute(_points,options){routeUpdateCount+=1;assert.deepEqual(options,{fit:false});},
    resize(){resizeCount+=1;},
    fitBounds(){throw Error('fitBounds during map resize');},
  };
  const repository={getById:async()=>({...mission}),getQuoteHistory:async()=>[],getAssignedProviderLocation:async()=>({...gps}),subscribeMission(_id,callback){receive=callback;return()=>{};}};
  initialiseHomePage(root,undefined,undefined,undefined,callback=>{tasks.push(callback);return tasks.length;},undefined,
    ()=>mapProvider,routing,undefined,undefined,
    async()=>({source:'supabase',activeMission:mission,repository,providerRepository:{getProfessionalProfile:async()=>provider}}),
    {resume:async()=>({authenticated:true,session:{user:{id:'customer'}}})},{routeRefreshMs:0,now:()=>Date.now()});
  await tasks[0]();await settle();
  const originalContainer=root.querySelector('[data-tracking-map]');const originalMarker=root.querySelector('[data-provider-marker]');
  const originalMapCard=root.querySelector('.tracking-map-card');const originalHandle=root.querySelector('[data-provider-map-resize-handle]');
  assert.ok(originalContainer);assert.ok(originalMarker);assert.equal(mapCreateCount,1);assert.equal(providerMarkerCreateCount,1);
  originalHandle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(originalMapCard.classList.contains('is-map-expanded'),true);
  await new Promise(resolve=>setTimeout(resolve,35));assert.ok(resizeCount>0);

  gps={...gps,latitude:12.246,longitude:109.191,recordedAt:'2026-09-13T01:00:02Z'};
  await receive({table:'provider_status'});await settle(4);assert.equal(routeCalls,2);
  gps={...gps,latitude:12.247,longitude:109.192,recordedAt:'2026-09-13T01:00:03Z'};
  await receive({table:'provider_status'});await settle(4);
  finishLateRoute();await settle();
  await receive({table:'missions'});await settle();
  await tasks.at(-1)();await settle();

  assert.equal(root.querySelector('[data-tracking-map]'),originalContainer);
  assert.equal(root.querySelector('[data-provider-marker]'),originalMarker);
  assert.equal(root.querySelector('.tracking-map-card'),originalMapCard);
  assert.equal(root.querySelector('[data-provider-map-resize-handle]'),originalHandle);
  assert.equal(originalMapCard.classList.contains('is-map-expanded'),true);
  assert.equal(root.querySelectorAll('[data-provider-marker]').length,1);
  assert.equal(originalMarker.dataset.latitude,'12.247');assert.equal(originalMarker.dataset.longitude,'109.192');
  assert.equal(mapCreateCount,1);assert.equal(providerMarkerCreateCount,1);assert.equal(renderCount,1);
  assert.ok(providerMarkerMoveCount>=2);assert.ok(routeUpdateCount>=1);
  dom.window.close();
});

test('accepted map waits for valid Provider GPS, then keeps its map, marker and camera through travelling',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test',pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#root');const tasks=[];
  const mission={id:'m2',providerId:'p2',status:'accepted',version:1,serviceCategory:'electricity',
    problemDescription:'Synthetic',address:'Test',clientLocation:{latitude:12.25,longitude:109.2},paymentStatus:'unpaid'};
  const provider={id:'p2',name:'Synthetic Provider',category:'electricity',verified:false,rating:5,reviewCount:1};
  let gps=null;let receive;let marker;let renderCount=0;let markerCreateCount=0;let markerMoveCount=0;
  let routeCalls=0;let routeUpdates=0;let resizeCount=0;
  const setMarker=(container,position)=>{
    if(!marker){marker=container.ownerDocument.createElement('i');marker.dataset.providerMarker='';container.append(marker);markerCreateCount+=1;}
    marker.dataset.latitude=String(position.latitude);marker.dataset.longitude=String(position.longitude);
  };
  const mapProvider={
    setClientLocation(){},
    async render(container,view){renderCount+=1;assert.deepEqual(view.clientLocation,mission.clientLocation);
      if(view.technicians.length)setMarker(container,view.technicians[0]);},
    setProviders(technicians){if(technicians.length)setMarker(root.querySelector('[data-tracking-map]'),technicians[0]);},
    moveProvider(_id,position){assert.ok(marker?.isConnected);markerMoveCount+=1;setMarker(marker.parentElement,position);},
    setRoute(_points,options){routeUpdates+=1;assert.deepEqual(options,{fit:false});},
    resize(){resizeCount+=1;},
    fitBounds(){throw Error('camera reset during accepted → travelling');},
  };
  const routing={route(origin,destination){routeCalls+=1;return Promise.resolve({source:'amazon-location',
    distanceKm:1,durationMinutes:4,points:[origin,destination]});}};
  const repository={getById:async()=>({...mission}),getQuoteHistory:async()=>[],
    getAssignedProviderLocation:async()=>gps?{...gps}:null,
    subscribeMission(_id,callback){receive=callback;return()=>{};}};
  initialiseHomePage(root,undefined,undefined,undefined,callback=>{tasks.push(callback);return tasks.length;},undefined,
    ()=>mapProvider,routing,undefined,undefined,
    async()=>({source:'supabase',activeMission:mission,repository,
      providerRepository:{getProfessionalProfile:async()=>provider}}),
    {resume:async()=>({authenticated:true,session:{user:{id:'customer'}}})});
  await tasks[0]();await settle();
  const container=root.querySelector('[data-tracking-map]');const handle=root.querySelector('[data-provider-map-resize-handle]');
  assert.ok(container);assert.ok(handle);assert.equal(renderCount,1);assert.equal(markerCreateCount,0);
  assert.equal(routeCalls,0);assert.equal(root.querySelector('[data-tracking-metrics]').hidden,true);
  assert.equal(root.querySelector('[data-provider-location-waiting]').hidden,false);
  assert.equal(root.querySelector('[data-tracking-eta]').textContent,'Đang tính...');
  handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(root.querySelector('.tracking-map-card').classList.contains('is-map-expanded'),true);
  await new Promise(resolve=>setTimeout(resolve,35));assert.ok(resizeCount>0);

  gps={missionId:'m2',providerId:'p2',latitude:12.245,longitude:109.19,recordedAt:'2026-09-13T01:00:01Z'};
  await receive({table:'provider_status'});await settle();
  assert.equal(root.querySelector('[data-provider-location-waiting]').hidden,true);
  assert.equal(markerCreateCount,1);assert.equal(renderCount,1);assert.equal(marker.dataset.latitude,'12.245');
  assert.equal(root.querySelector('[data-tracking-map]'),container);

  mission.status='travelling';mission.version+=1;
  await receive({table:'missions'});await settle();
  assert.equal(root.querySelector('[data-tracking-map]'),container);
  assert.equal(root.querySelector('[data-provider-map-resize-handle]'),handle);
  assert.equal(root.querySelector('.tracking-map-card').classList.contains('is-map-expanded'),true);
  assert.equal(renderCount,1);assert.equal(markerCreateCount,1);
  assert.ok(routeCalls>=1);assert.ok(routeUpdates>=1);
  assert.equal(root.querySelector('[data-tracking-metrics]').hidden,false);
  assert.equal(root.querySelector('[data-tracking-eta]').textContent,'4 phút');
  gps={...gps,latitude:12.247,longitude:109.192,recordedAt:'2026-09-13T01:00:02Z'};
  await receive({table:'provider_status'});await settle();
  assert.equal(root.querySelector('[data-tracking-map]'),container);
  assert.equal(marker.dataset.latitude,'12.247');assert.equal(marker.dataset.longitude,'109.192');
  assert.equal(renderCount,1);assert.equal(markerCreateCount,1);assert.ok(markerMoveCount>=1);
  dom.window.close();
});
