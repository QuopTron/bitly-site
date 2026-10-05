#!/usr/bin/env node
/**
 * Prueba el proxy CIFRADO de la demo (la misma ruta que hace el navegador).
 *
 * Compila `src/server/demo-proxy.ts` + `src/lib/demo-crypto.ts` con esbuild y
 * corre el contrato completo: par ECDH del cliente → consulta cifrada →
 * `buscarImpl` (cupo → extensión → respaldo) → respuesta descifrada. Sirve para
 * ver en un minuto si las server functions siguen cerradas de punta a punta.
 *
 * Uso:
 *   node scripts/probar-proxy.mjs                    → "daft punk", 3 extensiones
 *   node scripts/probar-proxy.mjs "queen" deezer ytmusic-spotiflac
 *   node scripts/probar-proxy.mjs --filtro=albums "queen" deezer
 *   node scripts/probar-proxy.mjs --rescate "queen" deezer
 */

import { readdirSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cargarEsbuild() {
  const base = path.join(raiz, "node_modules", ".pnpm");
  const carpeta = readdirSync(base).find((d) => d.startsWith("esbuild@"));
  if (!carpeta) {
    console.error("No encuentro esbuild en node_modules/.pnpm (¿pnpm install?).");
    process.exit(1);
  }
  return import(
    pathToFileURL(path.join(base, carpeta, "node_modules", "esbuild", "lib", "main.js")).href
  ).then((m) => (m.build ? m : m.default));
}

const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const banderas = process.argv.slice(2).filter((a) => a.startsWith("--"));
const filtro = banderas.find((a) => a.startsWith("--filtro="))?.slice("--filtro=".length) ?? null;
const rescatar = banderas.includes("--rescate");

const consulta = argumentos[0] ?? "daft punk";
const pedidas = argumentos.slice(1);
const extensiones = pedidas.length > 0 ? pedidas : ["spotify-web", "deezer", "ytmusic-spotiflac"];

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
const salida = path.join(cache, "proxy.mjs");
const entrada = path.join(cache, "entrada-proxy.ts");
mkdirSync(cache, { recursive: true });
writeFileSync(
  entrada,
  [
    `export { claveImpl, buscarImpl, rescatarImpl } from "@/server/demo-proxy";`,
    `export { generarPar, importarPublica, derivarClave, cifrar, descifrar } from "@/lib/demo-crypto";`,
    "",
  ].join("\n"),
);

try {
  await esbuild.build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: salida,
    tsconfig: path.join(raiz, "tsconfig.json"),
    alias: { "@": path.join(raiz, "src") },
    // `getRequestIP` solo existe dentro de una petición HTTP real: acá corre
    // fuera de TanStack y `quienSolicita()` lo atrapa igual.
    external: [
      "@tanstack/react-start/server",
      "#tanstack-router-entry",
      "#tanstack-start-entry",
      "tanstack-start-manifest:*",
    ],
    logLevel: "warning",
  });

  const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

  // ── Lado cliente: el mismo par y la misma clave que arma `demo-api.ts`.
  const par = await m.generarPar();
  const jwkServidor = await m.claveImpl();
  const clave = await m.derivarClave(par.privada, await m.importarPublica(jwkServidor));
  const sesion = crypto.randomUUID();

  async function pedir(peticion) {
    const carga = {
      sesion,
      publica: par.jwk,
      cifrado: await m.cifrar(clave, JSON.stringify(peticion)),
    };
    const respuesta = await m.buscarImpl(carga);
    return JSON.parse(await m.descifrar(clave, respuesta));
  }

  console.log(`Consulta: "${consulta}"${filtro ? ` · filtro ${filtro}` : ""}\n`);

  for (const ext of extensiones) {
    const inicio = Date.now();
    try {
      const r = await pedir({ consulta, ext, filtro, limite: 6 });
      const ms = Date.now() - inicio;
      const detalle = (r.items ?? [])
        .slice(0, 2)
        .map((i) => `${i.tipo}:${i.titulo}${i.artista ? " — " + i.artista : ""}`)
        .join(" | ");
      console.log(
        `${r.limitado ? "CUPO" : r.items.length > 0 ? "OK " : "VAC"}  ${ext.padEnd(20)} ` +
          `${String(ms).padStart(5)}ms  [${r.origen}] ${r.items.length} item(s)` +
          `${r.items.length ? `  ${detalle}` : ""}${r.aviso ? `  aviso: ${r.aviso}` : ""}`,
      );
      if (rescatar && r.items.length > 0) {
        // La petición de audio es la pista + su extensión de origen: la
        // extensión decide si el ISRC es autoritativo (ver PeticionAudio).
        const pista = { ...r.items[0], ext };
        const carga = { sesion, publica: par.jwk, cifrado: await m.cifrar(clave, JSON.stringify(pista)) };
        const inicioAudio = Date.now();
        const audio = await m.rescatarImpl(carga);
        const msAudio = Date.now() - inicioAudio;
        console.log(
          `       rescate → ${audio ? `${audio.url.slice(0, 80)}  [${audio.canal} ${audio.proveedor} ${msAudio}ms]` : "sin audio"}`,
        );
        if (audio && banderas.includes("--escuchar")) console.log(`       url completa: ${audio.url}`);
      }
    } catch (e) {
      console.log(
        `ERR  ${ext.padEnd(20)} ${String(Date.now() - inicio).padStart(5)}ms  ` +
          String((e && e.message) || e),
      );
      if (banderas.includes("--stack")) console.log(e.stack);
    }
  }
} finally {
  for (const f of [salida, entrada]) {
    try {
      rmSync(f, { force: true });
    } catch {
      // En Windows el archivo puede quedar momentáneamente ocupado.
    }
  }
}
