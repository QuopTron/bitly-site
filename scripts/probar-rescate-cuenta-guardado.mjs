#!/usr/bin/env node
/**
 * Prueba el IDA Y VUELTA de la configuración de rescate por cuenta contra el
 * módulo real, con la API de GitHub falsificada.
 *
 * Lo que se comprueba acá es el camino de guardado entero —leer lo que ya había,
 * mezclar la cuenta, escribir con `sha` y borrar— sin tocar `bitly-data`: el
 * `fetch` global se reemplaza por un doble que imita la Contents API (sha,
 * 404 al no existir, 409 si el sha quedó viejo). El token del repo no hace
 * falta: se usa uno de mentira porque ninguna petición sale a la red.
 *
 * Uso: node scripts/probar-rescate-cuenta-guardado.mjs
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

/* ── El repo falso ──────────────────────────────────────────────────────── */
const RUTA = "data/rescate.json";
const archivos = new Map(); // ruta -> { texto, sha }
const commits = [];
let siguienteSha = 1;

function sembrar(ruta, objeto) {
  archivos.set(ruta, { texto: JSON.stringify(objeto, null, 2) + "\n", sha: `sha-${siguienteSha++}` });
}

// Estas son las claves que el sitio tiene en producción: el token va de mentira
// porque el fetch está doblado y ninguna petición sale a la red.
process.env.BITLY_DATA_TOKEN = "token-de-mentira";
process.env.BITLY_DATA_REPO = "QuopTron/bitly-data-falso";
// Sin secreto el JSON va en claro: así se puede leer lo que se guardó.
delete process.env.BITLY_DATA_SECRET;

const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const pedido = String(url);
  const metodo = (init.method ?? "GET").toUpperCase();
  const ruta = pedido.split("/contents/")[1]?.split("?")[0];
  const respuesta = (cuerpo, status = 200) =>
    new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (!ruta) throw new Error(`petición inesperada: ${pedido}`);
  const actual = archivos.get(ruta);

  if (metodo === "GET") {
    if (!actual) return respuesta({ message: "Not Found" }, 404);
    const crudo = (init.headers?.Accept ?? "").includes("raw");
    if (crudo) return new Response(actual.texto, { status: 200, headers: { "Content-Type": "text/plain" } });
    return respuesta({
      sha: actual.sha,
      content: Buffer.from(actual.texto, "utf8").toString("base64"),
      encoding: "base64",
    });
  }

  if (metodo === "PUT") {
    const cuerpo = JSON.parse(String(init.body));
    if (cuerpo.sha && actual && cuerpo.sha !== actual.sha) return respuesta({ message: "Conflict" }, 409);
    if (cuerpo.branch !== "main") throw new Error("la rama tiene que ser main");
    const texto = Buffer.from(cuerpo.content, "base64").toString("utf8");
    archivos.set(ruta, { texto, sha: `sha-${siguienteSha++}` });
    commits.push({ mensaje: cuerpo.message, conSha: Boolean(cuerpo.sha) });
    return respuesta({ content: { sha: archivos.get(ruta).sha } });
  }

  throw new Error(`método inesperado: ${metodo}`);
};

/* ── El módulo real ─────────────────────────────────────────────────────── */
const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const salida = path.join(cache, "rescate-cuenta-guardado.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "rescate-cuenta.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: { "@": path.join(raiz, "src") },
  outfile: salida,
  logLevel: "error",
});

const { rescateDeCuenta, guardarRescateDeCuenta, borrarRescateDeCuenta } = await import(
  pathToFileURL(salida).href + `?v=${Date.now()}`
);

const leerArchivo = () => JSON.parse(archivos.get(RUTA)?.texto ?? "{}");

/* ── Camino de guardado ─────────────────────────────────────────────────── */
sembrar(RUTA, { "otra-cuenta": { arcod: true, actualizado: "2026-01-01T00:00:00.000Z" } });

check("sin nada guardado la cuenta devuelve vacío", JSON.stringify(await rescateDeCuenta("cuenta-1")) === "{}");
check("una cuenta sin id no consulta nada", JSON.stringify(await rescateDeCuenta("")) === "{}");

const guardado = await guardarRescateDeCuenta("cuenta-1", {
  mirrors: ["https://a.test"],
  arcod: false,
  arcod_token: "no-puede-entrar",
  espejos: true,
});
check("el guardado da ok", guardado.ok === true);
check("devuelve la config ya limpia", guardado.config?.mirrors?.[0] === "https://a.test" && guardado.config?.espejos === true);
check("el secreto no llegó al archivo", JSON.stringify(leerArchivo()).includes("arcod_token") === false);
check(
  "la cuenta vieja queda intacta",
  leerArchivo()["otra-cuenta"]?.arcod === true && leerArchivo()["otra-cuenta"]?.actualizado === "2026-01-01T00:00:00.000Z",
  JSON.stringify(leerArchivo()["otra-cuenta"]),
);
check("la cuenta nueva sí se guardó", leerArchivo()["cuenta-1"]?.arcod === false);
check("queda el sello de cuándo se actualizó", typeof leerArchivo()["cuenta-1"]?.actualizado === "string");
check("se escribió con sha (actualización, no creación)", commits.at(-1)?.conSha === true);
check("el commit dice qué se tocó", /rescate/i.test(commits.at(-1)?.mensaje ?? ""), commits.at(-1)?.mensaje);

check(
  "al releer, la cuenta tiene lo suyo y no lo de la otra",
  (await rescateDeCuenta("cuenta-1"))?.mirrors?.[0] === "https://a.test" &&
    (await rescateDeCuenta("otra-cuenta"))?.actualizado === "2026-01-01T00:00:00.000Z",
);

const commitsAntes = commits.length;
const basura = await guardarRescateDeCuenta("cuenta-1", { otra: 1 });
check("un pedido sin nada aprovechable es error de datos", basura.ok === false && basura.motivo === "datos");
check("y no cuesta una escritura", commits.length === commitsAntes);

const borrado = await borrarRescateDeCuenta("cuenta-1");
check("borrar la cuenta da ok", borrado.ok === true);
check("la cuenta borrada ya no está", leerArchivo()["cuenta-1"] === undefined);
check("la otra cuenta sigue ahí", leerArchivo()["otra-cuenta"]?.arcod === true);
check("borrar dos veces no rompe", (await borrarRescateDeCuenta("cuenta-1")).ok === true);

globalThis.fetch = fetchReal;

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
