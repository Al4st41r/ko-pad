// KO Pad service worker. Shell: stale-while-revalidate. Samples: cache-first.
const VERSION = 'v13';
const SHELL = `kopad-shell-${VERSION}`;
const SAMPLES = 'kopad-samples-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.json', 'sw.js',
  'js/app.js', 'js/audio.js', 'js/chop.js', 'js/data.js', 'js/look.js', 'js/model.js', 'js/offline.js', 'js/panels.js', 'js/seq.js', 'js/store.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kopad-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('.flac')) {
    e.respondWith(caches.open(SAMPLES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // App files: network first so the HTML, CSS and JS always come from the same release. The cache answers when offline or slow.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res.ok ? res : null; }).catch(() => null);
    const slow = new Promise((r) => setTimeout(r, 4000, null));
    return (await Promise.race([net, slow])) || (await c.match(req, { ignoreSearch: true })) || (await net) || new Response('Offline', { status: 503 });
  }));
});
