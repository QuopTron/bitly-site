#!/usr/bin/env node
/**
 * Prueba el runtime de extensiones de la demo fuera del navegador.
 *
 * Compila `src/server/extensions/index.ts` con esbuild (mismo transformador que
 * usa Vite) y corre una búsqueda real por cada extensión, con la misma llamada
 * que después hacen las server functions. Sirve para ver en 30 s si una
 * extensión sigue funcionando, cuánto tarda y —si falla— qué registró su log.
 *
 * Uso:
 *   node scripts/probar-extensiones.mjs                 → todas, "daft punk"
 *   node scripts/probar-extensiones.mjs "rosalía"       → todas, esa consulta
 *   node scripts/probar-extensiones.mjs "queen" spotify-web deezer
 *   node scripts/probar-extensiones.mjs --albums "queen"
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = process.env.BITLY_EXTENSIONES_DIR
  ? path.resolve(process.env.BITLY_EXTENSIONES_DIR)
  : path.resolve(raiz, "..", "bitly-extensions", "extensions");

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
const banderas = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const consulta = argumentos[0] && !esExtension(argumentos[0]) ? argumentos[0] : "daft punk";
const pedidas = argumentos.filter((a) => esExtension(a));
const categoria = banderas.has("--albums")
  ? "albums"
  : banderas.has("--artists")
    ? "artists"
    : banderas.has("--playlists")
      ? "playlists"
      : null;

function esExtension(v) {
  return existsSync(path.join(ORIGEN, `${v}-extracted`));
}

function filtroDe(id) {
  try {
    const m = JSON.parse(readFileSync(path.join(ORIGEN, `${id}-extracted`, "manifest.json"), "utf8"));
    const filtros = m?.searchBehavior?.filters ?? [];
    if (categoria) {
      const buscado = { albums: "album", artists: "artist", playlists: "playlist" }[categoria];
      const hallado = filtros.find((f) => String(f.id).toLowerCase().startsWith(buscado));
      return hallado ? hallado.id : null;
    }
    return filtros[0]?.id ?? null;
  } catch {
    return null;
  }
}

const todas = readdirSync(ORIGEN)
  .filter((d) => d.endsWith("-extracted"))
  .map((d) => d.replace(/-extracted$/, ""));
const lista = pedidas.length > 0 ? pedidas : todas;

const esbuild = await cargarEsbuild();
const temporal = path.join(raiz, "scripts", ".cache", "extensiones.mjs");
mkdirSync(path.dirname(temporal), { recursive: true });

try {
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", "server", "extensions", "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: temporal,
    logLevel: "warning",
  });

  const runtime = await import(pathToFileURL(temporal).href + `?v=${Date.now()}`);
  console.log(`Consulta: "${consulta}"${categoria ? ` · filtro ${categoria}` : ""}\n`);

  for (const ext of lista) {
    const filtro = filtroDe(ext);
    const inicio = Date.now();
    try {
      const items = await runtime.buscarEnExtension({
        sesion: "prueba",
        ext,
        consulta,
        filtro,
        limite: 6,
      });
      const ms = Date.now() - inicio;
      const detalle = items
        .slice(0, 3)
        .map((i) => `${i.tipo}:${i.titulo}${i.artista ? " — " + i.artista : ""}`)
        .join(" | ");
      console.log(
        `${items.length > 0 ? "OK " : "VAC"}  ${ext.padEnd(20)} ${String(ms).padStart(5)}ms  ` +
          `${items.length} resultado(s)${items.length ? `  ${detalle}` : ""}`,
      );
      if (items.length === 0 || banderas.has("--log")) {
        for (const r of runtime.registrosDe("prueba", ext).slice(-16)) console.log(`       ${r}`);
      }
      const cuerpo = process.argv.slice(2).find((a) => a.startsWith("--cuerpo="));
      if (cuerpo || banderas.has("--cache")) {
        const sub = cuerpo ? cuerpo.slice("--cuerpo=".length) : undefined;
        const entradas = runtime.cacheDe("prueba", ext, sub, cuerpo ? 400000 : 200);
        console.log(`       cache (${entradas.length}):`);
        for (const c of entradas) {
          console.log(`       · ${c.estado} ${c.clave}`);
          if (cuerpo) console.log(c.cuerpo.replace(/^/gm, "         "));
        }
      }
      if (items.length > 0 && banderas.has("--rescate")) {
        const audio = await runtime.rescatarAudio(items[0]);
        console.log(`     rescate → ${audio ? audio.url : "sin audio"}`);
      }
    } catch (e) {
      const ms = Date.now() - inicio;
      console.log(`ERR  ${ext.padEnd(20)} ${String(ms).padStart(5)}ms  ${String(e && e.message ? e.message : e)}`);
      const registros = runtime.registrosDe("prueba", ext);
      for (const r of registros.slice(-6)) console.log(`       ${r}`);
    }
  }
} finally {
  try {
    rmSync(temporal, { force: true });
  } catch {
    // En Windows el archivo puede quedar momentáneamente ocupado.
  }
}
