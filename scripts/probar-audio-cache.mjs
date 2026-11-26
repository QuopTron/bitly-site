#!/usr/bin/env node
/**
 * Prueba el caché de audio contra el módulo real, con la Cache API falsificada.
 *
 * Así se comprueba el camino entero —umbral, conteo, aporte y lectura— sin
 * desplegar ni gastar peticiones: `caches.default` se reemplaza por un Map que
 * imita `match`/`put`. Lo que no se puede probar acá es el comportamiendo real
 * del CDN (desalojo, caché por centro de datos); eso se ve en producción.
 *
 * Uso: node scripts/probar-audio-cache.mjs
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/* ── La Cache API falsa ─────────────────────────────────────────────────── */
const entradas = new Map(); // url -> Response
const puts = [];
globalThis.caches = {
  default: {
    async match(url) {
      const guardada = entradas.get(String(url));
      return guardada ? guardada.clone() : undefined;
    },
    async put(url, respuesta) {
      puts.push(String(url));
      // Como el CDN: se queda con una copia, no con el cuerpo del llamador.
      entradas.set(String(url), new Response(await respuesta.arrayBuffer(), respuesta));
    },
  },
};

process.env.BITLY_AUDIO_UMBRAL = "3";
delete process.env.BITLY_AUDIO;

// Node 24 ejecuta TypeScript directamente: se importa el módulo real, sin build.
const { abrir, anotarPedido, disponible, guardar, hay, llaveDe, pedidosDe, umbralSembrar } =
  await import(pathToFileURL(path.join(raiz, "src", "server", "audio-cache.ts")).href);

const ORIGEN = "https://bitly-site.pages.dev";
const OTRO = "https://preview-123.bitly-site.pages.dev";

/* ── Camino completo ────────────────────────────────────────────────────── */
check("con Cache API el caché está disponible", disponible() === true);
check("el umbral por defecto es 3", umbralSembrar() === 3);

const llave = await llaveDe("USUM71607007", "flac");
check("la llave es estable", llave === (await llaveDe("USUM71607007", "flac")), llave);
check("flac y estándar no comparten entrada", llave !== (await llaveDe("USUM71607007", "estandar")));
check("sin clave no hay llave", (await llaveDe("", "flac")) === "");

check("recién empezando no hay audio", (await hay(ORIGEN, "USUM71607007", "flac")) === false);
check("el conteo arranca en cero", (await pedidosDe(ORIGEN, "USUM71607007")) === 0);
check("el primer pedido cuenta 1", (await anotarPedido(ORIGEN, "USUM71607007")) === 1);
check("el segundo pedido cuenta 2", (await anotarPedido(ORIGEN, "USUM71607007")) === 2);
check("el conteo se puede consultar sin sumar", (await pedidosDe(ORIGEN, "USUM71607007")) === 2);
check("el tercer pedido cruza el umbral", (await anotarPedido(ORIGEN, "USUM71607007")) === 3);

const bytes = new TextEncoder().encode("ID3-audio-de-prueba");
const guardado = await guardar(
  ORIGEN,
  "USUM71607007",
  "flac",
  new Blob([bytes]).stream(),
  "audio/mpeg",
);
check("el aporte se guarda", guardado === true);
check("después del aporte hay audio", (await hay(ORIGEN, "USUM71607007", "flac")) === true);
check("otra calidad sigue vacía", (await hay(ORIGEN, "USUM71607007", "estandar")) === false);
check("el conteo no se escribió dos veces por pedido", puts.filter((u) => u.includes("popularidad")).length === 1);

const leido = await abrir(ORIGEN, "USUM71607007", "flac");
check("la lectura devuelve el archivo", Boolean(leido));
check("y son los mismos bytes", leido ? (await leido.text()) === "ID3-audio-de-prueba" : false);
check("conserva el tipo declarado", leido?.headers.get("content-type") === "audio/mpeg");
check("la entrada vive en una ruta interna del propio sitio", puts.some((u) => u.startsWith(`${ORIGEN}/__cache/audio/`)));

check(
  "otro origen (preview) no ve la entrada",
  (await hay(OTRO, "USUM71607007", "flac")) === false,
);
check("y su conteo es propio", (await pedidosDe(OTRO, "USUM71607007")) === 0);

/* ── Apagado ────────────────────────────────────────────────────────────── */
process.env.BITLY_AUDIO = "apagado";
check("`BITLY_AUDIO=apagado` lo apaga", disponible() === false);
process.env.BITLY_AUDIO = "encendido";
check("cualquier otro valor lo deja encendido", disponible() === true);
delete process.env.BITLY_AUDIO;

const cacheReal = globalThis.caches;
delete globalThis.caches;
check("sin Cache API queda apagado", disponible() === false);
globalThis.caches = cacheReal;

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
