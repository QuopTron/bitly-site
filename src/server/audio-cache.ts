/**
 * Caché de audio OPCIONAL en R2, solo para las canciones más pedidas.
 *
 * Por qué existe: el catálogo de resoluciones evita volver a buscar una canción,
 * pero el audio se sigue bajando del proveedor. Si un tema lo piden muchas
 * personas, guardarlo una vez en R2 ahorra las siguientes descargas.
 *
 * Es opcional de verdad: sin la binding `BITLY_AUDIO` configurada en Pages, el
 * endpoint contesta `apagado` y la app sigue funcionando exactamente igual.
 *
 * Qué se guarda y qué no:
 *
 * - Solo audio ya descargado por un usuario con sesión, nunca enlaces ni datos
 *   de nadie.
 * - Solo si la canción supera [`UMBRAL_SEMBRAR`] pedidos (configurable con
 *   `BITLY_AUDIO_UMBRAL`). El resto se queda sin cachear.
 * - La clave es el ISRC (o `artista|título`) y se guarda bajo su SHA-256, así
 *   que el nombre del objeto no filtra nada y no hay rutas inyectables.
 *
 * La popularidad se lleva en un JSON del mismo bucket. R2 no tiene incrementos
 * atómicos entre isolates, así que el conteo es aproximado a propósito: la
 * caché es una mejora, no una regla de negocio.
 */

const ENLACE = "__BITLY_AUDIO";
const POPULARIDAD = "audio/popularidad.json";
const VIDA_MEMORIA_MS = 60_000;
const ESPERA_ESCRITURA_MS = 60_000;
const MAX_CLAVES = 5_000;

/**
 * Pedidos necesarios para cachear. Se lee en cada llamada: `_worker.js` siembra
 * `process.env` en la primera petición, después de evaluar este módulo.
 */
export function umbralSembrar(): number {
  return Math.max(1, Number(process.env?.BITLY_AUDIO_UMBRAL) || 3);
}
/** Tope por archivo: un FLAC típico entra; un show completo no. */
export const MAX_BYTES = 40 * 1024 * 1024;

export type ObjetoAudio = {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
};

type Cubo = {
  head(clave: string): Promise<unknown>;
  get(clave: string): Promise<ObjetoAudio | null>;
  put(
    clave: string,
    valor: ReadableStream | Uint8Array,
    opciones?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

/** El bucket, si el deploy lo configuró. `_worker.js` lo siembra en globalThis. */
export function cubo(): Cubo | null {
  const valor = (globalThis as Record<string, unknown>)[ENLACE] as Cubo | undefined;
  return valor && typeof valor.get === "function" ? valor : null;
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

/** La llave del objeto: un hash estable de canción + calidad. */
export async function llaveDe(clave: string, calidad: string): Promise<string> {
  if (!clave) return "";
  const bytes = new TextEncoder().encode(`${clave}|${calidad}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `audio/${hex}`;
}

let memoria: { datos: Record<string, number>; expira: number } | null = null;
let ultimaEscritura = 0;

async function popularidad(): Promise<Record<string, number>> {
  if (memoria && memoria.expira > Date.now()) return memoria.datos;
  let datos: Record<string, number> = {};
  const bucket = cubo();
  const objeto = bucket ? await bucket.get(POPULARIDAD).catch(() => null) : null;
  if (objeto) {
    const texto = await new Response(objeto.body).text().catch(() => "");
    try {
      for (const [clave, valor] of Object.entries(JSON.parse(texto) as Record<string, unknown>)) {
        const n = Number(valor);
        if (clave && Number.isFinite(n) && n > 0) datos[clave] = n;
      }
    } catch {
      datos = {};
    }
  }
  memoria = { datos, expira: Date.now() + VIDA_MEMORIA_MS };
  return datos;
}

/** Guarda el conteo sin inundar el bucket: como mucho una escritura por minuto. */
async function persistir(datos: Record<string, number>): Promise<void> {
  const bucket = cubo();
  if (!bucket || Date.now() - ultimaEscritura < ESPERA_ESCRITURA_MS) return;
  ultimaEscritura = Date.now();
  const recorte: Record<string, number> = {};
  for (const clave of Object.keys(datos).sort((a, b) => datos[b]! - datos[a]!).slice(0, MAX_CLAVES)) {
    recorte[clave] = datos[clave]!;
  }
  await bucket
    .put(POPULARIDAD, new TextEncoder().encode(JSON.stringify(recorte)), {
      httpMetadata: { contentType: "application/json" },
    })
    .catch(() => undefined);
}

/** Cuenta un pedido de descarga y devuelve el total de esa canción. */
export async function anotarPedido(clave: string): Promise<number> {
  if (!clave) return 0;
  const datos = await popularidad();
  const n = (datos[clave] ?? 0) + 1;
  datos[clave] = n;
  await persistir(datos);
  return n;
}

/** El conteo actual, sin incrementarlo (lo usa el aporte). */
export async function pedidosDe(clave: string): Promise<number> {
  return clave ? ((await popularidad())[clave] ?? 0) : 0;
}

/** Si esa canción y calidad ya están cacheadas. */
export async function hay(clave: string, calidad: string): Promise<boolean> {
  const bucket = cubo();
  const llave = await llaveDe(clave, calidad);
  if (!bucket || !llave) return false;
  return Boolean(await bucket.head(llave).catch(() => null));
}
