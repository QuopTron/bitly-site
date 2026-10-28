#!/usr/bin/env node
/**
 * Prueba las reglas de la configuración de RESCATE por cuenta contra el módulo
 * real.
 *
 * Lo que se comprueba acá es lo que no se ve en el panel: que la lista blanca
 * descarte de verdad los SECRETOS de la app (token de la instancia arcod,
 * configs firmadas del relay, claves de Qobuz), que una URL mal pegada no entre
 * y que "espejos: []" (apagar) se distinga de "no lo tocaron".
 *
 * El camino real de escritura (contra GitHub) necesita el token del repo y no
 * se puede probar desde acá: eso se mira con la app sincronizando.
 *
 * Uso: node scripts/probar-rescate-cuenta.mjs
 */

import { readdirSync, mkdirSync } from "node:fs";
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

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const salida = path.join(cache, "rescate-cuenta.mjs");

let ok = 0;
let fallos = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    ok++;
    console.log(`OK   ${nombre}${detalle ? `  (${detalle})` : ""}`);
  } else {
    fallos++;
    console.log(`FALLA ${nombre}${detalle ? `  (${detalle})` : ""}`);
  }
}

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "rescate-cuenta.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: salida,
  logLevel: "error",
});

const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);
const { limpiarRescate } = m;

/* ── Nada aprovechable ──────────────────────────────────────────────────── */
check("rechaza lo que no es objeto", limpiarRescate(null) === null && limpiarRescate("x") === null);
check("rechaza un objeto vacío", limpiarRescate({}) === null);
check("rechaza sólo campos desconocidos", limpiarRescate({ otra: 1 }) === null);

/* ── La lista blanca deja los SECRETOS afuera ───────────────────────────── */
const soloSecretos = limpiarRescate({
  arcod_token: "jwt-de-la-instancia",
  token: "token-de-sesion",
  stashConfig: "https://relay-firmado.test/cfg",
  qobuz: { arl: "token-de-qobuz" },
});
check("una config con sólo secretos se rechaza", soloSecretos === null, JSON.stringify(soloSecretos));

const conSecretos = limpiarRescate({
  espejos: false,
  arcod_token: "jwt-de-la-instancia",
  install: "id-de-instalacion",
  actualizado: "1999-01-01",
});
check(
  "los secretos y el sello de fecha no se guardan",
  conSecretos && !("arcod_token" in conSecretos) && !("install" in conSecretos) && !("actualizado" in conSecretos),
  JSON.stringify(conSecretos),
);

/* ── Espejos ────────────────────────────────────────────────────────────── */
const espejos = limpiarRescate({
  mirrors: ["https://a.test/", "https://a.test", "no-es-url", "https://b.test", "ftp://c.test", 7],
});
check(
  "normaliza, deduplica y filtra lo que no es http(s)",
  JSON.stringify(espejos?.mirrors) === JSON.stringify(["https://a.test", "https://b.test"]),
  JSON.stringify(espejos?.mirrors),
);
check("la lista vacía es \"apagar\" y no \"sin tocar\"", JSON.stringify(limpiarRescate({ mirrors: [] })) === JSON.stringify({ mirrors: [] }));
check(
  "la lista vacía se distingue de una clave que no vino",
  limpiarRescate({ mirrors: [] })?.mirrors !== undefined && limpiarRescate({ arcod: true })?.mirrors === undefined,
);

const muchos = limpiarRescate({ mirrors: Array.from({ length: 12 }, (_, i) => `https://e${i}.test`) });
check("el tope de espejos corta la lista", muchos?.mirrors.length === 8, `quedaron ${muchos?.mirrors.length}`);

const larga = limpiarRescate({ mirrors: [`https://a.test/${"x".repeat(300)}`] });
check("una URL larguísima no entra", JSON.stringify(larga?.mirrors) === "[]", JSON.stringify(larga?.mirrors));

const conEspacios = limpiarRescate({ arcodBase: " https://mi arcod.test " });
check("una URL con espacios adentro se descarta", conEspacios === null || conEspacios.arcodBase === undefined);

/* ── Instancias propias ─────────────────────────────────────────────────── */
check("acepta una instancia propia sin barra final", limpiarRescate({ arcodBase: "https://mi.test/" })?.arcodBase === "https://mi.test");
check("rechaza una instancia sin protocolo", limpiarRescate({ monochromeBase: "mi.test" }) === null);
check(
  "una instancia propia sola alcanza para guardar",
  limpiarRescate({ monochromeBase: "https://cat.test" })?.monochromeBase === "https://cat.test",
);

/* ── Interruptores ──────────────────────────────────────────────────────── */
const apagado = limpiarRescate({ espejos: false, arcod: false, monochrome: true, stashRelay: true });
check(
  "los cuatro interruptores se guardan tal cual",
  apagado?.espejos === false && apagado?.arcod === false && apagado?.monochrome === true && apagado?.stashRelay === true,
  JSON.stringify(apagado),
);
const textos = limpiarRescate({ arcod: "false", espejos: 0, monochrome: "no", stashRelay: null });
check("un texto no es un interruptor", textos === null, JSON.stringify(textos));

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
