import { createServerFn } from "@tanstack/react-start";
import { cuentaDeToken, cuentaPorId } from "@/server/cuentas";
import { conCerrojo } from "@/server/cerrojo";
import { getJson, putJson } from "@/server/github-store";
import { esCodigoPremiumActivo } from "@/lib/premium-check";

const ARCHIVO = "data/descargas.json";
export const LIMITE_DESCARGAS = 75;
const MAX_EVENTOS = 100;

export type EventoDescarga = {
  id: string;
  titulo: string;
  artista: string;
  calidad: "flac" | "estandar";
  canal: string;
  fecha: string;
};

type FilaDescargas = {
  usadas: number;
  ultima: string | null;
  eventos: EventoDescarga[];
};

type ArchivoDescargas = {
  actualizado: string;
  cuentas: Record<string, FilaDescargas>;
};

export type EstadoDescargasCuenta =
  | {
      ok: true;
      limite: number;
      usadas: number;
      restantes: number | null;
      premium: boolean;
      ilimitado: boolean;
    }
  | { ok: false; motivo: "sesion" | "servidor" };

const VACIO: ArchivoDescargas = { actualizado: "", cuentas: {} };

function normalizar(crudo: unknown): ArchivoDescargas {
  if (!crudo || typeof crudo !== "object") return VACIO;
  const valor = crudo as Partial<ArchivoDescargas>;
  const cuentas: Record<string, FilaDescargas> = {};
  for (const [id, fila] of Object.entries(valor.cuentas ?? {})) {
    if (!fila || typeof fila !== "object") continue;
    const f = fila as Partial<FilaDescargas>;
    cuentas[id] = {
      usadas:
        typeof f.usadas === "number" && Number.isFinite(f.usadas)
          ? Math.max(0, Math.min(LIMITE_DESCARGAS, Math.floor(f.usadas)))
          : 0,
      ultima: typeof f.ultima === "string" ? f.ultima : null,
      eventos: Array.isArray(f.eventos)
        ? f.eventos.filter((e): e is EventoDescarga => Boolean(e && typeof e === "object")).slice(-MAX_EVENTOS)
        : [],
    };
  }
  return {
    actualizado: typeof valor.actualizado === "string" ? valor.actualizado : "",
    cuentas,
  };
}

async function leerArchivo(): Promise<ArchivoDescargas> {
  return normalizar(await getJson<unknown>("datos", ARCHIVO, VACIO));
}

async function leerCuenta(id: string): Promise<FilaDescargas> {
  const archivo = await leerArchivo();
  return archivo.cuentas[id] ?? { usadas: 0, ultima: null, eventos: [] };
}

export async function consumirDescarga(
  cuentaId: string,
  evento: Omit<EventoDescarga, "id" | "fecha">,
): Promise<{ ok: true; usadas: number; restantes: number } | { ok: false; motivo: "limite" | "servidor" }> {
  return conCerrojo(`descargas:${cuentaId}`, async () => {
    const archivo = await leerArchivo();
    const fila = archivo.cuentas[cuentaId] ?? { usadas: 0, ultima: null, eventos: [] };
    if (fila.usadas >= LIMITE_DESCARGAS) {
      return { ok: false, motivo: "limite" } as const;
    }
    const fecha = new Date().toISOString();
    const nuevoEvento: EventoDescarga = {
      ...evento,
      id: crypto.randomUUID(),
      fecha,
    };
    archivo.cuentas[cuentaId] = {
      usadas: fila.usadas + 1,
      ultima: fecha,
      eventos: [...fila.eventos, nuevoEvento].slice(-MAX_EVENTOS),
    };
    archivo.actualizado = fecha;
    const guardado = await putJson(
      "datos",
      ARCHIVO,
      archivo,
      `descarga: ${evento.artista} — ${evento.titulo}`,
    );
    if (!guardado) return { ok: false, motivo: "servidor" } as const;
    return {
      ok: true,
      usadas: fila.usadas + 1,
      restantes: Math.max(0, LIMITE_DESCARGAS - (fila.usadas + 1)),
    } as const;
  });
}

/**
 * Resumen de la cuota de TODAS las cuentas: cuántas hay, cuántas están
 * completas y cuántas descargas se gastaron entre todas. Es lo que mira el
 * reinicio general (`scripts/reiniciar-cuota.mjs`) para decir qué cambió.
 */
export async function resumenCuota(): Promise<{
  total: number;
  completas: number;
  gastadas: number;
}> {
  const archivo = await leerArchivo();
  const filas = Object.values(archivo.cuentas);
  return {
    total: filas.length,
    completas: filas.filter((f) => f.usadas === 0).length,
    gastadas: filas.reduce((suma, f) => suma + f.usadas, 0),
  };
}

/**
 * Deja a TODAS las cuentas con las 75 canciones gratis completas.
 *
 * Por qué existe: el tope de 75 es POR CUENTA y se acumulaba para siempre, así
 * que quien probó la app un rato quedaba en cero aunque el plan gratis siga
 * vigente. El dueño lo pidió así: «deben ser 75 para todos otra vez». Poner el
 * contador en cero es lo que devuelve las 75 (el estado las calcula restando).
 *
 * Los EVENTOS no se borran: el panel los muestra y el historial es la única
 * prueba de qué se bajó. Sólo se reinicia el contador.
 *
 * Es para todas las cuentas a propósito; no hay versión "de una sola": el
 * reinicio puntual ya lo hace la cuenta desde el panel con el botón de cuota.
 */
export async function reiniciarCuotaGlobal(): Promise<
  { ok: true; cuentas: number; cuando: string } | { ok: false; motivo: "servidor" }
> {
  return conCerrojo("descargas:global", async () => {
    const archivo = await leerArchivo();
    const ids = Object.keys(archivo.cuentas);
    const cuando = new Date().toISOString();
    if (ids.length === 0) return { ok: true, cuentas: 0, cuando } as const;
    for (const id of ids) {
      const fila = archivo.cuentas[id];
      archivo.cuentas[id] = {
        usadas: 0,
        ultima: fila.ultima,
        eventos: fila.eventos,
      };
    }
    archivo.actualizado = cuando;
    const guardado = await putJson(
      "datos",
      ARCHIVO,
      archivo,
      `descargas: reinicio general a ${LIMITE_DESCARGAS} (${ids.length} cuentas)`,
    );
    if (!guardado) return { ok: false, motivo: "servidor" } as const;
    return { ok: true, cuentas: ids.length, cuando } as const;
  });
}

/**
 * Estado de las descargas de [cuentaId], sin mirar quién pregunta.
 *
 * Lo comparten el sitio (la función de servidor de abajo) y la APP, que entra
 * por `POST /api/cuenta` con `accion: "cuota"` (ver `src/routes/api/cuenta.ts`):
 * el contador de las 75 canciones gratis vive en `data/descargas.json` y es el
 * MISMO para la web y para la app. Si cada lado contara por su cuenta, quien
 * escuchara en la web y descargara en la app tendría 150.
 *
 * `restantes: null` = Premium (ilimitado). Un código Premium de la CUENTA vale
 * igual que uno que llegue por parámetro: la cuenta es la autoridad.
 */
export async function estadoDeCuenta(
  cuentaId: string,
  codigo?: string | null,
): Promise<{ limite: number; usadas: number; restantes: number | null; premium: boolean; ilimitado: boolean }> {
  const premium =
    (await esCodigoPremiumActivo(codigo).catch(() => false)) ||
    (await esCodigoPremiumActivo(await codigoDeCuenta(cuentaId)).catch(() => false));
  const fila = await leerCuenta(cuentaId);
  return {
    limite: LIMITE_DESCARGAS,
    usadas: fila.usadas,
    restantes: premium ? null : Math.max(0, LIMITE_DESCARGAS - fila.usadas),
    premium,
    ilimitado: premium,
  };
}

/** Código Premium asignado a la cuenta (o null). */
async function codigoDeCuenta(cuentaId: string): Promise<string | null> {
  const cuenta = await cuentaPorId(cuentaId).catch(() => null);
  return cuenta?.codigo ?? null;
}

export const estadoDescargas = createServerFn({ method: "POST" })
  .validator((data: { token?: string | null; codigo?: string | null }) => data)
  .handler(async ({ data }): Promise<EstadoDescargasCuenta> => {
    try {
      const cuenta = await cuentaDeToken(data.token);
      if (!cuenta) return { ok: false, motivo: "sesion" };
      return { ok: true, ...(await estadoDeCuenta(cuenta.id, data.codigo)) };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });
