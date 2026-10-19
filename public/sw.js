// Service worker: keeps the app itself available with no signal.
// API calls are never cached (money data must be live); photos wait in the app's own queue.
// It also receives files shared into the app (Android "Share" -> Budget), see the share_target in the manifest.
const CACHE = 'budget-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Shared files go into the same IndexedDB queue the app uses (src/queue.ts), one receipt per file,
// then the app opens on Home and sends them like any photo.
function openQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('budget-queue', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'client_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => f && typeof f === 'object' && (f.type.startsWith('image/') || f.type === 'application/pdf'));
    if (files.length) {
      const db = await openQueue();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        for (const f of files) {
          tx.objectStore('photos').put({ client_id: newId(), blobs: [f], mode: 'full', name: f.name || 'shared', created_at: new Date().toISOString(), state: 'waiting' });
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    return Response.redirect('/#/home', 303);
  } catch (e) {
    return Response.redirect('/#/home', 303);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/share') {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: try the network, fall back to the saved copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built files have unique names, so a saved copy is always correct.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
