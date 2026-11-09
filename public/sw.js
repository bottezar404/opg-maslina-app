// Jednostavan service worker: aplikacija se može instalirati na mobitel,
// a sučelje se učitava i kad je veza slaba. Podaci (Supabase) se uvijek dohvaćaju s interneta.
const CACHE = 'opg-maslina-v6';
const ASSETS = ['./', 'index.html', 'app.js', 'config.js', 'supabase.js', 'style.css', 'icon.svg', 'manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Podaci iz Supabasea uvijek idu izravno na poslužitelj, ne u predmemoriju
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
