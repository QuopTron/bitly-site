/**
 * Troceado y unión del audio, igual para KV y para el repo.
 *
 * Los dos almacenes tienen topes chicos por archivo (25 MiB en KV, 100 MB en
 * GitHub), así que el audio se parte y se escribe un manifiesto al final:
 * mientras el manifiesto no exista, la entrada se considera incompleta y no se
 * sirve. El cliente, igual, ve un archivo seguido.
 */

export type Manifiesto = { trozos: number; bytes: number; tipo: string };

/**
 * Parte el cuerpo en bloques de `tamano` y entrega cada uno a `guardar`.
 * Lee de a un bloque: nunca tiene el archivo entero en memoria.
 */
export async function partir(
  cuerpo: ReadableStream,
  tamano: number,
  guardar: (indice: number, trozo: Uint8Array) => Promise<void>,
): Promise<number> {
  const lector = cuerpo.getReader();
  let trozo = new Uint8Array(tamano);
  let usado = 0;
  let indice = 0;

  const volcar = async () => {
    await guardar(indice, trozo.slice(0, usado));
    indice += 1;
    usado = 0;
  };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    let resto = value;
    while (resto.byteLength > 0) {
      const lugar = tamano - usado;
      if (resto.byteLength <= lugar) {
        trozo.set(resto, usado);
        usado += resto.byteLength;
        resto = new Uint8Array(0);
      } else {
        trozo.set(resto.subarray(0, lugar), usado);
        usado = tamano;
        await volcar();
        trozo = new Uint8Array(tamano);
        resto = resto.subarray(lugar);
      }
      if (usado === tamano) await volcar();
    }
  }
  if (usado > 0) await volcar();
  return indice;
}

/** Arma un flujo que pide los trozos en orden. */
export function unir(
  trozos: number,
  leer: (indice: number) => Promise<ArrayBuffer | null>,
): ReadableStream {
  let siguiente = 0;
  return new ReadableStream({
    async pull(controlador) {
      const trozo = await leer(siguiente).catch(() => null);
      if (!(trozo instanceof ArrayBuffer)) {
        controlador.error(new Error("audio: falta un trozo"));
        return;
      }
      controlador.enqueue(new Uint8Array(trozo));
      siguiente += 1;
      if (siguiente >= trozos) controlador.close();
    },
  });
}
