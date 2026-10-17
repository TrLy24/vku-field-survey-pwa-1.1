const CACHE_NAME = "vku-field-survey-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async asset => {
      const assetUrl = new URL(asset, self.registration.scope);
      const refreshUrl = new URL(assetUrl);
      refreshUrl.searchParams.set("precache", CACHE_NAME);
      const response = await fetch(new Request(refreshUrl, { cache: "reload" }));
      if (!response.ok) throw new Error(`Unable to precache ${asset}: ${response.status}`);
      await cache.put(assetUrl, response);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response.ok) return response;
        return caches.open(CACHE_NAME).then(cache =>
          cache.put(event.request, response.clone()).then(() => response)
        );
      }).catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        throw new Error("Tài nguyên chưa có trong bộ nhớ ngoại tuyến.");
      });
    })
  );
});
