/**
 * Capa CALIENTE del caché de audio: Workers KV.
 *
 * KV guarda como mucho 25 MiB por valor y un FLAC pasa ese tope, así que el
 * archivo se parte en trozos y se escribe un manifiesto al final. Sin
 * manifiesto, la entrada no se sirve: nunca se entrega un archivo a medias.
 *
 * Es global (se replica a todos los centros de datos) y no lo desaloja el CDN
 * como a la Cache API, pero el plan gratis son 1 GB: por eso el archivo pesado
 * vive en el repo (ver `github.ts`) y acá queda lo que se está leyendo.
 */

import type { Almacen, Archivo, Kv } from "./almacen";
import { partir, unir, type Manifiesto } from "./trozos";

/** Menos de 25 MiB (el máximo de KV), con margen para el sobreheador. */
export const TROZO_BYTES = 20 * 1024 * 1024;
/** Lo que vive una entrada de audio. Es una caché, no un archivo. */
export const VIDA_AUDIO_SEG = 30 * 24 * 60 * 60;

export function crear(kv: Kv): Almacen {
  return {
    nombre: "kv",

    async leer(ruta): Promise<Archivo | null> {
      const man = (await kv.get(`${ruta}/man`, "json").catch(() => null)) as Manifiesto | null;
      if (!man || !Number.isFinite(man.trozos) || man.trozos < 1) return null;
      const cuerpo = unir(man.trozos, async (indice) => {
        const trozo = await kv.get(`${ruta}/${indice}`, "arrayBuffer").catch(() => null);
        return trozo instanceof ArrayBuffer ? trozo : null;
      });
      return {
        cuerpo,
        tipo: man.tipo || "application/octet-stream",
        bytes: Number(man.bytes) || 0,
      };
    },

    async hay(ruta) {
      const man = await kv.get(`${ruta}/man`, "json").catch(() => null);
      return Boolean(man);
    },

    async guardar(ruta, cuerpo, tipo, bytes) {
      const trozos = await partir(cuerpo, TROZO_BYTES, (indice, trozo) =>
        kv.put(`${ruta}/${indice}`, trozo, { expirationTtl: VIDA_AUDIO_SEG }),
      );
      if (trozos === 0) return false;
      const man: Manifiesto = { trozos, bytes, tipo };
      await kv
        .put(`${ruta}/man`, JSON.stringify(man), { expirationTtl: VIDA_AUDIO_SEG })
        .catch(() => undefined);
      return true;
    },

    async leerTexto(ruta) {
      const valor = await kv.get(ruta, "text").catch(() => null);
      return typeof valor === "string" ? valor : null;
    },

    async escribirTexto(ruta, texto, venceSeg) {
      await kv
        .put(ruta, texto, { expirationTtl: venceSeg })
        .catch(() => undefined);
    },
  };
}
