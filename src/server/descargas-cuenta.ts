import { createServerFn } from "@tanstack/react-start";
import { cuentaDeToken } from "@/server/cuentas";
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

export const estadoDescargas = createServerFn({ method: "POST" })
  .validator((data: { token?: string | null; codigo?: string | null }) => data)
  .handler(async ({ data }): Promise<EstadoDescargasCuenta> => {
    try {
      const cuenta = await cuentaDeToken(data.token);
      if (!cuenta) return { ok: false, motivo: "sesion" };
      const premium =
        (await esCodigoPremiumActivo(data.codigo).catch(() => false)) ||
        (await esCodigoPremiumActivo(cuenta.codigo).catch(() => false));
      const fila = await leerCuenta(cuenta.id);
      return {
        ok: true,
        limite: LIMITE_DESCARGAS,
        usadas: fila.usadas,
        restantes: premium ? null : Math.max(0, LIMITE_DESCARGAS - fila.usadas),
        premium,
        ilimitado: premium,
      };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });
