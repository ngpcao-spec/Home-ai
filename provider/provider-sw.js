const BUILD_ID = '__HOME_AI_BUILD_ID__';
const CACHE_PREFIX = 'home-ai-pwa-provider-';
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_ASSETS = new Set([
  './', './index.html', './provider-manifest.webmanifest', '../provider-icon.svg',
  '../src/provider/provider-app.css', '../src/provider/provider-auth.css', '../src/provider/provider-navigation.css',
  '../src/provider/provider-quote.css', '../src/provider/provider-dispatch.css', '../src/location/location-permission.css',
  '../src/provider/provider-activities.css',
  '../src/provider/provider-app.js', '../src/provider/provider-dispatch.js', '../src/provider/provider-repository.js',
  '../src/provider/provider-navigation.js', '../src/provider/provider-auth.js', '../src/provider/provider-location-heartbeat.js',
  '../src/provider/provider-activities.js', '../src/provider/provider-activity-ai.js',
  '../src/calls/call-manager.js', '../src/calls/stringee-client.js', '../src/calls/stringee-sdk.js',
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
