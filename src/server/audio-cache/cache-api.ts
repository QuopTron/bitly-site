/**
 * Caché de audio sobre la Cache API de Cloudflare (el respaldo).
 *
 * Viene incluida en Pages: no hay binding ni tarjeta que configurar. A cambio,
 * cada centro de datos tiene su propia copia y el CDN puede desalojarla, así que
 * sirve para ahorrar descargas repetidas cerca del usuario, no como archivo.
 *
 * La clave es una URL del propio sitio con una ruta que nunca se visita:
 * `https://<sitio>/__cache/audio/<sha>`. Se usa el origen real de la petición
 * para que producción y los previews no compartan entradas.
 */

import type { Almacen, Archivo, CacheApi } from "./almacen";

/** La URL de la entrada. */
function urlDe(origen: string, ruta: string): string {
  return `${origen.replace(/\/+$/, "")}/__cache/${ruta}`;
}

export function crear(cache: CacheApi, origen: string): Almacen {
  return {
    nombre: "cache",

    async leer(ruta): Promise<Archivo | null> {
      const objeto = await cache.match(urlDe(origen, ruta)).catch(() => undefined);
      if (!objeto) return null;
      const largo = Number(objeto.headers.get("content-length")) || 0;
      return {
        cuerpo: objeto.body as ReadableStream,
        tipo: objeto.headers.get("content-type") || "application/octet-stream",
        bytes: largo,
      };
    },

    async hay(ruta) {
      const objeto = await cache.match(urlDe(origen, ruta)).catch(() => undefined);
      return Boolean(objeto);
    },

    async guardar(ruta, cuerpo, tipo, bytes) {
      const respuesta = new Response(cuerpo, {
        headers: {
          "content-type": tipo,
          "content-length": String(bytes),
          "cache-control": `public, max-age=${VIDA_AUDIO_SEG}`,
        },
      });
      await cache.put(urlDe(origen, ruta), respuesta).catch(() => undefined);
      return true;
    },

    async leerTexto(ruta) {
      const objeto = await cache.match(urlDe(origen, ruta)).catch(() => undefined);
      return objeto ? await objeto.text().catch(() => null) : null;
    },

    async escribirTexto(ruta, texto, venceSeg) {
      const respuesta = new Response(texto, {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${venceSeg}`,
        },
      });
      await cache.put(urlDe(origen, ruta), respuesta).catch(() => undefined);
    },
  };
}

/** Lo que vive una entrada de audio. */
const VIDA_AUDIO_SEG = 30 * 24 * 60 * 60;
