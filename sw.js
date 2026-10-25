// Offline support. The game's own files are fetched network-first so a new
// deploy shows up on the next load; three.js, the font and the icons never
// change, so they come from the cache first.
const CACHE = 'mini-golf-2-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/state.js',
  'js/storage.js',
  'js/audio.js',
  'js/ui.js',
  'js/map.js',
  'js/play.js',
  'js/input.js',
  'js/courses.js',
  'js/physics.js',
  'js/render.js',
  'js/terrain.js',
  'js/themes.js',
  'vendor/three.module.min.js',
  'vendor/fonts/fredoka-latin.woff2',
  'vendor/fonts/fredoka-latin-ext.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const stable = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');
  if (stable) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
    return;
  }
  e.respondWith(
    fetch(req)
      .then(res => put(req, res))
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
