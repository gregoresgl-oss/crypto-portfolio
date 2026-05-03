// GGWALL Service Worker v3.0
// Push notification reliability fixes:
//  - Always show a notification when push event fires (even με null data)
//  - Robust error handling — no silent failures
//  - Fallback values για title/body/icon
//  - Use site icons paths που σίγουρα υπάρχουν
const CACHE = 'ggwall-v3.0';
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

  // CDN scripts: network first, cache fallback
  if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net') ||
      url.includes('unpkg.com') || url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request).then(res => {
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

// ── Push notification handler ────────────────────────────────────────────────
// CRITICAL: Browser MUST see showNotification() called within ~30s of every
// push event. Otherwise it marks the push as "silent", and after 2-3 silent
// pushes, it can revoke the subscription. We always call showNotification(),
// even when payload data is missing/malformed.
self.addEventListener('push', e => {
  let title = 'GGWALL';
  let body  = 'Νέα ειδοποίηση';
  let payload = {};

  // Try to parse incoming data — but never fail
  try {
    if (e.data) {
      try { payload = e.data.json(); }
      catch (_) { payload = { title: 'GGWALL', body: e.data.text() }; }
    }
  } catch (_) { /* keep defaults */ }

  if (payload && typeof payload === 'object') {
    if (payload.title) title = String(payload.title);
    if (payload.body)  body  = String(payload.body);
    else if (payload.message) body = String(payload.message);
  }

  const opts = {
    body: body,
    icon: '/crypto-portfolio/icon192.png',
    badge: '/crypto-portfolio/icon192.png',
    tag:   payload.tag || ('ggwall-' + Date.now()),
    data:  payload,
    vibrate: [120, 60, 120],
    requireInteraction: payload.requireInteraction === true,
    silent: false,
  };

  // Wrap σε waitUntil + αλυσίδα catch ώστε αν αποτύχει η εμφάνιση,
  // ξανά-προσπαθούμε με minimum payload για να μη χαθεί το event.
  e.waitUntil(
    self.registration.showNotification(title, opts).catch(err => {
      console.error('[GGWALL SW] showNotification failed:', err);
      return self.registration.showNotification('GGWALL', { body: 'Νέα ειδοποίηση' });
    })
  );
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

// ── Subscription change handler ──────────────────────────────────────────────
// Όταν το browser ανανεώσει αυτόματα την push subscription (rotated keys, etc),
// επανεγγραφόμαστε με τα ίδια keys αυτόματα. Χωρίς αυτό, οι users χάνουν τα
// notifications μέχρι να επαναφορτώσουν το app και να επανεγγραφούν χειροκίνητα.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: e.oldSubscription
        ? e.oldSubscription.options.applicationServerKey
        : undefined,
    }).then(newSub => {
      // Notify the page so it can update push_subscriptions table
      return self.clients.matchAll({type:'window', includeUncontrolled:true}).then(clients => {
        for (const c of clients) {
          c.postMessage({
            type: 'PUSH_RESUBSCRIBED',
            old: e.oldSubscription?.endpoint,
            new: newSub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(newSub.getKey('p256dh')))),
              auth:   btoa(String.fromCharCode.apply(null, new Uint8Array(newSub.getKey('auth')))),
            },
          });
        }
      });
    }).catch(err => console.error('[GGWALL SW] Resubscribe failed:', err))
  );
});
