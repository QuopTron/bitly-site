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
 * El prefijo `_` importa: Pages NO publica como estáticos los archivos ni las
 * carpetas que empiezan con `_`, así que el código del servidor no queda
 * expuesto como copia descargable.
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
  " img-src 'self' data: blob: https:; media-src 'self' blob: https:;" +
  " connect-src 'self' https://*.supabase.co https://open.er-api.com https://api.github.com;" +
  " frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';" +
  " upgrade-insecure-requests";

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
 * Pone la CSP calculada en las respuestas HTML. Si el cuerpo viene comprimido
 * (no debería ocurrir dentro del worker), la respuesta sale con una política
 * de emergencia con 'unsafe-inline': preferible una CSP floja a ninguna o a
 * una que bloquee los guiones y deje la página sin hidratar.
 */
async function conCsp(resp) {
  const tipo = resp.headers.get("content-type") ?? "";
  if (!tipo.includes("text/html")) return resp;
  if (resp.headers.get("content-encoding") && resp.headers.get("content-encoding") !== "identity") {
    const cab = new Headers(resp.headers);
    cab.set("Content-Security-Policy", CSP_FIJOS + "; script-src 'self' 'unsafe-inline'");
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: cab });
  }
  const html = await resp.text();
  const cab = new Headers(resp.headers);
  cab.set("Content-Security-Policy", await cspDeHtml(html));
  cab.delete("content-length");
  return new Response(html, { status: resp.status, statusText: resp.statusText, headers: cab });
}

export default {
  async fetch(request, env, ctx) {
    sembrarEnv(env);
    const { pathname } = new URL(request.url);
    const esRpc = pathname.startsWith("/_serverFn/");

    if (!esRpc && request.method === "GET") {
      const estatico = await env.ASSETS.fetch(request);
      if (estatico.status !== 404) return conCsp(estatico);
    }

    const respuesta = await app.fetch(request, env, ctx);
    if (respuesta.status !== 404) return conCsp(respuesta);
    return conCsp(await env.ASSETS.fetch(request));
  },
};
`;

fs.writeFileSync(path.join(cliente, "_worker.js"), worker);

const kb = (p) => Math.round(fs.statSync(p).size / 1024);
console.log(
  `[cf] modo avanzado listo: dist/client/_worker.js (${kb(path.join(cliente, "_worker.js"))} KB) y ` +
    `dist/client/_ssr/ (${fs.readdirSync(ssr).length} entradas)`,
);
