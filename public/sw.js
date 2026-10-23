/* eslint-env serviceworker */
/**
 * Service Worker de Bitly.
 *
 * Lo que hace:
 *   · Guarda el "esqueleto" de la app (la portada, el manifest y los iconos)
 *     para que la PWA abra aunque no haya red.
 *   · Navegaciones: red primero, caché como respaldo. Así quien llega con datos
 *     justos ve contenido al instante y aun sin señal no cae en el dinosaurio.
 *   · Assets con hash en el nombre (JS/CSS/fuentes/imagenes): caché primero.
 *     Al llevar hash en la URL nunca sirven viejos: si cambian, cambia la URL.
 *   · Nada de eso: `/_serverFn/` (las llamadas al servidor), el audio y los
 *     JSON de datos se salen siempre a la red, para que las opiniones y los
 *     contadores no queden congelados en un valor viejo.
 *
 * No cachea audio a propósito: sería la forma más directa de "descargar" la
 * canción desde la PWA, que es justo lo que no queremos.
 */

const VERSION = "bitly-v2";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_ESTATICOS = `${VERSION}-assets`;

const SHELL = [
  "/",
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
];

/** Rutas que NUNCA se guardan en caché. */
function sinCachear(url) {
  if (url.origin !== location.origin) return true;
  if (url.pathname.startsWith("/_serverFn/")) return true;
  if (url.pathname.startsWith("/api/")) return true;
  // Media: reproducir sí, guardar no.
  if (/\.(mp3|m4a|flac|ogg|opus|wav|aac|webm|mp4)(\?|$)/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((c) => Promise.allSettled(SHELL.map((ruta) => c.add(ruta))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((llaves) => Promise.all(llaves.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (sinCachear(url)) return;

  // Navegación: red primero, shell después. Con `reload` no se usa caché: quien
  // aprieta F5 quiere ver si algo cambió.
  if (request.mode === "navigate") {
    evento.respondWith(
      fetch(request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE_SHELL).then((c) => c.put("/", copia));
          return r;
        })
        .catch(async () => (await caches.match("/")) ?? (await caches.match(request)) ?? Response.error()),
    );
    return;
  }

  const esEstatico = /\.(js|mjs|css|woff2?|png|jpe?g|webp|avif|svg|ico)$/i.test(url.pathname);

  if (esEstatico) {
    evento.respondWith(
      caches.match(request).then(
        (guardado) =>
          guardado ||
          fetch(request).then((r) => {
            if (r.ok) {
              const copia = r.clone();
              caches.open(CACHE_ESTATICOS).then((c) => c.put(request, copia));
            }
            return r;
          }),
      ),
    );
    return;
  }

  // Todo lo demás (HTML de rutas, JSON de datos): red con respaldo en caché.
  evento.respondWith(
    fetch(request)
      .then((r) => {
        if (r.ok && r.type === "basic") {
          const copia = r.clone();
          caches.open(CACHE_ESTATICOS).then((c) => c.put(request, copia));
        }
        return r;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
