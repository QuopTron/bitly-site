#!/usr/bin/env node
/**
 * Prueba la SESIÓN de la cuenta con el módulo real de `src/server/cuentas.ts`.
 *
 * Lo que se fija acá es la regla nueva: la sesión se firma con el secreto
 * DEDICADO del sitio (`BITLY_SESSION_SECRET`) y nunca con un token de GitHub
 * prestado. Antes, si el dedicado faltaba, se firmaba con el PAT como clave
 * HMAC: cuando ese PAT se rotó, todas las sesiones murieron a la vez y el
 * síntoma fue "no puedo entrar con mi cuenta".
 *
 * Ahora:
 *   · con el dedicado: se emite sesión y el token vuelve a identificar la cuenta;
 *   · sin el dedicado: NO se emiten sesiones nuevas (`sin_secreto`, que la app
 *     traduce con un mensaje claro) — preferimos decir qué falta antes que
 *     entregar un token que va a morir en la próxima rotación;
 *   · los tokens firmados con la clave vieja (PAT) dejan de valer en cuanto se
 *     configura el dedicado: eso es "los tokens antiguos ya no sirven", y el
 *     usuario vuelve a entrar una sola vez.
 *
 * Uso: node scripts/probar-sesion-cuenta.mjs
 */

import { readdirSync, mkdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = (nombre) => path.join(raiz, "scripts", "pruebas", "stubs", nombre);

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
const salida = path.join(cache, "sesion-cuenta.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "cuentas.ts")],
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
        build.onResolve({ filter: /^(worker-mailer|cloudflare:sockets)$/ }, () => ({
          path: "vacio",
          namespace: "vacio",
        }));
        build.onLoad({ filter: /.*/, namespace: "vacio" }, () => ({ contents: "export default {};", loader: "js" }));
      },
    },
  ],
  outfile: salida,
  logLevel: "error",
});

const { confirmarCuentaImpl, cuentaDeToken } = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

const store = (globalThis.__STORE ??= new Map());
const CODIGO = "123456";
const CUENTA = "cuenta-sesion-1";
// Mismo hash que usa el sitio para el código de confirmación.
const hashDelCodigo = createHash("sha256").update(`bitly-codigo-v1:${CUENTA}:${CODIGO}`).digest("base64");

function sembrarCuenta() {
  store.set(
    "data/cuentas.json",
    JSON.stringify([
      {
        id: CUENTA,
        usuario: "ana",
        nombre: "Ana",
        correo: "ana@ejemplo.com",
        creado: "2026-01-01T00:00:00.000Z",
        actualizado: "2026-01-01T00:00:00.000Z",
        correoConfirmado: false,
        pendiente: { tipo: "alta", hash: hashDelCodigo, expira: Date.now() + 60_000, intentos: 0 },
      },
    ]),
  );
}

/** Token como los firmaba el sitio ANTES: HMAC con el token de GitHub. */
function tokenConClaveVieja(id, pat) {
  const payload = Buffer.from(JSON.stringify({ c: id, e: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  const firma = createHmac("sha256", `bitly-session-v1:${pat}`).update(Buffer.from(payload, "base64url")).digest("base64url");
  return `${payload}.${firma}`;
}

const PAT = "ghp_token-de-github-viejo";

/* ── 1. Con el secreto dedicado: la sesión funciona ────────────────────── */
process.env.BITLY_SESSION_SECRET = "secreto-propio-de-sesiones-2026";
process.env.BITLY_CODES_TOKEN = PAT;
sembrarCuenta();

const conSecreto = await confirmarCuentaImpl({ correo: "ana@ejemplo.com", codigo: CODIGO });
check("con el secreto propio se confirma y se entrega sesión", conSecreto.ok === true, JSON.stringify(conSecreto).slice(0, 80));
if (conSecreto.ok) {
  const cuenta = await cuentaDeToken(conSecreto.token);
  check("y el token vuelve a identificar la cuenta", cuenta?.id === CUENTA, String(cuenta?.id));
}

/* ── 2. Sin secreto dedicado: no se emiten sesiones ────────────────────── */
delete process.env.BITLY_SESSION_SECRET;
sembrarCuenta();
const sinSecreto = await confirmarCuentaImpl({ correo: "ana@ejemplo.com", codigo: CODIGO });
check(
  "sin secreto propio NO se emite sesión (motivo sin_secreto)",
  sinSecreto.ok === false && sinSecreto.motivo === "sin_secreto",
  JSON.stringify(sinSecreto),
);

/* ── 3. Los tokens viejos (firmados con el PAT) dejan de valer ─────────── */
const viejo = tokenConClaveVieja(CUENTA, PAT);
process.env.BITLY_SESSION_SECRET = ""; // todavía sin dedicado: se puede verificar
check(
  "mientras no hay dedicado, el token viejo todavía se puede verificar",
  (await cuentaDeToken(viejo))?.id === CUENTA,
  "así nadie queda afuera mientras se configura",
);

process.env.BITLY_SESSION_SECRET = "secreto-propio-de-sesiones-2026";
check(
  "al configurar el dedicado, el token viejo deja de valer",
  (await cuentaDeToken(viejo)) === null,
  "es el \"los tokens antiguos ya no sirven\": el usuario entra de nuevo una vez",
);
const nuevo = await confirmarCuentaImpl({ correo: "ana@ejemplo.com", codigo: CODIGO });
check("y con la sesión nueva sí vuelve a entrar", nuevo.ok === true);
if (nuevo.ok) check("el token nuevo es distinto del viejo", nuevo.token !== viejo);

/* ── 4. Sin ningún secreto no se verifica nada ────────────────────────── */
delete process.env.BITLY_SESSION_SECRET;
delete process.env.BITLY_CODES_TOKEN;
delete process.env.BITLY_DATA_TOKEN;
check(
  "sin ningún secreto configurado, ninguna sesión vale (se trata como vencida)",
  (await cuentaDeToken(viejo)) === null,
);

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
