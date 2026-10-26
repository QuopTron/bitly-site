/**
 * Presencia: cuánta gente está en el sitio AHORA.
 *
 * Dos números, uno por origen:
 *
 *   anonimos  visitantes sin sesión. El navegador manda un identificador
 *             aleatorio (localStorage) y el servidor guarda SOLO su hash; nunca
 *             la IP ni ningún dato que permita volver a la persona. Una
 *             "visita" cuenta como presente si latió en los últimos 6 minutos.
 *   cuentas   cuentas con sesión que latieron en la misma ventana (lo calcula
 *             `contarCuentasEnLinea` en `cuentas.ts`).
 *
 * El latido sale del layout del sitio una vez por minuto (ver `lib/presente.ts`)
 * y es una sola petición liviana: no lee pedidos ni escribe nada por visita.
 *
 * El conteo es APROXIMADO a propósito. Cloudflare levanta varios isolates y
 * cada uno tiene su propia memoria: el mapa se escribe como mucho cada 3 minutos
 * en `data/presente.json` para que un isolate nuevo arranque con algo en vez de
 * con cero. No es una base de datos de presencia en tiempo real (para eso haría
 * falta un Durable Object o KV); es suficiente para que el panel muestre una
 * cifra razonable sin sumarle un commit por latido.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, putJson } from "@/server/github-store";

const ARCHIVO = "data/presente.json";
/** Una visita cuenta como presente durante 6 minutos. */
const VENTANA_MS = 6 * 60 * 1000;
/** Tope del mapa: más que esto no entra en memoria del Worker con holgura. */
const MAX_VISITAS = 4_000;
/** Cada cuánto se guarda el mapa en el repo (cada guardado es un commit). */
const ESCRITURA_MS = 3 * 60 * 1000;
/** Las cuentas en línea se leen del repo como mucho una vez por minuto. */
const CACHE_CUENTAS_MS = 60_000;

type ArchivoPresencia = {
  /** hash del identificador de visita → última vez visto (ms). */
  visitas?: Record<string, number>;
  actualizado?: string;
};

export type EstadoPresente = {
  ok: true;
  /** Visitantes sin sesión activos en la ventana. */
  anonimos: number;
  /** Cuentas con sesión activas en la ventana. */
  cuentas: number;
  /** anonimos + cuentas. */
  total: number;
  actualizado: string;
};

const visitas = new Map<string, number>();
let hidratado: Promise<void> | null = null;
let ultimaEscritura = 0;
let escribiendo = false;
let cacheCuentas: { valor: number; expira: number } = { valor: 0, expira: 0 };

function limpiar(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Huella del identificador de visita.
 *
 * El identificador lo genera el navegador y es aleatorio: hashearlo alcanza para
 * que no se pueda reconstruir, y así el JSON del repo (si algún día se lee) no
 * contiene ni IPs ni identificadores en claro.
 */
async function huellaVisita(visita: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bitly-presencia-v1:${visita}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Saca lo viejo y, si hace falta, recorta a las visitas más recientes. */
function podar(): void {
  const ahora = Date.now();
  for (const [clave, visto] of visitas) {
    if (ahora - visto > VENTANA_MS) visitas.delete(clave);
  }
  if (visitas.size <= MAX_VISITAS) return;
  const recientes = [...visitas.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VISITAS);
  visitas.clear();
  for (const [clave, visto] of recientes) visitas.set(clave, visto);
}

/**
 * Arranque en frío: una lectura del archivo por isolate.
 *
 * Se hace una sola vez y nunca bloquea la respuesta si el repo no contesta
 * (`getJson` ya cae al valor por defecto).
 */
function hidratar(): Promise<void> {
  if (hidratado) return hidratado;
  hidratado = (async () => {
    const guardado = await getJson<ArchivoPresencia>("datos", ARCHIVO, {});
    const ahora = Date.now();
    const previas = guardado?.visitas;
    if (!previas || typeof previas !== "object") return;
    for (const [clave, visto] of Object.entries(previas)) {
      if (typeof visto !== "number" || !Number.isFinite(visto)) continue;
      if (ahora - visto > VENTANA_MS) continue;
      if (!visitas.has(clave)) visitas.set(clave, visto);
    }
  })().catch(() => undefined);
  return hidratado;
}

/** Guarda el mapa como mucho una vez cada 3 minutos. Nunca rompe el latido. */
function persistir(): void {
  const ahora = Date.now();
  if (escribiendo || ahora - ultimaEscritura < ESCRITURA_MS) return;
  escribiendo = true;
  ultimaEscritura = ahora;
  podar();
  const instantanea: ArchivoPresencia = {
    visitas: Object.fromEntries(visitas),
    actualizado: new Date(ahora).toISOString(),
  };
  void putJson("datos", ARCHIVO, instantanea, "presencia: latido")
    .catch(() => false)
    .finally(() => {
      escribiendo = false;
    });
}

/** Cuentas con sesión activas; se lee del repo como mucho una vez por minuto. */
async function cuentasEnLinea(): Promise<number> {
  if (cacheCuentas.expira > Date.now()) return cacheCuentas.valor;
  try {
    const { contarCuentasEnLinea } = await import("@/server/cuentas");
    const valor = await contarCuentasEnLinea();
    cacheCuentas = { valor, expira: Date.now() + CACHE_CUENTAS_MS };
    return valor;
  } catch {
    return cacheCuentas.valor;
  }
}

/** Anónimos activos (para el resumen del panel). Hidrata si hace falta. */
export async function contarAnonimos(): Promise<number> {
  await hidratar();
  podar();
  return visitas.size;
}

/**
 * Registra un latido y devuelve el estado.
 *
 * `visita` es el identificador aleatorio del navegador (anónimos) y `token` la
 * sesión, si la hay: así el panel ve en línea a quien está navegando aunque no
 * abra «Mi cuenta». Cualquiera de los dos puede faltar.
 */
export const estadoPresente = createServerFn({ method: "POST" })
  .validator((d: { visita?: unknown; token?: unknown }) => d)
  .handler(async ({ data }): Promise<EstadoPresente> => {
    const visita = limpiar(data?.visita, 80);
    const token = limpiar(data?.token, 500);

    await hidratar();
    if (visita) {
      try {
        visitas.set(await huellaVisita(visita), Date.now());
        podar();
        persistir();
      } catch {
        // Sin crypto (raro) el latido se ignora: no es motivo para fallar.
      }
    }
    if (token) {
      try {
        // Escribe como mucho cada 5 minutos (ver `latirCuenta`).
        const { latirCuenta } = await import("@/server/cuentas");
        await latirCuenta(token);
      } catch {
        // Un token vencido no rompe el latido anónimo.
      }
    }

    const cuentas = await cuentasEnLinea();
    const anonimos = visitas.size;
    return {
      ok: true,
      anonimos,
      cuentas,
      total: anonimos + cuentas,
      actualizado: new Date().toISOString(),
    };
  });
