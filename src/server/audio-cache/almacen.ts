/**
 * El almacén del caché de audio: KV si está configurado, Cache API si no.
 *
 * KV es el bueno: es global (se replica a todos los centros de datos) y no lo
 * desaloja el CDN. Necesita un namespace y un binding en Pages. La Cache API
 * viene incluida y funciona sin configurar nada, pero cada centro de datos
 * tiene la suya y el CDN puede vaciarla: sirve de respaldo, no de archivo.
 *
 * Las dos implementaciones se ven igual desde afuera: leer/escribir un archivo
 * por su ruta (`audio/<sha>`), un texto chico y saber si algo existe.
 */

/** Un archivo de audio listo para devolver. */
export type Archivo = {
  cuerpo: ReadableStream;
  tipo: string;
  bytes: number;
};

export type Almacen = {
  /** De dónde salió: sirve para los diagnósticos y los tests. */
  nombre: "kv" | "cache";
  leer(ruta: string): Promise<Archivo | null>;
  hay(ruta: string): Promise<boolean>;
  guardar(ruta: string, cuerpo: ReadableStream, tipo: string, bytes: number): Promise<boolean>;
  leerTexto(ruta: string, venceSeg: number): Promise<string | null>;
  escribirTexto(ruta: string, texto: string, venceSeg: number): Promise<void>;
};

/** Lo mínimo de un namespace de KV que se usa. */
export type Kv = {
  get(clave: string, tipo?: "text" | "json" | "arrayBuffer"): Promise<unknown>;
  put(
    clave: string,
    valor: ArrayBuffer | string,
    opciones?: { expirationTtl?: number },
  ): Promise<void>;
};

/** Lo mínimo de `caches.default` que se usa. */
export type CacheApi = {
  match(clave: string): Promise<Response | undefined>;
  put(clave: string, respuesta: Response): Promise<void>;
};

/** `_worker.js` deja el namespace acá porque `process.env` no lleva objetos. */
const ENLACE = "__BITLY_AUDIO";

export function namespaceKv(): Kv | null {
  const valor = (globalThis as unknown as Record<string, unknown>)[ENLACE] as Kv | undefined;
  return valor && typeof valor.get === "function" && typeof valor.put === "function" ? valor : null;
}

export function cacheApi(): CacheApi | null {
  const caches = (globalThis as unknown as { caches?: { default?: CacheApi } }).caches;
  return caches?.default && typeof caches.default.match === "function" ? caches.default : null;
}
