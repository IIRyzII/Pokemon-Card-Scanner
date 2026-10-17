// PokéVault service worker: makes the app installable and usable offline.
// - Install: precache the app shell (index.html + the files it references) and the card catalog.
// - Pages: network-first, falling back to the cached shell when offline.
// - App files (content-hashed by Vite): cache-first.
// - Catalog: meta.json network-first; catalog.json?v=<hash> and prints.bin?v=<hash> (card picture
//   fingerprints for the scanner) cache-first, old versions pruned.
// - OCR engine files: cache-first. Card images use the browser's HTTP cache (immutable for a year).
// - API calls are never cached.

const VERSION = 'v2';
const SHELL = `pokevault-shell-${VERSION}`;
const OCR = 'pokevault-ocr-v1';
const KEEP = [SHELL, OCR];
const MAX_SHELL_ENTRIES = 80;

const scoped = (path) => new URL(path, self.registration.scope).href;

async function precache() {
  const cache = await caches.open(SHELL);
  const res = await fetch(scoped('./'), { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(scoped('./'), res);
  const files = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((m) => scoped(m[1]));
  await cache.addAll([...new Set(files)]);
  try {
    const meta = await (await fetch(scoped('./catalog/meta.json'), { cache: 'no-cache' })).json();
    await cache.add(scoped(`./catalog/catalog.json?v=${meta.hash}`));
  } catch {
    // the page will cache the catalog the first time it loads it
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch((err) => console.warn('precache failed', err)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!KEEP.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((k) => new URL(k.url).pathname.includes('/assets/'));
  for (let i = 0; i < assets.length - MAX_SHELL_ENTRIES; i++) await cache.delete(assets[i]);
}

async function cacheFirst(request, cacheName, onStore) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (onStore) await onStore(cache);
  }
  return response;
}

async function networkFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key ?? request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(key ?? request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL, scoped('./')));
    } else if (url.pathname.endsWith('/catalog/meta.json')) {
      event.respondWith(networkFirst(request, SHELL));
    } else if ((url.pathname.endsWith('/catalog/catalog.json') || url.pathname.endsWith('/catalog/prints.bin')) && url.searchParams.has('v')) {
      // Keep only the newest catalog version.
      const pruneOld = async (cache) => {
        for (const key of await cache.keys()) {
          const k = new URL(key.url);
          if (k.pathname === url.pathname && k.search !== url.search) await cache.delete(key);
        }
      };
      event.respondWith(cacheFirst(request, SHELL, pruneOld));
    } else if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/') || url.pathname.endsWith('.webmanifest')) {
      event.respondWith(cacheFirst(request, SHELL, trim));
    }
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' && /tesseract/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, OCR));
  }
});
