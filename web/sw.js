// KO Pad service worker. Shell: stale-while-revalidate. Samples: cache-first.
const VERSION = 'v37';
const SHELL = `kopad-shell-${VERSION}`;
const SAMPLES = 'kopad-samples-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.json', 'sw.js',
  'js/app.js', 'js/audio.js', 'js/chop.js', 'js/data.js', 'js/look.js', 'js/model.js', 'js/offline.js', 'js/panels.js', 'js/params.js', 'js/seq.js', 'js/store.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // The catalogue is fetched on first install too, because the first page load asks for it before this worker controls the page. It is absent on a no-sounds deployment, so a failure is ignored.
  const cat = caches.open(SAMPLES).then(async (c) => { const r = await fetch('samples/catalogue.json', { cache: 'no-cache' }); if (r.ok) await c.put('samples/catalogue.json', r); }).catch(() => {});
  e.waitUntil(Promise.all([caches.open(SHELL).then((c) => c.addAll(ASSETS)), cat]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kopad-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // The catalogue lives in the persistent samples cache so it survives shell version bumps. Network first, cache when offline.
  if (url.pathname.endsWith('/samples/catalogue.json')) {
    e.respondWith(caches.open(SAMPLES).then(async (c) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch { return (await c.match(req)) || new Response('Offline', { status: 503 }); }
    }));
    return;
  }

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
    const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res.ok ? res : null; }).catch(() => null).finally(() => clearTimeout(timer));
    let timer; const slow = new Promise((r) => { timer = setTimeout(r, 4000, null); });
    return (await Promise.race([net, slow])) || (await c.match(req, { ignoreSearch: true })) || (await net) || new Response('Offline', { status: 503 });
  }));
});
