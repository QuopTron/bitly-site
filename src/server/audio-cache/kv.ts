/**
 * Caché de audio sobre Workers KV.
 *
 * KV guarda como mucho 25 MiB por valor, y un FLAC pasa ese tope sin esfuerzo.
 * Por eso el archivo se parte en trozos de [`TROZO_BYTES`] y se escribe un
 * manifiesto al final: mientras el manifiesto no exista, la entrada se considera
 * incompleta y no se sirve. El cliente sigue viendo un archivo seguido.
 *
 * El nombre de todo es el SHA-256 de `ISRC|calidad`: no hay títulos ni rutas
 * armadas con datos del usuario.
 */

import type { Almacen, Archivo, Kv } from "./almacen";

/** Menos de 25 MiB (el máximo de KV), con margen para el sobreheador. */
export const TROZO_BYTES = 20 * 1024 * 1024;
/** Lo que vive una entrada de audio. Es una caché, no un archivo. */
export const VIDA_AUDIO_SEG = 30 * 24 * 60 * 60;

type Manifiesto = { trozos: number; bytes: number; tipo: string };

/** Junta varios pedazos en un solo bloque. */
function unir(pedazos: Uint8Array[], total: number): Uint8Array {
  if (pedazos.length === 1) return pedazos[0]!;
  const salida = new Uint8Array(total);
  let desde = 0;
  for (const pedazo of pedazos) {
    salida.set(pedazo, desde);
    desde += pedazo.byteLength;
  }
  return salida;
}

/**
 * Parte el cuerpo en trozos de tamaño fijo y los guarda. Devuelve cuántos salieron.
 * Se lee de a un trozo: nunca se tiene el archivo entero en memoria si no hace falta.
 */
async function partirEnTrozos(kv: Kv, ruta: string, cuerpo: ReadableStream): Promise<number> {
  const lector = cuerpo.getReader();
  let trozo = new Uint8Array(TROZO_BYTES);
  let usado = 0;
  let indice = 0;

  const volcar = async () => {
    await kv.put(`${ruta}/${indice}`, trozo.slice(0, usado).buffer as ArrayBuffer, {
      expirationTtl: VIDA_AUDIO_SEG,
    });
    indice += 1;
    usado = 0;
  };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    let resto = value;
    while (resto.byteLength > 0) {
      const lugar = TROZO_BYTES - usado;
      if (resto.byteLength <= lugar) {
        trozo.set(resto, usado);
        usado += resto.byteLength;
        resto = new Uint8Array(0);
      } else {
        trozo.set(resto.subarray(0, lugar), usado);
        usado = TROZO_BYTES;
        await volcar();
        trozo = new Uint8Array(TROZO_BYTES);
        resto = resto.subarray(lugar);
      }
      if (usado === TROZO_BYTES) await volcar();
    }
  }
  if (usado > 0) await volcar();
  return indice;
}

export function crear(kv: Kv): Almacen {
  return {
    nombre: "kv",

    async leer(ruta): Promise<Archivo | null> {
      const manifiesto = (await kv.get(`${ruta}/man`, "json").catch(() => null)) as
        | Manifiesto
        | null;
      if (!manifiesto || !Number.isFinite(manifiesto.trozos) || manifiesto.trozos < 1) {
        return null;
      }
      let siguiente = 0;
      const cuerpo = new ReadableStream({
        async pull(controlador) {
          const trozo = await kv.get(`${ruta}/${siguiente}`, "arrayBuffer").catch(() => null);
          if (!(trozo instanceof ArrayBuffer)) {
            controlador.error(new Error("audio: falta un trozo"));
            return;
          }
          controlador.enqueue(new Uint8Array(trozo));
          siguiente += 1;
          if (siguiente >= manifiesto.trozos) controlador.close();
        },
      });
      return {
        cuerpo,
        tipo: manifiesto.tipo || "application/octet-stream",
        bytes: Number(manifiesto.bytes) || 0,
      };
    },

    async hay(ruta) {
      const manifiesto = await kv.get(`${ruta}/man`, "json").catch(() => null);
      return Boolean(manifiesto);
    },

    async guardar(ruta, cuerpo, tipo, bytes) {
      const trozos = await partirEnTrozos(kv, ruta, cuerpo);
      if (trozos === 0) return false;
      const manifiesto: Manifiesto = { trozos, bytes, tipo };
      await kv
        .put(`${ruta}/man`, JSON.stringify(manifiesto), { expirationTtl: VIDA_AUDIO_SEG })
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
