#!/usr/bin/env node
/**
 * Verifica el cifrado en reposo de la base (`src/server/cifrado.ts`).
 *
 * Lo que importa comprobar acá no es "cifra", sino las tres cosas que pueden
 * romper la base en producción: que el texto no quede en claro, que con el
 * secreto correcto vuelva idéntico y que un secreto equivocado NO devuelva
 * basura silenciosa. También que un archivo viejo en claro se siga leyendo.
 *
 * Uso: node scripts/probar-cifrado.mjs
 */

import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });

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
const salida = path.join(cache, "cifrado.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "cifrado.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: salida,
  logLevel: "error",
});

const m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

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

// 1. Sin secreto no se cifra: así sigue andando el desarrollo local.
delete process.env.BITLY_DATA_SECRET;
check("sin secreto no está activo", m.cifradoActivo() === false);

// 2. Un secreto demasiado corto se ignora (no da falsa seguridad).
process.env.BITLY_DATA_SECRET = "corto";
check("secreto corto se ignora", m.cifradoActivo() === false);

// 3. Round-trip del JSON con el secreto de verdad.
process.env.BITLY_DATA_SECRET = "frase-de-prueba-larga-para-derivar-clave";
check("con secreto está activo", m.cifradoActivo() === true);

const original = JSON.stringify({ folio: "FLX-ABC", correo: "pblvmunoz@gmail.com", nota: "hola" }, null, 2);
const sobreTexto = await m.cifrarTexto(original);
const sobre = JSON.parse(sobreTexto);
check("el sobre se marca como cifrado", sobre._cifrado === "aes-256-gcm");
check("no queda texto en claro", !sobreTexto.includes("pblvmunoz") && !sobreTexto.includes("FLX-ABC"));
check("el sobre es JSON de una sola pieza", typeof sobre.datos === "string" && sobre.datos.length > 20);

const vuelto = await m.descifrarSobre(sobre);
check("vuelve idéntico", vuelto === original);

// 4. Dos cifrados del mismo texto NO son iguales (IV aleatorio).
const otro = await m.cifrarTexto(original);
check("IV distinto en cada cifrado", otro !== sobreTexto);

// 5. Binarios (comprobantes): marca BLY1, round-trip y paso de lo viejo.
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
const pngCifrado = await m.cifrarBase64(png);
check("el binario cifrado no arranca con el PNG original", !pngCifrado.startsWith("iVBORw0KGgo"));
check("el binario vuelve igual", (await m.descifrarBase64(pngCifrado)) === png);
check("un archivo viejo en claro pasa tal cual", (await m.descifrarBase64(png)) === png);

// 6. Secreto equivocado: tiene que fallar, no devolver basura.
process.env.BITLY_DATA_SECRET = "otra-frase-distinta-larga-para-la-clave";
const mod2 = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);
let fallo = false;
try {
  await mod2.descifrarSobre(sobre);
} catch {
  fallo = true;
}
check("con otro secreto no descifra", fallo);

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exit(1);
