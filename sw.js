// Service worker: faz o app abrir rápido e funcionar sem internet.
//
// Estratégia:
//   arquivos do app   → tenta a rede primeiro (pega a versão nova); sem rede, usa a cópia guardada
//   fonte e biblioteca → usa a cópia guardada e atualiza em segundo plano
//   supabase / clima  → nunca guarda (dados sempre frescos; a fila offline é do próprio app)
//
// Ao mudar a lista de arquivos, aumente CACHE pra forçar a atualização.

const CACHE = 'mb-shell-v34';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/acervo.js', 'js/app.js', 'js/boot.js', 'js/cloud.js', 'js/commands.js', 'js/config.js',
  'js/core.js', 'js/dates.js', 'js/historico.js', 'js/state.js', 'js/store.js', 'js/tasks.js', 'js/terminal.js', 'js/tipos.js', 'js/views.js', 'js/ui.js', 'js/util.js', 'js/valores.js', 'js/weather.js',
  'icons/icon.svg', 'icons/icon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const LIVE = ['supabase.co', 'open-meteo.com'];
const RUNTIME = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (LIVE.some(h => url.hostname.endsWith(h))) return;

  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (RUNTIME.some(h => url.hostname.endsWith(h))) e.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // rede lenta demais? em 3s cai pra cópia guardada
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    throw new Error('offline e sem cópia: ' + req.url);
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req)
    .then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
    .catch(() => hit);
  return hit || update;
}
