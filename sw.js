/* Service worker：App shell 快取優先、資料網路優先（離線回退最後一次快取）。
   改動任何 shell 檔案時，把 VERSION 加一，使用者下次開啟即自動更新。 */
const VERSION = 'v5';
const SHELL_CACHE = `fog-shell-${VERSION}`;
const DATA_CACHE = `fog-data-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-180.png',
  './icons/favicon-32.png',
];

// 視為「資料」的請求：網路優先、可離線回退
const DATA_RE = /(today|history|observations)\.json(\?|$)|\/api\/(today|history|observations|preview)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
        .map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 資料：網路優先，成功就更新快取；失敗回退快取
  if (DATA_RE.test(url.href)) {
    e.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(DATA_CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // 導航：離線時回退到 index.html
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // App shell 及其他：快取優先，背景更新
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
