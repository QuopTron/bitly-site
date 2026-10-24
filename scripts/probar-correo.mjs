#!/usr/bin/env node
/**
 * Envía el correo REAL de compra (y el aviso interno) a un buzón, usando el
 * mismo módulo y el mismo transporte que el sitio.
 *
 * Sirve para comprobar dos cosas antes de que entre una compra de verdad:
 * que la plantilla se ve bien en el cliente de correo y que el SMTP configurado
 * en `.env` sale desde acá. En local el envío usa el cliente SMTP propio de
 * `correo.ts` (Node no tiene `cloudflare:sockets`); en Cloudflare el mismo
 * código va por `worker-mailer`.
 *
 * Uso:
 *   node scripts/probar-correo.mjs pblvmunoz@gmail.com
 *
 * Además deja el HTML en scripts/.cache/correo.html para abrirlo en el
 * navegador sin esperar al buzón.
 */

import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });

// .env local (nunca se sube): el script se corre fuera del bundler, así que
// necesita cargarlo a mano. Si falta el archivo se sigue con el entorno actual.
try {
  process.loadEnvFile(path.join(raiz, ".env"));
} catch {
  /* sin .env: se usan las variables del shell */
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

async function compilar(entrada, salida) {
  await esbuild.build({
    entryPoints: [path.join(raiz, entrada)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: path.join(cache, salida),
    logLevel: "error",
    // El alias de tsconfig (`@/…`) no lo conoce esbuild: se resuelve acá.
    alias: { "@": path.join(raiz, "src") },
    // `worker-mailer` sólo existe en Cloudflare y `node:tls` al revés: los dos
    // se resuelven en tiempo de ejecución, no al compilar.
    external: ["worker-mailer", "cloudflare:sockets", "node:tls"],
  });
  return import(pathToFileURL(path.join(cache, salida)).href + `?v=${Date.now()}`);
}

const destino = (process.argv[2] || process.env.BITLY_ADMIN_EMAIL || "floxdev2024@gmail.com").trim();

const pedido = {
  folio: "FLX-PRUEBA01",
  nombre: "Prueba",
  correo: destino,
  celular: "+59170000000",
  comprobante: "data/comprobantes/FLX-PRUEBA01.png",
  codigo: process.env.CODIGO_PRUEBA || "DEMO.PRUEBA.bGl2ZS1wcnVlYmEtMjAyNg",
};

const plantillas = await compilar("src/server/correo-compra.ts", "correo-compra.mjs");
const { enviarCorreo, correoConfigurado } = await compilar("src/server/correo.ts", "correo.mjs");

const compra = plantillas.cuerpoCorreo(pedido);
const aviso = plantillas.avisoNuevoPedido(pedido);
writeFileSync(path.join(cache, "correo.html"), compra.html, "utf8");

console.log(`Destino: ${destino}`);
console.log(`Correo configurado: ${correoConfigurado() ? "sí" : "NO (faltan variables SMTP/Resend)"}`);
console.log(`Vista previa: ${path.join(cache, "correo.html")}\n`);

if (!correoConfigurado()) {
  console.error("Faltan BITLY_SMTP_HOST / BITLY_SMTP_USER / BITLY_SMTP_PASS / BITLY_EMAIL_FROM en .env.");
  process.exit(2);
}

for (const [nombre, correo] of [
  ["compra", compra],
  ["aviso interno", aviso],
]) {
  const r = await enviarCorreo({ to: destino, ...correo });
  console.log(`${nombre}: ${r.ok ? `enviado por ${r.via}` : `FALLÓ (${r.motivo})`}`);
  if (!r.ok) process.exitCode = 1;
}
