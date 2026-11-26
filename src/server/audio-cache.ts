/**
 * Caché de audio OPCIONAL, solo para las canciones más pedidas.
 *
 * Por qué existe: el catálogo compartido evita volver a buscar la canción, pero
 * el audio se sigue bajando del proveedor. Si un tema lo piden muchas personas,
 * guardarlo una vez ahorra las siguientes descargas.
 *
 * Dónde se guarda, en dos capas:
 *
 * 1. **Fría** (`BITLY_AUDIO_REPOS` + `BITLY_AUDIO_TOKEN`): un repo privado de
 *    GitHub. Guarda todo lo sembrado, sin vencimiento, con el archivo partido
 *    en trozos. Es el archivo de verdad. Ver `github.ts`.
 * 2. **Caliente** (`BITLY_AUDIO` como binding de KV): global y rápido; entra en
 *    el plan gratis sin tarjeta. Si no hay KV, se usa la Cache API, que viene
 *    incluida pero es por centro de datos y desalojable. Ver `kv.ts` y
 *    `cache-api.ts`.
 *
 * Leer mira caliente y después frío; aportar escribe siempre en el frío y
 * copia al caliente si el archivo es chico. Ver `dos-capas.ts`.
 *
 * Con ninguna de las dos responde `apagado` y la app sigue usando los
 * proveedores. Para apagarlo igual: variable de entorno `BITLY_AUDIO=apagado`.
 *
 * Qué se guarda: solo audio ya descargado por un usuario con sesión, y solo si
 * la canción supera [`umbralSembrar`] pedidos (configurable con
 * `BITLY_AUDIO_UMBRAL`). La ruta es el SHA-256 de `ISRC|calidad`, nunca un
 * título ni nada que venga del usuario sin normalizar.
 */

import type { Almacen, Archivo } from "./audio-cache/almacen";
import { cacheApi, namespaceKv } from "./audio-cache/almacen";
import { crear as crearCacheApi } from "./audio-cache/cache-api";
import { crear as crearDosCapas } from "./audio-cache/dos-capas";
import { configurar as configurarGithub, crear as crearGithub } from "./audio-cache/github";
import { crear as crearKv } from "./audio-cache/kv";

const VIDA_MEMORIA_MS = 60_000;
const ESPERA_ESCRITURA_MS = 60_000;
const MAX_CLAVES = 5_000;
/** El conteo dura mucho más que el audio: perderlo reinicia el umbral. */
const VIDA_CONTEO_SEG = 365 * 24 * 60 * 60;
const APAGADOS = new Set(["0", "off", "no", "false", "apagado"]);

/**
 * Pedidos necesarios para cachear. Se lee en cada llamada: `_worker.js` siembra
 * `process.env` en la primera petición, después de evaluar este módulo.
 */
export function umbralSembrar(): number {
  return Math.max(1, Number(process.env?.BITLY_AUDIO_UMBRAL) || 3);
}
/** Tope por archivo: un FLAC típico entra; un show completo no. */
export const MAX_BYTES = 40 * 1024 * 1024;

/**
 * El almacén que toca: caliente (KV o Cache API) + frío (repo de GitHub).
 * `null` = apagado.
 */
function almacen(origen: string): Almacen | null {
  const kv = namespaceKv();
  const cache = cacheApi();
  const caliente = kv ? crearKv(kv) : cache ? crearCacheApi(cache, origen) : null;
  const config = configurarGithub();
  return crearDosCapas(caliente, config ? crearGithub(config) : null);
}

/** Si el sitio puede guardar y servir audio. Sin esto todo contesta `apagado`. */
export function disponible(): boolean {
  const ajuste = String(process.env?.BITLY_AUDIO ?? "").trim().toLowerCase();
  if (ajuste && APAGADOS.has(ajuste)) return false;
  return Boolean(namespaceKv() || cacheApi() || configurarGithub());
}

/** La misma normalización que el catálogo: ISRC en mayúsculas, sin signos. */
export function claveDe(valor: unknown): string {
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\-_|]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Calidad normalizada; cualquier cosa que no sea FLAC se trata como estándar. */
export function calidadDe(valor: unknown): string {
  return String(valor ?? "").trim().toLowerCase().startsWith("flac") ? "flac" : "estandar";
}

/** La ruta del archivo: un hash estable de canción + calidad. */
export async function llaveDe(clave: string, calidad: string): Promise<string> {
  if (!clave) return "";
  const bytes = new TextEncoder().encode(`${clave}|${calidad}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `audio/${hex}`;
}

type Memoria = { datos: Record<string, number>; expira: number; ultimaEscritura: number };
const memorias = new Map<string, Memoria>();

function memoriaDe(origen: string): Memoria {
  let memoria = memorias.get(origen);
  if (!memoria) {
    memoria = { datos: {}, expira: 0, ultimaEscritura: 0 };
    memorias.set(origen, memoria);
  }
  return memoria;
}

async function popularidad(origen: string): Promise<Record<string, number>> {
  const memoria = memoriaDe(origen);
  if (memoria.expira > Date.now()) return memoria.datos;
  const texto = await almacen(origen)?.leerTexto("popularidad.json", VIDA_CONTEO_SEG);
  let datos: Record<string, number> = {};
  try {
    for (const [clave, valor] of Object.entries(
      JSON.parse(texto ?? "{}") as Record<string, unknown>,
    )) {
      const n = Number(valor);
      if (clave && Number.isFinite(n) && n > 0) datos[clave] = n;
    }
  } catch {
    datos = {};
  }
  memoria.datos = datos;
  memoria.expira = Date.now() + VIDA_MEMORIA_MS;
  return datos;
}

/** Guarda el conteo sin inundar el almacén: como mucho una escritura por minuto. */
async function persistir(origen: string, datos: Record<string, number>): Promise<void> {
  const memoria = memoriaDe(origen);
  if (Date.now() - memoria.ultimaEscritura < ESPERA_ESCRITURA_MS) return;
  memoria.ultimaEscritura = Date.now();
  const recorte: Record<string, number> = {};
  for (const clave of Object.keys(datos).sort((a, b) => datos[b]! - datos[a]!).slice(0, MAX_CLAVES)) {
    recorte[clave] = datos[clave]!;
  }
  await almacen(origen)?.escribirTexto(
    "popularidad.json",
    JSON.stringify(recorte),
    VIDA_CONTEO_SEG,
  );
}

/** Cuenta un pedido de descarga y devuelve el total de esa canción. */
export async function anotarPedido(origen: string, clave: string): Promise<number> {
  if (!clave) return 0;
  const datos = await popularidad(origen);
  const n = (datos[clave] ?? 0) + 1;
  datos[clave] = n;
  await persistir(origen, datos);
  return n;
}

/** El conteo actual, sin incrementarlo (lo usa el aporte). */
export async function pedidosDe(origen: string, clave: string): Promise<number> {
  return clave ? ((await popularidad(origen))[clave] ?? 0) : 0;
}

/** Si esa canción y calidad ya están cacheadas. */
export async function hay(origen: string, clave: string, calidad: string): Promise<boolean> {
  const llave = await llaveDe(clave, calidad);
  if (!llave) return false;
  return Boolean(await almacen(origen)?.hay(llave));
}

/** El audio cacheado, o `null` si no está. */
export async function abrir(origen: string, clave: string, calidad: string): Promise<Archivo | null> {
  const llave = await llaveDe(clave, calidad);
  if (!llave) return null;
  return (await almacen(origen)?.leer(llave)) ?? null;
}

/** Guarda el audio aportado. Devuelve `false` si no se pudo almacenar. */
export async function guardar(
  origen: string,
  clave: string,
  calidad: string,
  cuerpo: ReadableStream,
  tipo: string,
  bytes: number,
): Promise<boolean> {
  const llave = await llaveDe(clave, calidad);
  if (!llave) return false;
  return (await almacen(origen)?.guardar(llave, cuerpo, tipo, bytes)) ?? false;
}
