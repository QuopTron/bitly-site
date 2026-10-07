#!/usr/bin/env node
/**
 * Verifica que el audio rescatado sea DE VERDAD la canción pedida.
 *
 * No alcanza con ver que el relay devuelva una URL: se baja el primer tramo del
 * FLAC (Range) y se leen sus etiquetas Vorbis (TITLE/ARTIST/ISRC/ALBUM). Así se
 * responde la única pregunta que importa: ¿lo que suena es la canción pedida?
 *
 * Uso:
 *   node scripts/probar-rescate-flac.mjs "get lucky" "daft punk" deezer
 *   node scripts/probar-rescate-flac.mjs "bohemian rhapsody" "queen" deezer
 */

import { readdirSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cargarEsbuild() {
  const base = path.join(raiz, "node_modules", ".pnpm");
  const carpeta = readdirSync(base).find((d) => d.startsWith("esbuild@"));
  return import(
    pathToFileURL(path.join(base, carpeta, "node_modules", "esbuild", "lib", "main.js")).href
  ).then((m) => (m.build ? m : m.default));
}

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const entrada = path.join(cache, "entrada-flac.ts");
const salida = path.join(cache, "flac.mjs");
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
    external: [
      "@tanstack/react-start/server",
      "#tanstack-router-entry",
      "#tanstack-start-entry",
      "tanstack-start-manifest:*",
    ],
    logLevel: "error",
  });

  const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);
  const par = await m.generarPar();
  const clave = await m.derivarClave(par.privada, await m.importarPublica(await m.claveImpl()));
  const sesion = crypto.randomUUID();

  async function sellar(objeto) {
    return { sesion, publica: par.jwk, cifrado: await m.cifrar(clave, JSON.stringify(objeto)) };
  }

  /** Lee los bloques de metadata del FLAC y devuelve las etiquetas Vorbis. */
  function etiquetasFLAC(buf) {
    if (buf.subarray(0, 4).toString("latin1") !== "fLaC") {
      return { error: `no es FLAC (magic=${JSON.stringify(buf.subarray(0, 4).toString("latin1"))})` };
    }
    let pos = 4;
    const tags = {};
    const bloques = [];
    let duracion = null;
    // STREAMINFO siempre es el primer bloque (data en el byte 8): de ahí salen
    // el muestreo y las muestras TOTALES, que dan la duración real del archivo.
    // Un adelanto de 30 s no puede medir 3:45.
    if (buf.length >= 8 + 34 && (buf[4] & 0x7f) === 0) {
      const si = buf.subarray(8, 8 + 34);
      const cab = si.readBigUInt64BE(10);
      const muestreo = Number(cab >> 44n) & 0xfffff;
      const total = cab & 0xfffffffffn;
      if (muestreo > 0 && total > 0n) duracion = Number(total) / muestreo;
    }
    while (pos + 4 <= buf.length) {
      const header = buf[pos];
      const ultimo = (header & 0x80) !== 0;
      const tipo = header & 0x7f;
      const largo = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
      bloques.push(`${tipo}/${largo}${ultimo ? "!" : ""}`);
      pos += 4;
      if (tipo === 4 && pos + largo <= buf.length) {
        let p = pos;
        const lv = buf.readUInt32LE(p);
        p += 4 + lv;
        const n = buf.readUInt32LE(p);
        p += 4;
        for (let i = 0; i < n && p + 4 <= buf.length; i++) {
          const lt = buf.readUInt32LE(p);
          p += 4;
          const par = buf.subarray(p, p + lt).toString("utf8");
          p += lt;
          const eq = par.indexOf("=");
          if (eq > 0) tags[par.slice(0, eq).toUpperCase()] = par.slice(eq + 1);
        }
        return { tipo: "vorbis", tags, bloques, duracion };
      }
      if (tipo === 3) { pos += largo; if (ultimo) break; continue; }
      pos += largo;
      if (ultimo) break;
    }
    return { tipo: "sin-etiquetas", tags, bloques, duracion };
  }

  const titulo = process.argv[2] ?? "get lucky";
  const artista = process.argv[3] ?? "daft punk";
  const ext = process.argv[4] ?? "deezer";

  console.log(`Pido: "${titulo}" — "${artista}" (ext ${ext})\n`);
  const r = JSON.parse(
    await m.descifrar(
      clave,
      await m.buscarImpl(await sellar({ consulta: `${titulo} ${artista}`, ext, filtro: "track", limite: 8 })),
    ),
  );
  console.log("Listado (lo que ve el usuario):");
  r.items.forEach((i, n) => console.log(`  ${String(n).padStart(2)} ${i.titulo} — ${i.artista}`));

  // Primero: el audio de lo que el usuario ve ARRIBA (el clic real).
  for (const [etiqueta, idx] of [["TOP (lo que se toca al hacer clic)", 0]]) {
    const pista = {
      titulo: r.items[idx].titulo,
      artista: r.items[idx].artista,
      album: r.items[idx].album,
      duracionMs: r.items[idx].duracionMs,
      isrc: r.items[idx].isrc,
      ext,
    };
    const t0 = Date.now();
    const audio = await m.rescatarImpl(await sellar(pista));
    const ms = Date.now() - t0;
    console.log(`\n${etiqueta}: ${pista.titulo} — ${pista.artista}`);
    if (!audio) {
      console.log("  sin audio");
      continue;
    }
    console.log(`  canal=${audio.canal} proveedor=${audio.proveedor} isrc=${audio.isrc} ${ms}ms`);
    console.log(`  url=${audio.url.slice(0, 110)}`);
    const res = await fetch(audio.url, { headers: { Range: "bytes=0-131071" } });
    console.log(`  GET → ${res.status} ${res.headers.get("content-type")} (${res.headers.get("content-range")})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = etiquetasFLAC(buf);
    console.log(`  FLAC duracion=${meta.duracion ? meta.duracion.toFixed(1) : "?"}s bloques=[${(meta.bloques ?? []).join(" ")}] ${meta.tipo}:`, JSON.stringify(meta.tags ?? meta.error));
    if (meta.duracion && meta.duracion < 35) console.log("  ⚠ parece un ADELANTO (30 s), no la canción completa");
  }
} finally {
  for (const f of [salida, entrada]) {
    try { rmSync(f, { force: true }); } catch {}
  }
}
