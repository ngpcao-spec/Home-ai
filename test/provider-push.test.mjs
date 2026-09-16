import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProviderPushManager,renderProviderPushPrompt} from '../src/provider/provider-push.js';
import {VAPID_PUBLIC_KEY as publicKey} from '../supabase/functions/_shared/provider-push-config.js';

const makeEnv=({standalone=true,permission='default',existing=false,permissionResult='granted',expired=false}={})=>{
  const store=new Map();let permissionCalls=0,subscribeCalls=0,unsubscribeCalls=0;const listeners=new Map();
  const subscription={endpoint:'https://push.example/subscription',expirationTime:expired?Date.now()-1:null,unsubscribe:async()=>{unsubscribeCalls++;existing=false;},toJSON:()=>({endpoint:'https://push.example/subscription',keys:{p256dh:'p'.repeat(40),auth:'a'.repeat(20)}})};
  const pushManager={getSubscription:async()=>existing?subscription:null,subscribe:async options=>{subscribeCalls++;assert.equal(options.userVisibleOnly,true);existing=true;return subscription;}};
  const environment={isSecureContext:true,PushManager:function(){},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},matchMedia:()=>({matches:standalone}),Notification:{permission,requestPermission:async()=>{permissionCalls++;environment.Notification.permission=permissionResult;return permissionResult;}},navigator:{serviceWorker:{ready:Promise.resolve({pushManager})}},document:{visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:()=>{}},location:{href:'https://example.com/Home-ai/provider/'},history:{replaceState(){}},setInterval:()=>1,clearInterval(){}};
  return {environment,permissionCalls:()=>permissionCalls,subscribeCalls:()=>subscribeCalls,unsubscribeCalls:()=>unsubscribeCalls,listeners};
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

test('Service Worker uses an opaque reference, deduplicated notification tag and reloads truth after click',()=>{const source=readFileSync(new URL('../provider/provider-sw.js',import.meta.url),'utf8');assert.match(source,/addEventListener\('push'/);assert.match(source,/showNotification/);assert.match(source,/home-ai-offer-\$\{data\.offerRef\}/);assert.match(source,/notificationclick/);assert.match(source,/push_offer=/);for(const forbidden of ['phone','clientName','latitude','longitude','address'])assert.doesNotMatch(source,new RegExp(forbidden,'i'));});
