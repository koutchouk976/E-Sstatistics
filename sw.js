// ── Caches ──────────────────────────────────────────
const APP_CACHE  = 'euromil-app-v2';    // fichiers statiques
const DATA_CACHE = 'euromil-data-v1';   // données API (géré par app.js)

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './euromillions_202002.csv'
];

// ── Installation : mise en cache des fichiers statiques ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activation : suppression des anciens caches app ──────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch : stratégie selon la requête ───────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Requête vers l'API EuroMillions → réseau d'abord, pas de cache SW
  // (le cache API est géré directement par app.js via CacheStorage)
  if (url.hostname === 'euromillions.api.pedromealha.dev') {
    e.respondWith(fetch(e.request).catch(() => new Response('[]')));
    return;
  }

  // Google Fonts → réseau d'abord, cache en fallback
  if (url.hostname.includes('fonts.')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(APP_CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Tous les autres assets → cache d'abord, réseau en fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Mettre en cache les nouvelles ressources statiques
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(APP_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
