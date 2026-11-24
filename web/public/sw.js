// Service worker: app shell em cache (abre instantâneo e offline).
// Os dados vêm do Supabase e ficam em cache no localStorage pela app.
const CACHE = "daily-hub-v1";
// Caminhos relativos ao scope (funciona em possn.github.io/<repo>/).
const ROOT = new URL("./", self.registration.scope).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([ROOT, ROOT + "manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // Supabase: sempre rede
  if (e.request.mode === "navigate") {
    // Rede primeiro para o HTML (apanha versões novas), cache se offline
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(ROOT, copy));
          return r;
        })
        .catch(() => caches.match(ROOT)),
    );
    return;
  }
  // Assets com hash: cache primeiro
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        }),
    ),
  );
});
