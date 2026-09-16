const BUILD_ID = '__HOME_AI_BUILD_ID__';
const CACHE_PREFIX = 'home-ai-pwa-provider-';
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_ASSETS = new Set([
  './', './index.html', './provider-manifest.webmanifest', '../provider-icon.svg',
  '../src/provider/provider-app.css', '../src/provider/provider-auth.css', '../src/provider/provider-navigation.css',
  '../src/provider/provider-quote.css', '../src/provider/provider-dispatch.css', '../src/location/location-permission.css',
  '../src/provider/provider-activities.css',
  '../src/provider/provider-app.js', '../src/provider/provider-dispatch.js', '../src/provider/provider-repository.js',
  '../src/provider/provider-navigation.js', '../src/provider/provider-arrival.js', '../src/provider/provider-auth.js', '../src/provider/provider-location-heartbeat.js',
  '../src/provider/provider-activities.js', '../src/provider/provider-activity-ai.js',
  '../src/provider/provider-push.js',
  '../src/provider/provider-rating.js',
  '../src/chat/mission-chat.js', '../src/chat/mission-chat-repository.js', '../src/chat/mission-chat.css', '../src/calls/call-manager.js', '../src/calls/stringee-client.js', '../src/calls/stringee-sdk.js',
  '../src/calls/call-audio.js', '../src/calls/mission-call.css',
  '../src/provider/mock-provider-data.js', '../src/location/location-permission.js', '../src/map/map-provider.js',
  '../src/routing/routing-provider.js', '../src/location/client-location.js',
]);
const offlinePaths = new Set([...OFFLINE_ASSETS].map(asset => new URL(asset, self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !offlinePaths.has(url.pathname)) return;
  event.respondWith(networkFirst(event.request));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()??{};}catch{return;}
  if(data.type!=='mission_offer'||!data.offerRef)return;
  event.waitUntil(self.registration.showNotification(data.title??'HOME AI — Nhiệm vụ mới',{body:data.body??'Có nhiệm vụ mới gần bạn.',icon:'../provider-icon.svg',badge:'../provider-icon.svg',tag:`home-ai-offer-${data.offerRef}`,renotify:true,data:{type:'mission_offer',offerRef:data.offerRef}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const ref=event.notification.data?.offerRef;if(!ref)return;
  const target=new URL(`./?push_offer=${encodeURIComponent(ref)}`,self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const provider=clients.find(client=>new URL(client.url).pathname.startsWith(new URL(self.registration.scope).pathname));if(provider){await provider.focus();provider.postMessage({type:'mission_offer_push',offerRef:ref});return;}await self.clients.openWindow(target);}));
});
