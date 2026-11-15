/**
 * Semáforo asíncrono con cola acotada.
 *
 * La demo habla con hosts de terceros (relay, Bandcamp, Invidious, Yattee) que
 * tienen límites de memoria y de tasa. Cuando entran muchas visitas a la vez,
 * lanzar una extracción por cada clic multiplica esos procesos hasta que el
 * host cae por OOM o responde 429. Este semáforo pone un techo por isolate y
 * encola el resto: la reproducción espera su turno en vez de fallar.
 *
 * Si la cola se llena o la espera vence, lanza `Ocupado` para que el llamador
 * conteste rápido con un motivo claro. Nunca deja una promesa colgada: el turno
 * se transfiere directamente de quien libera a quien espera.
 */

export class Ocupado extends Error {
  constructor() {
    super("servidor-ocupado");
    this.name = "Ocupado";
  }
}

type Turno = {
  conceder: () => void;
  cancelar: (error: Error) => void;
};

export type Semaforo = {
  ejecutar: <T>(tarea: () => Promise<T>) => Promise<T>;
  readonly activos: number;
  readonly esperando: number;
};

export function crearSemaforo(
  maximo: number,
  colaMaxima = 200,
  esperaMaximaMs = 12_000,
): Semaforo {
  const cupo = Math.max(1, Math.floor(maximo));
  let activos = 0;
  const cola: Turno[] = [];

  const liberar = () => {
    const siguiente = cola.shift();
    if (siguiente) {
      // El turno pasa directo: `activos` no baja ni sube.
      siguiente.conceder();
    } else {
      activos--;
    }
  };

  const adquirir = () => {
    if (activos < cupo) {
      activos++;
      return Promise.resolve();
    }
    if (cola.length >= Math.max(1, Math.floor(colaMaxima))) {
      return Promise.reject(new Ocupado());
    }
    return new Promise<void>((listo, falla) => {
      let resuelto = false;
      const turno: Turno = {
        conceder: () => {
          if (resuelto) return;
          resuelto = true;
          clearTimeout(reloj);
          listo();
        },
        cancelar: (error) => {
          if (resuelto) return;
          resuelto = true;
          clearTimeout(reloj);
          falla(error);
        },
      };
      const reloj = setTimeout(() => {
        const indice = cola.indexOf(turno);
        if (indice >= 0) cola.splice(indice, 1);
        turno.cancelar(new Ocupado());
      }, Math.max(1_000, esperaMaximaMs));
      cola.push(turno);
    });
  };

  return {
    async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
      await adquirir();
      try {
        return await tarea();
      } finally {
        liberar();
      }
    },
    get activos() {
      return activos;
    },
    get esperando() {
      return cola.length;
    },
  };
}

/** `true` para un fallo de saturación, que el cliente puede reintentar. */
export function esOcupado(error: unknown): boolean {
  return error instanceof Ocupado || (error as { name?: string } | null)?.name === "Ocupado";
}
