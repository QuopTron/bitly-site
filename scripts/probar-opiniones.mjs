#!/usr/bin/env node
/**
 * Prueba las reglas de las opiniones contra el módulo real.
 *
 * Lo que se comprueba acá es lo que no se ve mirando la página: que un nombre de
 * 25 letras no pase, que las estrellas sean enteras de 1 a 5, y sobre todo que
 * el cupo corte de verdad (por clave y global) — si el cupo no cortara, un
 * script podría llenar la tabla de basura.
 *
 * El camino real de escritura (contra Supabase) necesita la migración aplicada
 * y no se puede probar desde acá.
 *
 * Uso: node scripts/probar-opiniones.mjs
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
const salida = path.join(cache, "opiniones.mjs");

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
  entryPoints: [path.join(raiz, "src", "lib", "opiniones-reglas.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: salida,
  logLevel: "error",
});

const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);
const {
  limpiarTexto,
  limpiarEstrellas,
  normalizarReparto,
  crearCupo,
  NOMBRE_MIN,
  NOMBRE_MAX,
  TEXTO_MIN,
  TEXTO_MAX,
  MAX_POR_IP,
} = m;

console.log(`NOMBRE ${NOMBRE_MIN}-${NOMBRE_MAX} · TEXTO ${TEXTO_MIN}-${TEXTO_MAX} · MAX_POR_IP ${MAX_POR_IP}\n`);

/* ── Texto ──────────────────────────────────────────────────────────────── */
check("colapsa espacios y recorta los extremos", limpiarTexto("  hola    mundo  ", 2, 24) === "hola mundo");
check("acepta justo en el mínimo", limpiarTexto("ab", 2, 24) === "ab");
check("acepta justo en el máximo", limpiarTexto("a".repeat(24), 2, 24)?.length === 24);
check("rechaza uno más corto que el mínimo", limpiarTexto("a", 2, 24) === null);
check("rechaza uno más largo que el máximo", limpiarTexto("a".repeat(25), 2, 24) === null);
check("rechaza sólo espacios", limpiarTexto("     ", 2, 24) === null);
check("rechaza lo que no es texto", limpiarTexto(42, 2, 24) === null && limpiarTexto(null, 2, 24) === null);
check("las pestañas y los saltos cuentan como espacios", limpiarTexto("hola\t\nmundo", 2, 24) === "hola mundo");

/* ── Estrellas ──────────────────────────────────────────────────────────── */
check("acepta 1", limpiarEstrellas(1) === 1);
check("acepta 5", limpiarEstrellas(5) === 5);
check("acepta el string \"3\" (llega así desde un formulario)", limpiarEstrellas("3") === 3);
check("rechaza 0", limpiarEstrellas(0) === null);
check("rechaza 6", limpiarEstrellas(6) === null);
check("rechaza 2.5", limpiarEstrellas(2.5) === null);
check("rechaza NaN y null", limpiarEstrellas(Number.NaN) === null && limpiarEstrellas(null) === null);

/* ── Reparto de notas ───────────────────────────────────────────────────── */
check("el reparto siempre tiene 5 casillas", normalizarReparto([1, 2]).join(",") === "1,2,0,0,0");
check("el reparto rechaza lo que no es arreglo", normalizarReparto(undefined).join(",") === "0,0,0,0,0");
check("el reparto aguanta texto y negativos", normalizarReparto(["3", -1, null, 2.9, "x"]).join(",") === "3,0,0,2,0");

/* ── Cupo ───────────────────────────────────────────────────────────────── */
const cupo = crearCupo(3, 60, 1000);
const t0 = 1_000_000;
check("1er envío de la misma IP pasa", cupo("1.1.1.1", t0) === true);
check("2do envío de la misma IP pasa", cupo("1.1.1.1", t0 + 10) === true);
check(`3er envío (el tope de ${MAX_POR_IP}) pasa`, cupo("1.1.1.1", t0 + 20) === true);
check("4to envío de la misma IP se corta", cupo("1.1.1.1", t0 + 30) === false);
check("otra IP no hereda el cupo ajeno", cupo("2.2.2.2", t0 + 40) === true);
check("al vaciarse la ventana vuelve a permitir", cupo("1.1.1.1", t0 + 2000) === true);

const global = crearCupo(1000, 5, 1000);
let pasaron = 0;
for (let i = 0; i < 6; i++) if (global(`ip-${i}`, t0)) pasaron++;
check("el tope global corta aunque cambie la IP", pasaron === 5, `pasaron=${pasaron} de 6`);
check("y se renueva con la ventana", global("ip-9", t0 + 2000) === true);

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
