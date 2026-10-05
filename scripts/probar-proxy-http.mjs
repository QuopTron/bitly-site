#!/usr/bin/env node
/**
 * Prueba el proxy cifrado por HTTP real (la ruta exacta del navegador).
 *
 * `probar-proxy.mjs` corre los handlers en el mismo proceso; éste además
 * pasa por el transformador de TanStack Start y por la server function:
 * pide el id del RPC al servidor de desarrollo, arma la petición con seroval
 * (el mismo serializador que usa el cliente) y decodifica la respuesta.
 *
 * Requiere el servidor de desarrollo corriendo (por defecto en :3000):
 *   pnpm dev
 *   node scripts/probar-proxy-http.mjs "queen" deezer
 *   node scripts/probar-proxy-http.mjs --url=http://localhost:3003 "queen"
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

function cargarSeroval() {
  const carpeta = readdirSync(path.join(raiz, "node_modules", ".pnpm"))
    .filter((d) => /^seroval@/.test(d))
    .sort()
    .pop();
  if (!carpeta) {
    console.error("No encuentro seroval en node_modules/.pnpm.");
    process.exit(1);
  }
  return import(
    pathToFileURL(path.join(raiz, "node_modules", ".pnpm", carpeta, "node_modules", "seroval", "dist", "index.js")).href
  );
}

const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const banderas = process.argv.slice(2).filter((a) => a.startsWith("--"));
const base = banderas.find((a) => a.startsWith("--url="))?.slice("--url=".length) ?? "http://localhost:3000";
const filtro = banderas.find((a) => a.startsWith("--filtro="))?.slice("--filtro=".length) ?? null;

const consulta = argumentos[0] ?? "daft punk";
const pedidas = argumentos.slice(1);
const extensiones = pedidas.length > 0 ? pedidas : ["deezer"];

const esbuild = await cargarEsbuild();
const seroval = await cargarSeroval();
const cache = path.join(raiz, "scripts", ".cache");
const salida = path.join(cache, "crypto.mjs");
mkdirSync(cache, { recursive: true });

try {
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", "lib", "demo-crypto.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: salida,
    logLevel: "warning",
  });
  const cryptoDemo = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

  // El id del RPC vive en el módulo transformado del servidor de desarrollo.
  const fuente = await (await fetch(`${base}/src/server/demo-proxy.ts`)).text();
  const ids = {};
  for (const linea of fuente.split("\n")) {
    const m = linea.match(/export const (demo\w+)\s*=.*createClientRpc\("([^"]+)"\)/);
    if (m) ids[m[1]] = m[2];
  }
  if (!ids.demoClave || !ids.demoBuscar || !ids.demoRescatar) {
    console.error(`No encuentro los ids de server fn en ${base} (¿está corriendo pnpm dev?).`);
    console.error(fuente.slice(0, 400));
    process.exit(1);
  }

  async function llamar(nombre, data) {
    const headers = {
      "x-tsr-serverFn": "true",
      accept: "application/x-tss-framed, application/x-ndjson, application/json",
      // TanStack Start rechaza (403) las server functions sin Origin: el
      // navegador siempre lo manda, este harness tiene que imitarlo.
      Origin: new URL(base).origin,
      Referer: `${base}/`,
    };
    let body;
    if (data !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(await seroval.toJSONAsync({ data }, { plugins: [] }));
    }
    const res = await fetch(`${base}/_serverFn/${ids[nombre]}`, { method: "POST", headers, body });
    const ct = res.headers.get("content-type") ?? "";
    if (banderas.includes("--debug")) {
      console.log(`[debug] POST ${nombre} → ${res.status} ${ct} serializado=${res.headers.get("x-tss-serialized")}`);
    }
    if (res.headers.get("x-tss-raw") === "true") return res.json();

    if (res.headers.get("x-tss-serialized")) {
      if (ct.includes("application/json")) {
        const bruto = seroval.fromCrossJSON(await res.json(), { plugins: [] });
        // El envoltorio de la server function: `{ result, context }`. El
        // fetcher del navegador lo desenvuelve en su cadena de middleware.
        if (bruto && typeof bruto === "object" && "error" in bruto && bruto.error) {
          throw bruto.error instanceof Error ? bruto.error : new Error(String(bruto.error));
        }
        if (bruto && typeof bruto === "object" && "result" in bruto && "context" in bruto) {
          return bruto.result;
        }
        return bruto;
      }
      throw new Error(`respuesta en streaming sin soporte: ${ct}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  // ── Contrato completo, idéntico al de `demo-api.ts`.
  const par = await cryptoDemo.generarPar();
  const jwkServidor = await llamar("demoClave");
  if (banderas.includes("--debug")) {
    console.log("[debug] jwk servidor:", JSON.stringify(jwkServidor)?.slice(0, 300));
  }
  const clave = await cryptoDemo.derivarClave(par.privada, await cryptoDemo.importarPublica(jwkServidor));
  const sesion = crypto.randomUUID();

  async function pedir(peticion) {
    const carga = {
      sesion,
      publica: par.jwk,
      cifrado: await cryptoDemo.cifrar(clave, JSON.stringify(peticion)),
    };
    const respuesta = await llamar("demoBuscar", carga);
    return JSON.parse(await cryptoDemo.descifrar(clave, respuesta));
  }

  console.log(`${base} · consulta "${consulta}"${filtro ? ` · filtro ${filtro}` : ""}\n`);

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

      if (banderas.includes("--rescate") && r.items.length > 0) {
        const carga = { sesion, publica: par.jwk, cifrado: await cryptoDemo.cifrar(clave, JSON.stringify(r.items[0])) };
        const audio = await llamar("demoRescatar", carga);
        console.log(`       rescate → ${audio ? audio.url.slice(0, 90) : "sin audio"}`);
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
  try {
    rmSync(salida, { force: true });
  } catch {
    // En Windows el archivo puede quedar momentáneamente ocupado.
  }
}
