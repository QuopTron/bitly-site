/**
 * Las dos capas juntas: caliente (KV o Cache API) + frío (repo de GitHub).
 *
 * - **Leer**: caliente primero; si no está, frío. Es el orden que hace rápido lo
 *   repetido y durable lo viejo.
 * - **Aportar**: el archivo pesado va SIEMPRE al frío (el archivo no se pierde).
 *   El caliente recibe además una copia si el archivo es chico, para que el
 *   siguiente pedido salga al instante. Los grandes quedan solo en el frío:
 *   duplicarlos obligaría a tener 40 MB en memoria en un Worker de 128 MB.
 * - **Contar**: solo en el caliente; el frío es un repo y no se toca por un like.
 *
 * Si falta una capa, todo sigue funcionando con la otra.
 */

import type { Almacen, Archivo } from "./almacen";

/** Hasta acá se copia también al caliente (memoria del Worker mediante). */
export const UMBRAL_CALIENTE = 24 * 1024 * 1024;

export function crear(caliente: Almacen | null, frio: Almacen | null): Almacen | null {
  if (!caliente) return frio;
  if (!frio) return caliente;

  return {
    nombre: `${caliente.nombre}+${frio.nombre}`,

    async leer(ruta): Promise<Archivo | null> {
      return (await caliente.leer(ruta)) ?? (await frio.leer(ruta));
    },

    async hay(ruta) {
      if (await caliente.hay(ruta)) return true;
      return frio.hay(ruta);
    },

    async guardar(ruta, cuerpo, tipo, bytes) {
      if (bytes > UMBRAL_CALIENTE) return frio.guardar(ruta, cuerpo, tipo, bytes);
      // Se guarda una copia en memoria para poder escribir en las dos capas:
      // el flujo de entrada se lee una sola vez.
      const copia = new Uint8Array(await new Response(cuerpo).arrayBuffer());
      const [enCaliente, enFrio] = await Promise.allSettled([
        caliente.guardar(ruta, new Blob([copia]).stream(), tipo, bytes),
        frio.guardar(ruta, new Blob([copia]).stream(), tipo, bytes),
      ]);
      const ok = (resultado: PromiseSettledResult<boolean>) =>
        resultado.status === "fulfilled" && resultado.value === true;
      // Alcanza con que una de las dos lo tenga.
      return ok(enCaliente) || ok(enFrio);
    },

    async leerTexto(ruta, venceSeg) {
      return caliente.leerTexto(ruta, venceSeg);
    },

    async escribirTexto(ruta, texto, venceSeg) {
      await caliente.escribirTexto(ruta, texto, venceSeg);
    },
  };
}
