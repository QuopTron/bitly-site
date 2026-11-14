// Service Worker de la app Bitly servida en /app/.
//
// Este archivo es la copia que el sitio instala sobre el bundle descargado de
// gh-pages. El bundle viejo traía rutas absolutas ("/index.html"), que bajo
// /app/ cacheaban la portada del SITIO y dejaban la app sin assets (pantalla en
// blanco en Huawei/Safari). Todo se resuelve contra el scope del SW.
//
// Mantener en sincronía con `bitly/web/service_worker.js`.

const CACHE_NAME = "bitly-app-v3";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.png",
  "./icons/Icon-192.png",
  "./icons/Icon-512.png",
  "./main.dart.js",
  "./flutter.js",
  "./flutter_bootstrap.js",
];

function urlDelScope(ruta) {
  return new URL(ruta, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE.map(urlDelScope)))
      .catch((err) => console.log("[SW] Cache install fallback:", err)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Solo GET del mismo origen dentro del scope de la app.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  // El backend RPC y las APIs del demo no se cachean.
  if (
    url.pathname.endsWith("/rpc") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/search") ||
    url.pathname.startsWith("/stream") ||
    url.pathname.startsWith("/cover") ||
    url.pathname.startsWith("/download") ||
    url.pathname.startsWith("/feed") ||
    url.pathname === "/ping" ||
    url.pathname === "/health"
  ) {
    return;
  }

  // Navegación: red primero (para recibir builds nuevos), caché si no hay red.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copia = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return response;
        })
        .catch(() => caches.match(urlDelScope("./index.html"))),
    );
    return;
  }

  // Assets de Flutter: caché primero, y se guarda lo que llegue de la red.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copia = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return response;
        })
        .catch(() => caches.match(urlDelScope("./index.html")));
    }),
  );
});
