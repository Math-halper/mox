/* Mox service worker: network-first, with an offline fallback cache.
 *
 * The app is a static site, so a reload with no connection should still work.
 * Network-first is deliberate: whenever the browser is online it gets the
 * current files (no stale UI after a deploy), and the cache only answers when
 * the network fails. The 94 MB model is not cached here — the browser's own
 * HTTP cache handles it, and the engine keeps its copy of the weights.
 */
const CACHE = 'mox-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calculator.js',
  './svg.js',
  './workspace.js',
  './model-store.js',
  './knowledge/index.json',
  './models/manifest.json',
  './vendor/wllama/wllama.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Weights and wasm binaries are large and immutable: let the HTTP cache own them.
  if (/\.(gguf|wasm)$/i.test(url.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
