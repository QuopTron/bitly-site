/**
 * rescate-cuenta.ts — Configuración del RESCATE (canales sin pérdida) por
 * cuenta, para que se pueda tocar desde el sitio y la app la aplique.
 *
 * Por qué existe: la app tiene el panel completo de canales (espejos, arcod,
 * monochrome, relay) en Ajustes → Descargas → Rescate, pero el sitio no tenía
 * nada: quien administra una cuenta desde la web no podía cambiar a dónde
 * apunta su rescate. Esto guarda ESA configuración por cuenta y la sirve en
 * `GET /api/rescate`, que es lo que el backend de la app consulta al
 * sincronizar.
 *
 * Qué NO se guarda acá, a propósito: el token de la instancia arcod, las
 * configs firmadas del relay y las claves de Qobuz. Son SECRETOS: si viajan al
 * sitio quedan en un servidor y en `bitly-data`, y el usuario no gana nada
 * (el sitio no los usa para resolver audio). Quedan SOLO en la app. La
 * validación descarta cualquier campo que no esté en la lista blanca, así que
 * ni un pedido manipulado puede meterlos.
 *
 * Se guarda en `bitly-data` (`data/rescate.json`), igual que las cuentas y las
 * opiniones (ver `src/server/github-store.ts`).
 */
import { getJson, putJson } from "@/server/github-store";

const ARCHIVO = "data/rescate.json";

/** Tope de espejos por cuenta: más que eso solo agrega timeouts. */
const MAX_ESPEJOS = 8;
/** Tope de largo de una URL de canal. */
const MAX_URL = 200;

/** Lo que el sitio puede guardar de una cuenta. Todo opcional. */
export type RescateDeCuenta = {
  mirrors?: string[];
  arcodBase?: string;
  monochromeBase?: string;
  arcod?: boolean;
  monochrome?: boolean;
  espejos?: boolean;
  stashRelay?: boolean;
  actualizado?: string;
};

/** Id de cuenta → su configuración. */
type Guardado = Record<string, RescateDeCuenta>;

/** Una URL de canal: http(s), sin espacios, sin barra final y corta. */
function urlValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/\/+$/, "");
  if (!limpio || limpio.length > MAX_URL) return null;
  if (/\s/.test(limpio)) return null;
  if (!/^https?:\/\//i.test(limpio)) return null;
  return limpio;
}

/**
 * Normaliza lo que llegó del cliente. Devuelve null si no había NADA
 * aprovechable (así la ruta responde "datos" en vez de guardar un objeto
 * vacío). Los campos fuera de la lista blanca se descartan sin avisar.
 */
export function limpiarRescate(datos: unknown): RescateDeCuenta | null {
  if (!datos || typeof datos !== "object") return null;
  const entrada = datos as Record<string, unknown>;
  const salida: RescateDeCuenta = {};

  if (Array.isArray(entrada.mirrors)) {
    const vistos = new Set<string>();
    const mirrors: string[] = [];
    for (const item of entrada.mirrors) {
      const url = urlValida(item);
      if (!url || vistos.has(url)) continue;
      vistos.add(url);
      mirrors.push(url);
      if (mirrors.length >= MAX_ESPEJOS) break;
    }
    salida.mirrors = mirrors;
  }

  const arcodBase = urlValida(entrada.arcodBase);
  if (arcodBase) salida.arcodBase = arcodBase;
  const monoBase = urlValida(entrada.monochromeBase);
  if (monoBase) salida.monochromeBase = monoBase;

  for (const clave of ["arcod", "monochrome", "espejos", "stashRelay"] as const) {
    const valor = entrada[clave];
    if (typeof valor === "boolean") salida[clave] = valor;
  }

  const tieneAlgo =
    salida.mirrors !== undefined ||
    salida.arcodBase !== undefined ||
    salida.monochromeBase !== undefined ||
    salida.arcod !== undefined ||
    salida.monochrome !== undefined ||
    salida.espejos !== undefined ||
    salida.stashRelay !== undefined;
  return tieneAlgo ? salida : null;
}

/** Configuración guardada de [cuentaId] (vacía si nunca se tocó). */
export async function rescateDeCuenta(
  cuentaId: string,
): Promise<RescateDeCuenta> {
  if (!cuentaId) return {};
  try {
    const todo = await getJson<Guardado>("datos", ARCHIVO, {});
    return todo[cuentaId] ?? {};
  } catch {
    // Sin datos la app sigue con lo que tenga configurado localmente.
    return {};
  }
}

/**
 * Guarda (o borra, con `null`) la configuración de [cuentaId].
 *
 * `datos` vacío = borrar: el usuario vuelve a los valores de la app. Se
 * distingue de "no vino nada válido", que es un error del pedido.
 */
export async function guardarRescateDeCuenta(
  cuentaId: string,
  datos: unknown,
): Promise<{ ok: boolean; motivo?: "datos" | "servidor"; config?: RescateDeCuenta }> {
  if (!cuentaId) return { ok: false, motivo: "datos" };
  const limpiado = limpiarRescate(datos);
  if (!limpiado) return { ok: false, motivo: "datos" };
  try {
    const todo = await getJson<Guardado>("datos", ARCHIVO, {});
    todo[cuentaId] = { ...limpiado, actualizado: new Date().toISOString() };
    const guardado = await putJson(
      "datos",
      ARCHIVO,
      todo,
      `rescate: configuración de una cuenta`,
    );
    if (!guardado) return { ok: false, motivo: "servidor" };
    return { ok: true, config: todo[cuentaId] };
  } catch {
    return { ok: false, motivo: "servidor" };
  }
}

/** Borra la configuración de [cuentaId]: la app vuelve a lo suyo. */
export async function borrarRescateDeCuenta(
  cuentaId: string,
): Promise<{ ok: boolean; motivo?: "servidor" }> {
  if (!cuentaId) return { ok: true };
  try {
    const todo = await getJson<Guardado>("datos", ARCHIVO, {});
    if (!(cuentaId in todo)) return { ok: true };
    delete todo[cuentaId];
    const guardado = await putJson(
      "datos",
      ARCHIVO,
      todo,
      `rescate: borrar configuración de una cuenta`,
    );
    return { ok: guardado };
  } catch {
    return { ok: false, motivo: "servidor" };
  }
}
