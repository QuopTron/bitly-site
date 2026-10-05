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
 */
import app from "./_ssr/server.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const esRpc = pathname.startsWith("/_serverFn/");

    if (!esRpc && request.method === "GET") {
      const estatico = await env.ASSETS.fetch(request);
      if (estatico.status !== 404) return estatico;
    }

    const respuesta = await app.fetch(request, env, ctx);
    if (respuesta.status !== 404) return respuesta;
    return env.ASSETS.fetch(request);
  },
};
`;

fs.writeFileSync(path.join(cliente, "_worker.js"), worker);

const kb = (p) => Math.round(fs.statSync(p).size / 1024);
console.log(
  `[cf] modo avanzado listo: dist/client/_worker.js (${kb(path.join(cliente, "_worker.js"))} KB) y ` +
    `dist/client/_ssr/ (${fs.readdirSync(ssr).length} entradas)`,
);
