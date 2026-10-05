#!/usr/bin/env node
/**
 * Verifica la cuota de la demo: 4 reproducciones por ventana DESLIZANTE de 2 h.
 *
 * La regla es la única parte del reproductor que no se ve a simple vista (el
 * contador solo se nota después de 4 canciones y 2 horas), así que se comprueba
 * acá contra el módulo real, no contra una copia.
 *
 * Uso: node scripts/probar-cuota.mjs
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

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const salida = path.join(cache, "cuota.mjs");

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

try {
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", "lib", "demo-cuota.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: salida,
    logLevel: "error",
  });
  const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);
  const { REPRODUCCIONES, VENTANA_MS, calcularCuota } = m;

  console.log(`REPRODUCCIONES=${REPRODUCCIONES}  VENTANA_MS=${VENTANA_MS}\n`);

  check("son 4 reproducciones", REPRODUCCIONES === 4, String(REPRODUCCIONES));
  check("la ventana son 2 horas", VENTANA_MS === 2 * 60 * 60 * 1000, String(VENTANA_MS));

  const AHORA = 1_700_000_000_000;

  check("sin usar quedan las 4", calcularCuota([], AHORA).restantes === 4);

  // 4 gastadas ahora mismo: agotada, y la más vieja vence en ~2 h.
  const cuatro = [AHORA - 3000, AHORA - 2000, AHORA - 1000, AHORA];
  const agotada = calcularCuota(cuatro, AHORA);
  check("4 gastadas ⇒ no queda ninguna", agotada.restantes === 0);
  check("4 gastadas ⇒ gastadas=4", agotada.gastadas === 4);
  check(
    "reinicia a las 2 h de la más vieja",
    Math.abs(agotada.reiniciaEnMs - (VENTANA_MS - 3000)) < 5,
    `${agotada.reiniciaEnMs} ms`,
  );

  // Una de las 4 ya pasó las 2 h: vuelve a haber una.
  const vieja = [AHORA - VENTANA_MS - 1000, AHORA - 2000, AHORA - 1000, AHORA];
  const liberada = calcularCuota(vieja, AHORA);
  check("al vencer la más vieja se libera 1", liberada.restantes === 1, `restantes=${liberada.restantes}`);
  check("con lugar, reiniciaEnMs = 0", liberada.reiniciaEnMs === 0);

  // El borde: exactamente 2 h NO cuenta (la ventana es abierta).
  check(
    "exactamente 2 h ya no cuenta",
    calcularCuota([AHORA - VENTANA_MS, AHORA - VENTANA_MS, AHORA - VENTANA_MS, AHORA - VENTANA_MS], AHORA)
      .restantes === 4,
  );
  check(
    "1 ms antes de las 2 h todavía cuenta",
    calcularCuota([AHORA - VENTANA_MS + 1], AHORA).restantes === 3,
  );

  // Parcial: 3 usadas ⇒ queda 1.
  check("3 gastadas ⇒ queda 1", calcularCuota(cuatro.slice(0, 3), AHORA).restantes === 1);

  // Marcas basura no rompen el conteo.
  check("marcas inválidas se ignoran", calcularCuota([NaN, AHORA], AHORA).restantes === 3);
} finally {
  try {
    rmSync(salida, { force: true });
  } catch {
    // En Windows el archivo puede quedar momentáneamente ocupado.
  }
}

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
process.exit(fallos === 0 ? 0 : 1);
