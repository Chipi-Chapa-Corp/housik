import { self } from '$app/service-worker';
import { version } from '$app/env';
import { immutable } from '$app/manifest';

const prefix = 'housik-public-';
const cacheName = `${prefix}${version}`;
const publicFiles = [
  'offline.html',
  'manifest.webmanifest',
  'favicon.svg',
  'fonts/onest.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
  ...immutable.map((file) => file.path)
].map((path) => new URL(path, self.registration.scope).href);
const cacheable = new Set(publicFiles);
const offlineUrl = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(publicFiles)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Authenticated pages, data, receipts and all mutations always use the network.
  // Only a failed document navigation receives the public offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(cacheName);
        return (await cache.match(offlineUrl)) ?? Response.error();
      })
    );
  } else if (cacheable.has(request.url)) {
    event.respondWith(
      caches.open(cacheName).then(async (cache) => (await cache.match(request)) ?? fetch(request))
    );
  }
});
