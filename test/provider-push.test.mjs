import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProviderPushManager,renderProviderPushPrompt,PROVIDER_PUSH_FOREGROUND_HEARTBEAT_MS} from '../src/provider/provider-push.js';
import {VAPID_PUBLIC_KEY as publicKey} from '../supabase/functions/_shared/provider-push-config.js';
import {shouldSendProviderPush} from '../supabase/functions/_shared/provider-push-message.js';

const makeEnv=({standalone=true,permission='default',existing=false,permissionResult='granted',expired=false}={})=>{
  const store=new Map();let permissionCalls=0,subscribeCalls=0,unsubscribeCalls=0;const listeners=new Map();const intervals=new Map();let nextIntervalId=0;
  const subscription={endpoint:'https://push.example/subscription',expirationTime:expired?Date.now()-1:null,unsubscribe:async()=>{unsubscribeCalls++;existing=false;},toJSON:()=>({endpoint:'https://push.example/subscription',keys:{p256dh:'p'.repeat(40),auth:'a'.repeat(20)}})};
  const pushManager={getSubscription:async()=>existing?subscription:null,subscribe:async options=>{subscribeCalls++;assert.equal(options.userVisibleOnly,true);existing=true;return subscription;}};
  const environment={isSecureContext:true,PushManager:function(){},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},matchMedia:()=>({matches:standalone}),Notification:{permission,requestPermission:async()=>{permissionCalls++;environment.Notification.permission=permissionResult;return permissionResult;}},navigator:{serviceWorker:{ready:Promise.resolve({pushManager})}},document:{visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},location:{href:'https://example.com/Home-ai/provider/'},history:{replaceState(){}},setInterval:(callback,delay)=>{const id=++nextIntervalId;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id)};
  return {environment,permissionCalls:()=>permissionCalls,subscribeCalls:()=>subscribeCalls,unsubscribeCalls:()=>unsubscribeCalls,listeners,intervals,tick:()=>{for(const {callback} of [...intervals.values()])callback();},setVisible:value=>{environment.document.visibilityState=value?'visible':'hidden';listeners.get('visibilitychange')?.();}};
};

test('first installed PWA launch asks once in HOME AI and explicit acceptance creates the subscription',async()=>{
  const calls=[];const env=makeEnv();const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async value=>calls.push(value),touchPush:async()=>{}}});
  const initial=await manager.start();assert.equal(initial.status,'prompt');assert.match(renderProviderPushPrompt(initial),/Bật thông báo để nhận nhiệm vụ mới/);assert.match(renderProviderPushPrompt(initial),/Cho phép thông báo/);assert.equal(env.permissionCalls(),0);
  const enabled=await manager.enable();assert.equal(enabled.status,'enabled');assert.equal(renderProviderPushPrompt(enabled),'');assert.equal(env.permissionCalls(),1);assert.equal(env.subscribeCalls(),1);assert.equal(calls.length,1);assert.equal(calls[0].endpoint,'https://push.example/subscription');
});

test('multiple activation clicks share one permission request and one registration',async()=>{
  const calls=[];const env=makeEnv();let release;env.environment.Notification.requestPermission=()=>new Promise(resolve=>{release=()=>{env.environment.Notification.permission='granted';resolve('granted');};});
  const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async value=>calls.push(value),touchPush:async()=>{}}});
  const first=manager.enable();const second=manager.enable();release();await Promise.all([first,second]);assert.equal(env.subscribeCalls(),1);assert.equal(calls.length,1);
});

test('reload with granted permission reuses and synchronizes the existing subscription without prompting',async()=>{
  const calls=[];const env=makeEnv({permission:'granted',existing:true});const states=[];
  const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async value=>calls.push(value),touchPush:async()=>{}}});
  assert.equal((await manager.start(state=>states.push(state.status))).status,'enabled');assert.equal(env.permissionCalls(),0);assert.equal(env.subscribeCalls(),0);assert.equal(calls.length,1);assert.deepEqual(states,['enabled']);
});

test('granted permission recreates a missing subscription automatically',async()=>{
  const calls=[];const env=makeEnv({permission:'granted',existing:false});
  const state=await createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async value=>calls.push(value),touchPush:async()=>{}}}).start();
  assert.equal(state.status,'enabled');assert.equal(env.permissionCalls(),0);assert.equal(env.subscribeCalls(),1);assert.equal(calls.length,1);
});

test('granted permission replaces an explicitly expired browser subscription',async()=>{
  const calls=[];const env=makeEnv({permission:'granted',existing:true,expired:true});const state=await createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async value=>calls.push(value),touchPush:async()=>{}}}).start();
  assert.equal(state.status,'enabled');assert.equal(env.unsubscribeCalls(),1);assert.equal(env.subscribeCalls(),1);assert.equal(calls.length,1);
});

test('iPhone Safari outside the installed PWA shows installation guidance without requesting permission',async()=>{
  const env=makeEnv({standalone:false});const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{}});const state=await manager.start();
  assert.equal(state.status,'install-required');assert.match(renderProviderPushPrompt(state),/Màn hình chính/);assert.doesNotMatch(renderProviderPushPrompt(state),/data-enable-provider-push/);assert.equal(env.permissionCalls(),0);
});

test('denied permission stays discreet and never loops through requestPermission',async()=>{
  const env=makeEnv({permission:'denied'});const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{}});
  const state=await manager.start();assert.equal(state.status,'denied');assert.match(renderProviderPushPrompt(state),/Thông báo hệ thống đang bị tắt/);assert.doesNotMatch(renderProviderPushPrompt(state),/data-enable-provider-push/);assert.equal((await manager.enable()).status,'denied');assert.equal(env.permissionCalls(),0);
});

test('push lifecycle is independent from Provider Online or Offline state',async()=>{
  const source=readFileSync(new URL('../src/provider/provider-app.js',import.meta.url),'utf8');assert.doesNotMatch(source,/pushManager\.(?:enable|state)\([^)]*online/i);assert.match(source,/setAvailability\(\{online:next,available:next&&!state\.assignment\}\)/);
});

test('logout revokes only the current installation and login can resynchronize it',async()=>{
  const revoked=[];const registered=[];const env=makeEnv({permission:'granted',existing:true});const repository={registerPush:async value=>registered.push(value),touchPush:async()=>{},revokePush:async id=>revoked.push(id)};const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository});
  await manager.start();await manager.revoke();await manager.state();assert.equal(revoked.length,1);assert.equal(registered.length,2);assert.equal(revoked[0],registered[0].installationId);
});

test('profile no longer contains notification controls',()=>{
  const source=readFileSync(new URL('../src/provider/provider-app.js',import.meta.url),'utf8');assert.doesNotMatch(source,/renderProviderPushSettings|Thông báo nhiệm vụ|Bật thông báo/);
});

test('visible Provider renews one foreground lease every 15 seconds for over two minutes',async()=>{
  const env=makeEnv({permission:'granted',existing:true});let now=Date.parse('2026-09-20T12:00:00Z');let foregroundUntil=null;const touches=[];
  const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async()=>{},touchPush:async(_id,foreground)=>{touches.push(foreground);foregroundUntil=foreground?new Date(now+45000).toISOString():null;}}});
  await manager.start();await new Promise(setImmediate);
  assert.equal(env.intervals.size,1);assert.equal([...env.intervals.values()][0].delay,PROVIDER_PUSH_FOREGROUND_HEARTBEAT_MS);
  for(let count=0;count<9;count++){now+=PROVIDER_PUSH_FOREGROUND_HEARTBEAT_MS;env.tick();await new Promise(setImmediate);assert.equal(shouldSendProviderPush({foreground_until:foregroundUntil},now),false);}
  assert.equal(now-Date.parse('2026-09-20T12:00:00Z'),135000);
  assert.equal(touches.length,10);assert.ok(touches.every(Boolean));
  manager.stop();await new Promise(setImmediate);assert.equal(env.intervals.size,0);
});

test('hidden clears the lease immediately, stops heartbeat, and visible resumes one timer',async()=>{
  const env=makeEnv({permission:'granted',existing:true});let now=Date.parse('2026-09-20T12:00:00Z');let foregroundUntil=null;const touches=[];
  const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async()=>{},touchPush:async(_id,foreground)=>{touches.push(foreground);foregroundUntil=foreground?new Date(now+45000).toISOString():null;}}});
  await manager.start();await new Promise(setImmediate);
  env.setVisible(false);await new Promise(setImmediate);
  assert.equal(touches.at(-1),false);assert.equal(foregroundUntil,null);assert.equal(env.intervals.size,0);
  assert.equal(shouldSendProviderPush({foreground_until:foregroundUntil},now),true);
  env.tick();assert.equal(touches.at(-1),false);
  env.setVisible(true);await new Promise(setImmediate);
  assert.equal(touches.at(-1),true);assert.equal(env.intervals.size,1);
  env.setVisible(true);await new Promise(setImmediate);assert.equal(env.intervals.size,1);
  now+=46000;assert.equal(shouldSendProviderPush({foreground_until:foregroundUntil},now),true);
  manager.stop();await new Promise(setImmediate);assert.equal(env.intervals.size,0);
});

test('foreground heartbeats do not send concurrent touch RPCs',async()=>{
  const env=makeEnv({permission:'granted',existing:true});let resolveTouch;let calls=0;let concurrent=0;let maxConcurrent=0;
  const manager=createProviderPushManager({environment:env.environment,vapidPublicKey:publicKey,repository:{registerPush:async()=>{},touchPush:()=>{calls++;concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);return new Promise(resolve=>{resolveTouch=()=>{concurrent--;resolve();};});}}});
  await manager.start();env.tick();env.tick();env.tick();assert.equal(calls,1);
  resolveTouch();await new Promise(setImmediate);assert.equal(calls,2);assert.equal(maxConcurrent,1);
  resolveTouch();await new Promise(setImmediate);manager.stop();resolveTouch();await new Promise(setImmediate);
});

test('Service Worker uses an opaque reference, deduplicated notification tag and reloads truth after click',()=>{const source=readFileSync(new URL('../provider/provider-sw.js',import.meta.url),'utf8');assert.match(source,/addEventListener\('push'/);assert.match(source,/showNotification/);assert.match(source,/home-ai-offer-\$\{data\.offerRef\}/);assert.match(source,/notificationclick/);assert.match(source,/push_offer/);for(const forbidden of ['phone','clientName','latitude','longitude','address'])assert.doesNotMatch(source,new RegExp(forbidden,'i'));});
