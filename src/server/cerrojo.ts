/**
 * Cerrojo asíncrono por clave.
 *
 * Varias operaciones leen un archivo, deciden y lo vuelven a escribir (repartir
 * un código, cobrar una baja, confirmar un cambio). Si dos pedidos entran a la
 * vez, las dos leen el mismo estado y las dos creen que el código está libre:
 * se entrega dos veces y una de las dos escrituras pisa a la otra.
 *
 * Esto las pone en fila dentro del mismo isolate. No es una garantía global
 * (Cloudflare puede tener varios isolates atendiendo a la vez); para eso el
 * store hace el PUT con el `sha` del archivo, así que entre isolates una de las
 * dos escrituras falla en vez de pisar la otra en silencio.
 *
 * La cola se limpia sola cuando no queda nadie esperando: no crece con el
 * tráfico.
 */

const colas = new Map<string, Promise<unknown>>();

export function conCerrojo<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colas.get(clave) ?? Promise.resolve();
  const mia = previa.then(tarea, tarea);
  colas.set(clave, mia);
  void mia
    .catch(() => undefined)
    .then(() => {
      // Sólo borra si nadie encoló otra tarea detrás.
      if (colas.get(clave) === mia) colas.delete(clave);
    });
  return mia;
}
