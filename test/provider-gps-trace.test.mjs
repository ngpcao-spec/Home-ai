import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderLocationHeartbeat } from '../src/provider/provider-location-heartbeat.js';

test('temporary Provider GPS trace records the pipeline without coordinates or IDs', async () => {
  const traces=[];const writes=[];let callback;let state={status:{online:true},assignment:{status:'travelling'}};
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async position=>{writes.push(position);return{};}},
    getState:()=>state,
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    onTrace:record=>traces.push(record),
  });
  heartbeat.sync();
  assert.equal(traces.filter(record=>record.event==='GPS_WATCH_STARTED').length,1);
  await callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  assert.deepEqual(traces.map(record=>record.event).filter(event=>event!=='GPS_STATE_MODE'),[
    'GPS_WATCH_STARTED','GPS_CALLBACK','GPS_ACCEPTED','GPS_QUEUE','GPS_QUEUE',
    'GPS_UPDATELOCATION_CALL','GPS_UPDATELOCATION_SUCCESS',
  ]);
  const mode=traces.find(record=>record.event==='GPS_STATE_MODE'&&record.mode==='tracking');
  assert.deepEqual(Object.keys(mode).sort(),[
    'event','at','mode','stopped','repositorySource','online','assignmentStatus','documentHidden','pageActive',
  ].sort());
  assert.equal(mode.repositorySource,'supabase');
  assert.equal(traces.every(record=>Number.isFinite(Date.parse(record.at))),true);
  assert.equal(JSON.stringify(traces).includes('12.245'),false);
  await callback({coords:{latitude:12.245001,longitude:109.190001},timestamp:11000});
  assert.equal(traces.some(record=>record.event==='GPS_THROTTLED'),true);
  const pending=callback({coords:{latitude:12.246,longitude:109.191},timestamp:13000});
  state={status:{online:false},assignment:{status:'travelling'}};
  await pending;
  assert.equal(traces.some(record=>record.event==='GPS_QUEUE'&&record.outcome==='skipped'),true);
  assert.equal(traces.some(record=>record.event==='GPS_STATE_MODE'&&record.mode==='off'&&!record.online),true);
  assert.equal(writes.length,1);
  heartbeat.stop();
});

test('temporary Provider GPS trace reports failed updateLocation without error text', async () => {
  const traces=[];let callback;
  const heartbeat=createProviderLocationHeartbeat({
    repository:{source:'supabase',updateLocation:async()=>{const error=new Error('Authorization secret and coordinates');error.code='42501';throw error;}},
    getState:()=>({status:{online:true},assignment:{status:'travelling'}}),
    geolocation:{watchPosition(success){callback=success;return 1;},clearWatch(){}},
    onTrace:record=>traces.push(record),onError() {},
  });
  heartbeat.sync();
  await callback({coords:{latitude:12.245,longitude:109.19},timestamp:10000});
  assert.deepEqual(traces.find(record=>record.event==='GPS_UPDATELOCATION_ERROR')?.code,'42501');
  assert.equal(JSON.stringify(traces).includes('Authorization'),false);
  assert.equal(JSON.stringify(traces).includes('12.245'),false);
  heartbeat.stop();
});
