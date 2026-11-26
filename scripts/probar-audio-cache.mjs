#!/usr/bin/env node
/**
 * Prueba el caché de audio contra el módulo real, con Workers KV y la Cache API
 * falsificados.
 *
 * Se comprueba el camino entero —umbral, conteo, troceado de un FLAC grande,
 * manifiesto, lectura seguida y el respaldo cuando no hay KV— sin desplegar ni
 * gastar escrituras. Lo que no se puede probar acá es la red real de Cloudflare:
 * replicación y desalojo se ven en producción.
 *
 * Uso: node scripts/probar-audio-cache.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** rolldown viene con Vite, pero no se puede importar por nombre desde acá. */
function cargarRolldown() {
  const require = createRequire(import.meta.url);
  const vite = require.resolve("vite");
  const camino = require.resolve("rolldown", { paths: [path.dirname(vite)] });
  return import(pathToFileURL(camino).href);
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

/* ── Los almacenes falsos ───────────────────────────────────────────────── */
function crearKvFalso() {
  const datos = new Map();
  return {
    datos,
    async get(clave, tipo = "text") {
      if (!datos.has(clave)) return null;
      const { valor } = datos.get(clave);
      if (tipo === "json") return typeof valor === "string" ? JSON.parse(valor) : null;
      if (tipo === "arrayBuffer") {
        return typeof valor === "string" ? new TextEncoder().encode(valor).buffer : valor;
      }
      return typeof valor === "string" ? valor : new TextDecoder().decode(valor);
    },
    async put(clave, valor, opciones = {}) {
      datos.set(clave, { valor, expira: opciones.expirationTtl ?? null });
    },
  };
}

function crearCacheFalsa() {
  const entradas = new Map();
  return {
    entradas,
    async match(url) {
      const guardada = entradas.get(String(url));
      return guardada ? guardada.clone() : undefined;
    },
    async put(url, respuesta) {
      entradas.set(String(url), new Response(await respuesta.arrayBuffer(), respuesta));
    },
  };
}

const kv = crearKvFalso();
globalThis.__BITLY_AUDIO = kv;
process.env.BITLY_AUDIO_UMBRAL = "3";
delete process.env.BITLY_AUDIO;

// Se empaqueta el módulo real con rolldown (ya viene con Vite) y se ejecuta: así
// el test usa el mismo código que se despliega, sin depender de un build aparte.
const { rolldown } = await cargarRolldown();
const paquete = await rolldown({ input: path.join(raiz, "src", "server", "audio-cache.ts") });
const { output } = await paquete.generate({ format: "esm" });
const codigo = output[0].code;
const { abrir, anotarPedido, disponible, guardar, hay, llaveDe, pedidosDe, umbralSembrar } =
  await import(`data:text/javascript;base64,${Buffer.from(codigo).toString("base64")}`);

const ORIGEN = "https://bitly-site.pages.dev";
const OTRO = "https://preview-123.bitly-site.pages.dev";
const CLAVE = "USUM71607007";

/* ── Lo básico ──────────────────────────────────────────────────────────── */
check("con KV el caché está disponible", disponible() === true);
check("el umbral por defecto es 3", umbralSembrar() === 3);

const llave = await llaveDe(CLAVE, "flac");
check("la llave es un hash estable", llave === (await llaveDe(CLAVE, "flac")), llave);
check("flac y estándar no comparten entrada", llave !== (await llaveDe(CLAVE, "estandar")));
check("sin clave no hay llave", (await llaveDe("", "flac")) === "");

check("recién empezando no hay audio", (await hay(ORIGEN, CLAVE, "flac")) === false);
check("el primero cuenta 1", (await anotarPedido(ORIGEN, CLAVE)) === 1);
check("el segundo cuenta 2", (await anotarPedido(ORIGEN, CLAVE)) === 2);
check("consultar no suma", (await pedidosDe(ORIGEN, CLAVE)) === 2);
check("el tercero cruza el umbral", (await anotarPedido(ORIGEN, CLAVE)) === 3);
check(
  "el conteo quedó guardado con vencimiento",
  kv.datos.get("popularidad.json")?.expira > 300 * 24 * 60 * 60,
);

/* ── Un archivo chico: un solo trozo ────────────────────────────────────── */
const chico = new TextEncoder().encode("ID3-chico");
check(
  "un archivo chico se guarda",
  await guardar(ORIGEN, CLAVE, "estandar", new Blob([chico]).stream(), "audio/mpeg", chico.length),
);
check("y aparece como cacheado", (await hay(ORIGEN, CLAVE, "estandar")) === true);
const chicoLeido = await abrir(ORIGEN, CLAVE, "estandar");
check(
  "se lee de vuelta igual",
  chicoLeido ? (await new Response(chicoLeido.cuerpo).text()) === "ID3-chico" : false,
);
check("con su tipo", chicoLeido?.tipo === "audio/mpeg");
check("un solo trozo", [...kv.datos.keys()].filter((k) => k.endsWith("/0")).length === 1);

/* ── Un FLAC de más de 20 MiB: dos trozos y el mismo archivo ─────────────── */
const grande = new Uint8Array(20 * 1024 * 1024 + 7);
grande[0] = 0x66; // "f"
grande[grande.length - 1] = 0x7a; // "z"
check(
  "un FLAC grande se guarda",
  await guardar(ORIGEN, CLAVE, "flac", new Blob([grande]).stream(), "audio/flac", grande.length),
);
const manifiesto = JSON.parse(kv.datos.get(`${llave}/man`).valor);
check("el manifiesto dice dos trozos", manifiesto.trozos === 2, JSON.stringify(manifiesto));
check("y los bytes reales", manifiesto.bytes === grande.length);
const trozos = [...kv.datos.keys()].filter((k) => k.startsWith(`${llave}/`) && k !== `${llave}/man`);
check("los trozos existen y vencen", trozos.length === 2 && trozos.every((k) => kv.datos.get(k).expira > 0));

const grandeLeido = await abrir(ORIGEN, CLAVE, "flac");
const bytesVuelta = grandeLeido ? new Uint8Array(await new Response(grandeLeido.cuerpo).arrayBuffer()) : null;
check("el archivo vuelve del tamaño exacto", bytesVuelta?.length === grande.length);
check("y con el mismo contenido", bytesVuelta?.[0] === 0x66 && bytesVuelta?.[bytesVuelta.length - 1] === 0x7a);
check("el tipo del FLAC se conserva", grandeLeido?.tipo === "audio/flac");

// KV es global a propósito: cualquier origen ve la misma entrada.
check("otro origen ve la misma entrada (KV es global)", (await hay(OTRO, CLAVE, "flac")) === true);
check(
  "el conteo visible es el último volcado a KV",
  (await pedidosDe(OTRO, CLAVE)) === 1,
  String(await pedidosDe(OTRO, CLAVE)),
);

/* ── Respaldo: sin KV se usa la Cache API ───────────────────────────────── */
const cache = crearCacheFalsa();
globalThis.caches = { default: cache };
delete globalThis.__BITLY_AUDIO;
check("sin KV sigue disponible por la Cache API", disponible() === true);
check("y no ve lo que había en KV", (await hay(ORIGEN, "OTRA-CLAVE", "flac")) === false);
const respaldo = new TextEncoder().encode("ID3-respaldo");
check(
  "guarda en la Cache API",
  await guardar(ORIGEN, "OTRA-CLAVE", "flac", new Blob([respaldo]).stream(), "audio/mpeg", respaldo.length),
);
const respaldoLeido = await abrir(ORIGEN, "OTRA-CLAVE", "flac");
check(
  "y lo devuelve entero",
  respaldoLeido ? (await new Response(respaldoLeido.cuerpo).text()) === "ID3-respaldo" : false,
);
check(
  "la entrada vive en una ruta interna del sitio",
  [...cache.entradas.keys()].some((u) => u.startsWith(`${ORIGEN}/__cache/audio/`)),
);
check(
  "la Cache API sí separa por origen (preview no la ve)",
  (await hay(OTRO, "OTRA-CLAVE", "flac")) === false,
);

/* ── Apagado ────────────────────────────────────────────────────────────── */
globalThis.__BITLY_AUDIO = kv;
process.env.BITLY_AUDIO = "apagado";
check("`BITLY_AUDIO=apagado` lo apaga", disponible() === false);
process.env.BITLY_AUDIO = "encendido";
check("cualquier otro valor lo deja encendido", disponible() === true);
delete process.env.BITLY_AUDIO;

const cacheReal = globalThis.caches;
delete globalThis.caches;
delete globalThis.__BITLY_AUDIO;
check("sin KV ni Cache API queda apagado", disponible() === false);
globalThis.caches = cacheReal;

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
