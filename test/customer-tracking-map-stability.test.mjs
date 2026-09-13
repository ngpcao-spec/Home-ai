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
  let mapCreateCount=0;let providerMarkerCreateCount=0;let providerMarkerMoveCount=0;let renderCount=0;let routeUpdateCount=0;let mapContainer=null;let marker=null;
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
  };
  const repository={getById:async()=>({...mission}),getQuoteHistory:async()=>[],getAssignedProviderLocation:async()=>({...gps}),subscribeMission(_id,callback){receive=callback;return()=>{};}};
  initialiseHomePage(root,undefined,undefined,undefined,callback=>{tasks.push(callback);return tasks.length;},undefined,
    ()=>mapProvider,routing,undefined,undefined,
    async()=>({source:'supabase',activeMission:mission,repository,providerRepository:{getProfessionalProfile:async()=>provider}}),
    {resume:async()=>({authenticated:true,session:{user:{id:'customer'}}})},{routeRefreshMs:0,now:()=>Date.now()});
  await tasks[0]();await settle();
  const originalContainer=root.querySelector('[data-tracking-map]');const originalMarker=root.querySelector('[data-provider-marker]');
  assert.ok(originalContainer);assert.ok(originalMarker);assert.equal(mapCreateCount,1);assert.equal(providerMarkerCreateCount,1);

  gps={...gps,latitude:12.246,longitude:109.191,recordedAt:'2026-09-13T01:00:02Z'};
  await receive({table:'provider_status'});await settle(4);assert.equal(routeCalls,2);
  gps={...gps,latitude:12.247,longitude:109.192,recordedAt:'2026-09-13T01:00:03Z'};
  await receive({table:'provider_status'});await settle(4);
  finishLateRoute();await settle();
  await receive({table:'missions'});await settle();
  await tasks.at(-1)();await settle();

  assert.equal(root.querySelector('[data-tracking-map]'),originalContainer);
  assert.equal(root.querySelector('[data-provider-marker]'),originalMarker);
  assert.equal(root.querySelectorAll('[data-provider-marker]').length,1);
  assert.equal(originalMarker.dataset.latitude,'12.247');assert.equal(originalMarker.dataset.longitude,'109.192');
  assert.equal(mapCreateCount,1);assert.equal(providerMarkerCreateCount,1);assert.equal(renderCount,1);
  assert.ok(providerMarkerMoveCount>=2);assert.ok(routeUpdateCount>=1);
  dom.window.close();
});
