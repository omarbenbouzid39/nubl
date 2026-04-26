/* ══════════════════════════════════════
   وَصْل — Service Worker
   Offline Mode + Caching Strategy
   ══════════════════════════════════════ */

const CACHE_NAME = 'wasl-v1.0';
const STATIC_CACHE = 'wasl-static-v1.0';
const DYNAMIC_CACHE = 'wasl-dynamic-v1.0';

/* الملفات التي يتم تخزينها مؤقتاً عند أول تثبيت */
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/home.html',
  '/about.html',
  '/blog.html',
  '/contact.html',
  '/privacy.html',
  '/style.css',
  '/shared-pages.css',
  '/script.js',
  '/shared.js',
  '/logo.png',
  '/manifest.json',
  '/article-ai-daily-life-uses.html',
  '/article-dev-tools-free.html',
  '/article-free-arabic-programming-platforms.html',
  '/article-freelance-guide-beginners.html',
  '/offline.html'
];

/* ─── Install: تخزين الملفات الأساسية ─── */
self.addEventListener('install', event => {
  console.log('[SW] Installing وَصْل Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .catch(err => console.warn('[SW] Some assets failed to cache:', err))
  );
  self.skipWaiting();
});

/* ─── Activate: حذف الكاشات القديمة ─── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

/* ─── Fetch: استراتيجية Cache First مع Network Fallback ─── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل طلبات غير HTTP
  if (!request.url.startsWith('http')) return;

  // تجاهل Socket.io وطلبات API الديناميكية
  if (url.pathname.startsWith('/socket.io') || 
      url.pathname.startsWith('/api') ||
      url.pathname.startsWith('/admin')) {
    return;
  }

  // للملفات الثابتة: Cache First
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirstStrategy(request));
  } 
  // للصفحات: Network First مع Cache Fallback
  else if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstStrategy(request));
  }
  // باقي الطلبات: Stale While Revalidate
  else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* ─── استراتيجيات الكاش ─── */

async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return getOfflineFallback(request);
  }
}

async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || getOfflineFallback(request);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise || getOfflineFallback(request);
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|mp4)$/i.test(url.pathname);
}

async function getOfflineFallback(request) {
  if (request.headers.get('accept')?.includes('text/html')) {
    const offlinePage = await caches.match('/offline.html');
    return offlinePage || new Response(
      `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head><meta charset="UTF-8"><title>وَصْل — غير متصل</title>
      <style>
        body { background: #0d0f14; color: #f1f5f9; font-family: 'Tajawal', sans-serif; 
               display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
        h1 { font-size: 2rem; color: #3b82f6; margin-bottom: 16px; }
        p { color: #8892a4; }
      </style></head>
      <body>
        <div>
          <div style="font-size:4rem;margin-bottom:16px">📡</div>
          <h1>أنت غير متصل بالإنترنت</h1>
          <p>تحقق من اتصالك وأعد المحاولة</p>
        </div>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response('', { status: 503 });
}

/* ─── Push Notifications (جاهز للمستقبل) ─── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'وَصْل', {
    body: data.body || 'لديك رسالة جديدة',
    icon: '/logo.png',
    badge: '/logo.png',
    dir: 'rtl',
    lang: 'ar'
  });
});
