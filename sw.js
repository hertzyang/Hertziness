const APP_CACHE = `app-cache`;
const SHELL_PATHS = ['/', '/app.js', '/style.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== APP_CACHE)
        .map((key) => caches.delete(key))
    );
    const cache = await caches.open(APP_CACHE);
    await refreshShellBundle(cache);
    await self.clients.claim();
  })());
});

function toAbsoluteUrl(path) {
  return new URL(path, self.location.origin).toString();
}

async function fetchShellBundle() {
  const responses = await Promise.all(
    SHELL_PATHS.map((path) => fetch(toAbsoluteUrl(path), { cache: 'no-store' }))
  );

  if (!responses.every((response) => response && response.ok)) {
    throw new Error('shell bundle fetch failed');
  }

  return responses;
}

async function writeShellBundle(cache, responses) {
  await Promise.all(
    SHELL_PATHS.map((path, index) => cache.put(toAbsoluteUrl(path), responses[index].clone()))
  );
}

async function refreshShellBundle(cache) {
  try {
    const responses = await fetchShellBundle();
    await writeShellBundle(cache, responses);
    return { ok: true, rootResponse: responses[0] };
  } catch (error) {
    return { ok: false, rootResponse: null };
  }
}

async function handleRootRequest(event) {
  const cache = await caches.open(APP_CACHE);
  const cachedRoot = await cache.match(toAbsoluteUrl('/'));

  if (!cachedRoot) {
    const firstLoad = await refreshShellBundle(cache);
    if (firstLoad.ok && firstLoad.rootResponse) {
      return firstLoad.rootResponse;
    }
    return fetch(toAbsoluteUrl('/'));
  }

  event.waitUntil(refreshShellBundle(cache));
  return cachedRoot;
}

async function serveNoCacheWrite(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  return fetch(request);
}

async function staleWhileRevalidate(request, cacheName, options = {}) {
  const { skipRevalidateIfCached = false } = options;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    if (skipRevalidateIfCached) {
      return cached;
    }
    const fetchPromise = fetch(request).then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    });
    fetchPromise.catch(() => {});
    return cached;
  }

  const fetchPromise = fetch(request).then((response) => {
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  });
  return fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(handleRootRequest(event));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname === '/app.js' || url.pathname === '/style.css')) {
    event.respondWith(serveNoCacheWrite(request));
    return;
  }

  const skipRevalidateIfCached =
    (url.pathname.includes('model.onnx.gz.'));

  event.respondWith(staleWhileRevalidate(request, APP_CACHE, { skipRevalidateIfCached }));
});
