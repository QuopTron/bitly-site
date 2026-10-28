#!/usr/bin/env node
/**
 * Deja el build listo para Cloudflare PAGES en MODO AVANZADO.
 *
 * Por qué existe: `pnpm build` saca `dist/client` (estático) y `dist/server`
 * (el entry `{ fetch(request, env, ctx) }` con las server functions). Pages
 * publica `dist/client`, así que el RPC de la demo quedaba en 405: la búsqueda
 * no funcionaba en el sitio en vivo aunque sí en desarrollo.
 *
 * En modo avanzado, un `_worker.js` en la raíz de la carpeta publicada pasa a
 * manejar las peticiones. Este script:
 *   1. copia el bundle del servidor a `dist/client/_ssr/`;
 *   2. escribe `dist/client/_worker.js`, que delega primero el tráfico de
 *      archivos al CDN (`env.ASSETS`) y el resto a la app.
 *
 * `_worker.js` no se publica como estático, pero `_ssr/` SÍ: Pages sirve esa
 * carpeta con su Content-Type real. Por eso el entry bloquea `/_ssr/*` antes de
 * llegar al CDN — el import del bundle ocurre en el bundler, no por HTTP, así
 * que cortar esa ruta no rompe nada.
 *
 * Corre solo, como `postbuild` de `pnpm build`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliente = path.join(raiz, "dist", "client");
const servidor = path.join(raiz, "dist", "server");
const ssr = path.join(cliente, "_ssr");

if (!fs.existsSync(path.join(servidor, "server.js")) || !fs.existsSync(cliente)) {
  console.error("[cf] Falta dist/{client,server}: corré `pnpm build` primero.");
  process.exit(1);
}

// 1. El bundle del servidor viaja DENTRO de lo que se publica (Pages no deja
//    que `_worker.js` importe archivos de afuera de su carpeta).
fs.rmSync(ssr, { recursive: true, force: true });
fs.cpSync(servidor, ssr, { recursive: true });

// 2. El entry de Pages.
const worker = `/**
 * Entry de Cloudflare Pages (modo avanzado). GENERADO por
 * scripts/cloudflare-worker.mjs — no editar a mano.
 *
 * Reparte el tráfico con una regla MUY conservadora a propósito:
 *
 *   · TODO GET lo sirve el CDN de Pages primero (HTML prerenderizado, assets,
 *     .well-known). Es exactamente lo que Pages ya hacía, así que la landing no
 *     puede empeorar por tener este worker.
 *   · Las SERVER FUNCTIONS ("/_serverFn/...", siempre POST) son lo único que el
 *     CDN no sabe hacer: van a la app. Antes devolvían 405 porque el proyecto
 *     publicaba solo estáticos.
 *   · Cualquier otra cosa cae a la app y, si no contesta, al CDN.
 *
 * Además arma la Content-Security-Policy de cada HTML con los HASHES de sus
 * guiones inline calculados en el momento: así script-src no necesita
 * 'unsafe-inline' (lo único que capaba la calificación de seguridadheaders en
 * A). Los guiones inline cambian en cada respuesta —el de tema, el de
 * reveals, el JSON-LD y sobre todo el de hidratación de TanStack, que lleva
 * los datos del loader—, así que un hash estático en _headers se rompería con
 * la primera descarga nueva. Acá se calcula por respuesta y listo.
 *
 * Antes de delegar, SIEMBRA process.env desde env. El bundle trae su propio
 * polyfill de process (unenv) con el env VACÍO: process.env no ve la
 * configuración del proyecto aunque las bindings estén en env. Sin esto, el
 * canje de códigos Premium (que lee process.env.BITLY_CODES_TOKEN) respondía
 * "no pudimos verificar" con la variable perfectamente configurada.
 */
import app from "./_ssr/server.js";

function sembrarEnv(env) {
  if (typeof process === "undefined" || !process.env) return;
  for (const [clave, valor] of Object.entries(env)) {
    if (typeof valor === "string" && process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  }
}

const CSP_FIJOS =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:;" +
  " img-src 'self' data: blob: https:;" +
  // http://localhost solo para el backend local de yt-dlp (canal YouTube del
  // rescate, solo activo si YT_DLP_BACKEND_URL está configurado): el navegador
  // reproduce el proxy del backend, no googlevideo. En el cliente solo afecta
  // al localhost del propio visitante.
  " media-src 'self' blob: https: http://localhost:* http://127.0.0.1:*;" +
  " connect-src 'self' https://open.er-api.com https://api.github.com;" +
  " frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';" +
  // El service worker de la PWA va en 'self'; sin declararlo explícito cae en
  // script-src, que también es 'self', pero así queda aclarado.
  " worker-src 'self';" +
  " upgrade-insecure-requests";

// CSP de la APP servida en /app (la PWA real de Bitly, ver
// scripts/copiar-app-web.mjs). Tiene que ser distinta a propósito:
//   · el bundle de Flutter compila WebAssembly (canvaskit) → 'wasm-unsafe-eval';
//   · el motor se baja de www.gstatic.com: flutter build web usa el CDN de
//     Flutter para canvaskit POR DEFECTO (el bundle también trae su copia en
//     canvaskit/, pero sólo la usa si se compila con --no-web-resources-cdn).
//     Sin este host en script-src, la app quedaba con la pantalla en blanco
//     ("Failed to fetch dynamically imported module: .../canvaskit.js") aunque
//     el resto del bundle cargara: es lo que se vio al verificar /app con el
//     navegador de verdad;
//   · la app habla con el SERVIDOR QUE EL USUARIO CONFIGURE (bitly-backend
//     --web), en cualquier host y puerto, así que connect-src no puede ser
//     'self'. Es el propio cliente del usuario pidiendo su propio servidor;
//   · el shell de Flutter usa guiones inline (registro del service worker) y
//     upgrade-insecure-requests rompería un backend en http puerto 8080.
//
// OJO: este bloque vive DENTRO de un template literal (el worker se genera como
// texto), así que sus comentarios no pueden llevar backticks.
const CSP_APP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'" +
  " https://www.gstatic.com blob:;" +
  " style-src 'self' 'unsafe-inline'; font-src 'self' data:;" +
  " img-src 'self' data: blob: https:;" +
  " media-src 'self' blob: data: https: http:;" +
  " connect-src *; worker-src 'self' blob:;" +
  " frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';";

async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** CSP de un HTML: 'self' para los bundles + un hash por guion inline. */
async function cspDeHtml(html) {
  const hashes = [];
  const re = /<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\\bsrc\\s*=/i.test(m[1])) continue; // con src lo cubre 'self'
    // El tokenizer HTML normaliza el texto ANTES de ejecutarlo: CRLF -> LF
    // (preprocesado de entrada) y NUL -> U+FFFD (parse error). Si no se
    // replica, el hash del estado de TanStack (que lleva \\u0000 en los ids de
    // ruta internos) no coincide con el que calcula el navegador y Chrome
    // bloquea la hidratación entera.
    const texto = m[2]
      .replace(/\\r\\n?/g, "\\n")
      .split(String.fromCharCode(0))
      .join(String.fromCharCode(0xfffd));
    hashes.push("'sha256-" + (await sha256(texto)) + "'");
  }
  const scriptSrc = "script-src 'self'" + (hashes.length ? " " + [...new Set(hashes)].join(" ") : "");
  return CSP_FIJOS + "; " + scriptSrc;
}

/**
 * CSP ya calculada, por versión del HTML (su ETag).
 *
 * El plan free de Workers da 10 ms de CPU por petición y el HTML prerenderizado
 * pesa cientos de KB: recalcular los hashes de los guiones inline en CADA visita
 * es gastar CPU para obtener siempre el mismo resultado. El ETag cambia cuando
 * cambia el HTML (nuevo deploy), así que la caché no puede quedar vieja: si no
 * hay ETag, se calcula como siempre.
 */
const CSP_POR_ETAG = new Map();
const CSP_CACHE_MAX = 8;

async function cspDeHtmlCacheado(html, etag) {
  if (!etag) return cspDeHtml(html);
  const guardada = CSP_POR_ETAG.get(etag);
  if (guardada) return guardada;
  const csp = await cspDeHtml(html);
  if (CSP_POR_ETAG.size >= CSP_CACHE_MAX) CSP_POR_ETAG.clear();
  CSP_POR_ETAG.set(etag, csp);
  return csp;
}

/**
 * Cabeceras de seguridad de las páginas HTML.
 *
 * public/_headers las pone en los archivos estáticos, pero las páginas que arma
 * el worker (/, /admin, 404) no pasan por ese archivo: sin esto, el HTML salía
 * sólo con la CSP y sin HSTS, nosniff, referrer-policy ni permissions-policy.
 * Se replican acá los mismos valores.
 */
const CABECERAS_HTML = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
};

/**
 * Pone la CSP calculada y las cabeceras de seguridad en las respuestas HTML. Si
 * el cuerpo viene comprimido (no debería ocurrir dentro del worker), la
 * respuesta sale con una política de emergencia con 'unsafe-inline': preferible
 * una CSP floja a ninguna o a una que bloquee los guiones y deje la página sin
 * hidratar.
 */
async function conCsp(resp, esApp = false) {
  const tipo = resp.headers.get("content-type") ?? "";
  if (!tipo.includes("text/html")) return resp;
  if (resp.headers.get("content-encoding") && resp.headers.get("content-encoding") !== "identity") {
    const cab = new Headers(resp.headers);
    cab.set(
      "Content-Security-Policy",
      esApp ? CSP_APP : CSP_FIJOS + "; script-src 'self' 'unsafe-inline'",
    );
    for (const [clave, valor] of Object.entries(CABECERAS_HTML)) cab.set(clave, valor);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: cab });
  }
  const html = await resp.text();
  const cab = new Headers(resp.headers);
  cab.set(
    "Content-Security-Policy",
    esApp ? CSP_APP : await cspDeHtmlCacheado(html, resp.headers.get("etag") ?? ""),
  );
  for (const [clave, valor] of Object.entries(CABECERAS_HTML)) cab.set(clave, valor);
  cab.delete("content-length");
  return new Response(html, { status: resp.status, statusText: resp.statusText, headers: cab });
}

export default {
  async fetch(request, env, ctx) {
    sembrarEnv(env);
    const { pathname } = new URL(request.url);
    const esRpc = pathname.startsWith("/_serverFn/");
    const esApi = pathname.startsWith("/api/");
    // La app real servida en el sitio (public/app): su HTML lleva la CSP de
    // PWA (/app) y no la del sitio.
    const esApp = pathname === "/app" || pathname.startsWith("/app/");

    // Tope de cuerpo en el borde: el comprobante más grande permitido son 4 MB
    // de base64, así que nada legítimo pasa de 6 MB. Sin esto, un POST enorme
    // obliga al isolate a parsear (y guardar en memoria) el cuerpo entero antes
    // de que el handler pueda rechazarlo.
    if (esRpc) {
      const largo = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(largo) && largo > 6 * 1024 * 1024) {
        // public/_headers sólo aplica a archivos estáticos: en las respuestas
        // de la RPC el no-store se pone acá.
        return new Response("Payload too large", {
          status: 413,
          headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
        });
      }
    }

    // Rutas que no son para el navegador: el bundle del servidor (_ssr), los
    // restos de build, los source maps, los metadatos del proyecto y cualquier
    // archivo oculto. Pages no las publica, pero una ruta explícita acá es la
    // diferencia entre un 404 y filtrar el código del servidor si algún día el
    // pipeline cambia.
    const privada =
      pathname === "/_ssr" ||
      pathname.startsWith("/_ssr/") ||
      pathname === "/_build" ||
      pathname.startsWith("/_build/") ||
      pathname === "/_worker.js" ||
      pathname.startsWith("/_worker.js/") ||
      pathname === "/.env" ||
      pathname.startsWith("/.env") ||
      pathname.startsWith("/.git/") ||
      pathname.startsWith("/node_modules/") ||
      /\.map$/.test(pathname);
    if (privada) {
      return new Response("Not found", { status: 404 });
    }

    if (!esRpc && request.method === "GET") {
      const estatico = await env.ASSETS.fetch(request);
      if (estatico.status !== 404) return conCsp(estatico, esApp);
    }

    const respuesta = await app.fetch(request, env, ctx);
    const salida = respuesta.status !== 404 ? respuesta : await env.ASSETS.fetch(request);
    const final = await conCsp(salida, esApp);
    // La RPC y la API de la app (descargas, audio) no se cachean ni se indexan,
    // y salen con las mismas cabeceras de seguridad que el resto del sitio: un
    // archivo descargado no se puede "adivinar" como HTML/JS (nosniff) ni leer
    // desde otro origen (CORP).
    if (!esRpc && !esApi) return final;
    const cab = new Headers(final.headers);
    cab.set("Cache-Control", "no-store");
    cab.set("X-Robots-Tag", "noindex, nofollow");
    cab.set("X-Content-Type-Options", "nosniff");
    cab.set("Cross-Origin-Resource-Policy", "same-origin");
    cab.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return new Response(final.body, { status: final.status, statusText: final.statusText, headers: cab });
  },
};
`;

fs.writeFileSync(path.join(cliente, "_worker.js"), worker);

const kb = (p) => Math.round(fs.statSync(p).size / 1024);
console.log(
  `[cf] modo avanzado listo: dist/client/_worker.js (${kb(path.join(cliente, "_worker.js"))} KB) y ` +
    `dist/client/_ssr/ (${fs.readdirSync(ssr).length} entradas)`,
);
