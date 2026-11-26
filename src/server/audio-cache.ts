/**
 * Caché de audio OPCIONAL en la Cache API de Cloudflare, solo para las canciones
 * más pedidas.
 *
 * Por qué la Cache API y no R2: R2 pide activar una suscripción con tarjeta
 * aunque el uso entre en el plan gratis. La Cache API viene incluida en Pages,
 * no necesita binding, no pide tarjeta y funciona igual en `*.pages.dev`.
 *
 * Lo que hay que saber de este almacén, sin adornos:
 *
 * - La caché es POR CENTRO DE DATOS: lo que aporta alguien en un continente no
 *   aparece en otro. Para ahorrar descargas repetidas alcanza, y es justo el
 *   tráfico que se quiere evitar.
 * - El CDN puede desalojar entradas cuando necesita lugar. No es duradero.
 * - Por eso el conteo de pedidos vive acá mismo: el umbral se mide por región,
 *   que es donde la caché sirve.
 *
 * Qué se guarda y qué no:
 *
 * - Solo audio ya descargado por un usuario con sesión, nunca enlaces ni datos
 *   de nadie.
 * - Solo si la canción supera [`umbralSembrar`] pedidos (configurable con
 *   `BITLY_AUDIO_UMBRAL`). El resto se queda sin cachear.
 * - La clave es el ISRC (o `artista|título`) y se guarda bajo su SHA-256, así
 *   que el nombre del objeto no filtra nada y no hay rutas inyectables.
 *
 * Para apagarlo sin tocar código: variable de entorno `BITLY_AUDIO=apagado`.
 */

const VIDA_MEMORIA_MS = 60_000;
const ESPERA_ESCRITURA_MS = 60_000;
const MAX_CLAVES = 5_000;
/** Lo que dura el audio cacheado. Es una caché, no un archivo. */
const VIDA_AUDIO_SEG = 30 * 24 * 60 * 60;
/** El conteo dura mucho más: perderlo reinicia el umbral de la región. */
const VIDA_CONTEO_SEG = 365 * 24 * 60 * 60;
const APAGADOS = new Set(["0", "off", "no", "false", "apagado"]);

/** Lo mínimo de `caches.default` que se usa, para no depender de tipos de CF. */
type Almacen = {
  match(clave: string): Promise<Response | undefined>;
  put(clave: string, respuesta: Response): Promise<void>;
};

/**
 * Pedidos necesarios para cachear. Se lee en cada llamada: `_worker.js` siembra
 * `process.env` en la primera petición, después de evaluar este módulo.
 */
export function umbralSembrar(): number {
  return Math.max(1, Number(process.env?.BITLY_AUDIO_UMBRAL) || 3);
}
/** Tope por archivo: un FLAC típico entra; un show completo no. */
export const MAX_BYTES = 40 * 1024 * 1024;

function almacen(): Almacen | null {
  const caches = (globalThis as unknown as { caches?: { default?: Almacen } }).caches;
  return caches?.default && typeof caches.default.match === "function" ? caches.default : null;
}

/** Si el sitio puede guardar y servir audio. Sin esto todo contesta `apagado`. */
export function disponible(): boolean {
  const ajuste = String(process.env?.BITLY_AUDIO ?? "").trim().toLowerCase();
  if (ajuste && APAGADOS.has(ajuste)) return false;
  return Boolean(almacen());
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

/**
 * La URL de la entrada. Usa el origen real de la petición y una ruta que nunca
 * se visita: la Cache API keyea por URL y así la entrada queda dentro del sitio.
 */
function urlDe(origen: string, ruta: string): string {
  return `${origen.replace(/\/+$/, "")}/__cache/${ruta}`;
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
  const objeto = await almacen()
    ?.match(urlDe(origen, "popularidad.json"))
    .catch(() => undefined);
  let datos: Record<string, number> = {};
  if (objeto) {
    const texto = await objeto.text().catch(() => "");
    try {
      for (const [clave, valor] of Object.entries(JSON.parse(texto) as Record<string, unknown>)) {
        const n = Number(valor);
        if (clave && Number.isFinite(n) && n > 0) datos[clave] = n;
      }
    } catch {
      datos = {};
    }
  }
  memoria.datos = datos;
  memoria.expira = Date.now() + VIDA_MEMORIA_MS;
  return datos;
}

/** Guarda el conteo sin inundar la caché: como mucho una escritura por minuto. */
async function persistir(origen: string, datos: Record<string, number>): Promise<void> {
  const memoria = memoriaDe(origen);
  const guardado = almacen();
  if (!guardado || Date.now() - memoria.ultimaEscritura < ESPERA_ESCRITURA_MS) return;
  memoria.ultimaEscritura = Date.now();
  const recorte: Record<string, number> = {};
  for (const clave of Object.keys(datos).sort((a, b) => datos[b]! - datos[a]!).slice(0, MAX_CLAVES)) {
    recorte[clave] = datos[clave]!;
  }
  const respuesta = new Response(JSON.stringify(recorte), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${VIDA_CONTEO_SEG}`,
    },
  });
  await guardado.put(urlDe(origen, "popularidad.json"), respuesta).catch(() => undefined);
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
  const objeto = await almacen()
    ?.match(urlDe(origen, llave))
    .catch(() => undefined);
  return Boolean(objeto);
}

/** El audio cacheado, tal cual se guardó, o `null` si no está. */
export async function abrir(origen: string, clave: string, calidad: string): Promise<Response | null> {
  const llave = await llaveDe(clave, calidad);
  if (!llave) return null;
  return (
    (await almacen()
      ?.match(urlDe(origen, llave))
      .catch(() => undefined)) ?? null
  );
}

/** Guarda el audio aportado. Devuelve `false` si no se pudo almacenar. */
export async function guardar(
  origen: string,
  clave: string,
  calidad: string,
  cuerpo: ReadableStream,
  tipo: string,
): Promise<boolean> {
  const llave = await llaveDe(clave, calidad);
  const guardado = almacen();
  if (!llave || !guardado) return false;
  const respuesta = new Response(cuerpo, {
    headers: {
      "content-type": tipo,
      "cache-control": `public, max-age=${VIDA_AUDIO_SEG}`,
      "x-calidad": calidad,
    },
  });
  await guardado.put(urlDe(origen, llave), respuesta);
  return true;
}
