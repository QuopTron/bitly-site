#!/usr/bin/env node
/**
 * Vuelve a dejar a TODAS las cuentas con las 75 canciones gratis.
 *
 * Por qué existe: el tope de 75 se acumulaba para siempre y quien probó la app
 * quedaba en cero aunque el plan gratis siga vigente. El dueño lo pidió así:
 * «deben ser 75 para todos otra vez». Esto corre el MISMO motor del sitio
 * (`src/server/descargas-cuenta.ts`), con el `.env` real, así que escribe
 * `data/descargas.json` en `bitly-data` con el mismo cifrado y la misma cola
 * que usa el Worker. No hay una segunda forma de tocar esa cuota.
 *
 * Los EVENTOS del historial no se borran: sólo se pone el contador en cero.
 *
 * Uso:
 *   node scripts/reiniciar-cuota.mjs         # aplica el reinicio
 *   node scripts/reiniciar-cuota.mjs --ver   # sólo muestra cómo está hoy
 *
 * Necesita en `.env`: BITLY_DATA_TOKEN (o BITLY_CODES_TOKEN) y, si la base está
 * cifrada, BITLY_DATA_SECRET.
 */

import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerEnv, raiz, stub } from "./pruebas/entorno.mjs";

const soloVer = process.argv.includes("--ver");

/** Los secretos del almacenamiento van al entorno (los lee el módulo real). */
const env = leerEnv();
for (const clave of ["BITLY_DATA_TOKEN", "BITLY_CODES_TOKEN", "BITLY_DATA_SECRET", "BITLY_DATA_REPO"]) {
  if (env[clave] !== undefined) process.env[clave] = env[clave];
}

if (!process.env.BITLY_DATA_TOKEN && !process.env.BITLY_CODES_TOKEN) {
  console.error(
    "Falta BITLY_DATA_TOKEN (o BITLY_CODES_TOKEN) en .env: sin token no se puede tocar la cuota real.",
  );
  process.exit(1);
}

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
const salida = path.join(cache, "reiniciar-cuota.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "descargas-cuenta.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: { "@": path.join(raiz, "src") },
  plugins: [
    {
      name: "dobles-de-prueba",
      setup(build) {
        // Sólo se dobla lo que es de la plataforma del Worker: el
        // almacenamiento y el cifrado son los REALES (escribe la base de verdad).
        build.onResolve({ filter: /^@tanstack\// }, () => ({ path: stub("start.mjs") }));
        build.onResolve({ filter: /^@\/server\/ip$/ }, () => ({ path: stub("ip.mjs") }));
        // El correo no participa del reinicio, pero su módulo se importa de
        // paso: `worker-mailer` es de Workers (cloudflare:sockets) y en Node no
        // existe. Se dobla vacío para poder compilar.
        build.onResolve({ filter: /^(worker-mailer|cloudflare:sockets)$/ }, () => ({
          path: "vacio",
          namespace: "vacio",
        }));
        build.onLoad({ filter: /.*/, namespace: "vacio" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
  outfile: salida,
  logLevel: "error",
});

const { LIMITE_DESCARGAS, reiniciarCuotaGlobal, resumenCuota } = await import(
  pathToFileURL(salida).href + `?v=${Date.now()}`
);

const antes = await resumenCuota();

if (soloVer) {
  console.log(`Cuota de la base real (data/descargas.json) · límite ${LIMITE_DESCARGAS}`);
  console.log(`  cuentas con registro: ${antes.total}`);
  console.log(`  con las 75 completas: ${antes.completas}`);
  console.log(`  descargas gastadas: ${antes.gastadas}`);
} else {
  const resultado = await reiniciarCuotaGlobal();
  if (!resultado.ok) {
    console.error(`No se pudo reiniciar la cuota: ${resultado.motivo}`);
    process.exitCode = 1;
  } else {
    const despues = await resumenCuota();
    console.log(`Cuota reiniciada a ${LIMITE_DESCARGAS} para todos · ${resultado.cuando}`);
    console.log(`  cuentas tocadas: ${resultado.cuentas}`);
    console.log(
      `  antes:  ${antes.completas}/${antes.total} completas (${antes.gastadas} descargas usadas)`,
    );
    console.log(
      `  ahora: ${despues.completas}/${despues.total} completas (${despues.gastadas} usadas)`,
    );
    if (despues.gastadas !== 0 || despues.completas !== despues.total) {
      console.error("La comprobación falló: quedaron cuentas sin reiniciar.");
      process.exitCode = 1;
    }
  }
}

// Se apaga esbuild antes de salir: si queda el proceso hijo vivo, Node tira un
// fallo de libuv al cerrar.
await esbuild.stop();
