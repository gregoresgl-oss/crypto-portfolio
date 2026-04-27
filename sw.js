// GGWALL Service Worker v2.8
const CACHE = 'ggwall-v2.8';
const ASSETS = [
  '/crypto-portfolio/manifest.json',
  '/crypto-portfolio/icon192.png',
  '/crypto-portfolio/icon512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Skip non-http(s) schemes (chrome-extension://, moz-extension://, etc)
  // These cannot be cached and cause errors
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // ALL HTML files: always network first (never serve stale)
  if (url.includes('.html') ||
      url.endsWith('/crypto-portfolio/') || url.endsWith('/crypto-portfolio')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-cache'}).catch(() => caches.match(e.request))
    );
    return;
  }

  // API calls: network only
  if (url.includes('coingecko.com') || url.includes('cosmos.directory') ||
      url.includes('alternative.me') || url.includes('koios.rest') ||
      url.includes('coinmarketcap.com') || url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', {headers:{'Content-Type':'application/json'}})));
    return;
  }

  // CDN scripts (Chart.js, lucide, etc): network first, cache fallback
  // This prevents corrupt/opaque cached responses from breaking the app
  if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net') ||
      url.includes('unpkg.com') || url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request).then(res => {
        // Only cache valid, non-opaque responses
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Same-origin assets: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => cached))
  );
});

// Push notification handler
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch(err) { data = {title:'GGWALL', body: e.data.text()}; }
  const opts = {
    body: data.body || data.message || '',
    icon: '/crypto-portfolio/icon.svg',
    badge: '/crypto-portfolio/icon.svg',
    tag: data.tag || 'ggwall-' + Date.now(),
    data: data,
    vibrate: [120, 60, 120],
    requireInteraction: data.requireInteraction || false,
  };
  e.waitUntil(self.registration.showNotification(data.title || 'GGWALL', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/crypto-portfolio/')) {
          c.focus();
          c.postMessage({type:'NOTIF_CLICK', data: e.notification.data});
          return;
        }
      }
      return self.clients.openWindow('/crypto-portfolio/?notif=1');
    })
  );
});
