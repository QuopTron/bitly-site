#!/usr/bin/env node
/**
 * Prueba que el SITIO puede emitir códigos que la APP acepta.
 *
 * Es el circuito que estaba roto: `scripts/keys/private_key.pem` guarda la
 * SEMILLA cruda de 32 bytes dentro del sobre PEM (así la lee
 * `generar_codigo.py`), pero el sitio la importaba como PKCS#8, WebCrypto la
 * rechazaba y `clavePrivada()` devolvía null. Resultado: `emitirCodigos` caía al
 * respaldo del registro y, sin códigos libres, el panel no entregaba nada.
 *
 * Lo que se comprueba acá, con el módulo real y el `BITLY_CODIGOS_CLAVE` real:
 *   1. firma de verdad (`origen: "firma"`), no respaldo;
 *   2. el código lo verifica la MISMA clave pública que lleva la app
 *      (`go_backend/internal/premium/firmados.go`);
 *   3. el payload declara la palabra y el tier que la app exige.
 *
 * La clave privada NUNCA se versiona: si no está en la máquina, la prueba se
 * saltea. El código firmado vive solo en memoria y no se imprime.
 *
 * Uso: node scripts/probar-codigos-sitio.mjs
 */

import { readdirSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createPublicKey, verify as verificarFirma } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = (nombre) => path.join(raiz, "scripts", "pruebas", "stubs", nombre);
const RUTA_CLAVE = path.join(path.dirname(raiz), "bitly", "scripts", "keys", "private_key.pem");

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

if (!existsSync(RUTA_CLAVE)) {
  console.log(`SALTEADA: no está ${RUTA_CLAVE} (la clave privada no se versiona).`);
  process.exit(0);
}

// Igual que en producción: el secreto se pega tal cual está el archivo (PEM con
// la semilla adentro). Es el caso que estaba roto.
process.env.BITLY_CODIGOS_CLAVE = readFileSync(RUTA_CLAVE, "utf8");

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
const salida = path.join(cache, "codigos-sitio.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "codigos.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: { "@": path.join(raiz, "src") },
  plugins: [
    {
      name: "dobles-de-prueba",
      setup(build) {
        build.onResolve({ filter: /^@tanstack\// }, () => ({ path: stub("start.mjs") }));
        build.onResolve({ filter: /^@\/server\/github-store$/ }, () => ({ path: stub("github-store.mjs") }));
      },
    },
  ],
  outfile: salida,
  logLevel: "error",
});

const { emitirCodigos, firmaConfigurada } = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

check("el despliegue queda con firma configurada", firmaConfigurada() === true);

const emision = await emitirCodigos(2, "FLX-PRUEBA", new Set());
check(
  'los códigos salen FIRMADOS (no del registro viejo)',
  emision.ok === true && emision.origen === "firma",
  JSON.stringify({ ok: emision.ok, origen: emision.origen, motivo: emision.motivo }),
);
if (!emision.ok) {
  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  process.exit(1);
}
check("emite la cantidad pedida", emision.codigos.length === 2);
check("los códigos no se repiten", emision.codigos[0] !== emision.codigos[1]);

/* ── La verificación de la APP, con la clave pública que ella lleva ─────── */
// La app valida con Ed25519 cruda (32 bytes en base64) — ver
// go_backend/internal/premium/firmados.go, `clavePublicaFirmados`.
const PUBLICA_APP = "DPVABxXjluqWrBCKM9d7dh4dpPYDYq6h22s2m+9gJ6g=";
const spki = Buffer.concat([
  Buffer.from("302a300506032b6570032100", "hex"),
  Buffer.from(PUBLICA_APP, "base64"),
]);
const publica = createPublicKey({ key: spki, format: "der", type: "spki" });

const partes = emision.codigos[0].split(".");
check("el código usa el formato BITLY2", partes.length === 3 && partes[0] === "BITLY2");
const payload = Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
const firma = Buffer.from(partes[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
check("la firma valida con la clave pública de la app", verificarFirma(null, payload, publica, firma) === true);

const declarado = JSON.parse(payload.toString("utf8"));
check('el payload declara la palabra autorizada "pablo"', declarado.p === "pablo", JSON.stringify(declarado));
check('y el tier que la app entiende como Premium', declarado.t === "premium");
check("el código vence en el futuro (365 días)", declarado.e > Math.floor(Date.now() / 1000) + 300 * 24 * 3600);
check("lleva identificador para encontrarlo en el registro", typeof declarado.i === "string" && declarado.i.length > 0);

/* ── Y el registro de emitidos queda anotado ───────────────────────────── */
const emitidos = JSON.parse(globalThis.__STORE?.get("data/codigos-emitidos.json") ?? "{}");
check(
  "los emitidos se registran (la demo del sitio los acredita)",
  JSON.stringify(emitidos).includes("FLX-PRUEBA"),
);

/* ── Una semilla suelta en base64 (base64url) también sirve ────────────── */
const semilla = readFileSync(RUTA_CLAVE, "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
process.env.BITLY_CODIGOS_CLAVE = semilla;
const otra = await import(pathToFileURL(salida).href + `?v=${Date.now() + 1}`);
check(
  "la semilla en base64 (sin sobre PEM) también firma",
  (await otra.emitirCodigos(1, "FLX-PRUEBA2", new Set())).origen === "firma",
);

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
