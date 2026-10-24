/**
 * Códigos emitidos por el sitio.
 *
 * Los códigos firmados (`BITLY2.…`) no están en `bitly_codes_premium`: los
 * fabrica este servidor con la clave Ed25519. Para que la demo pueda acreditar
 * Premium sin la clave pública a mano, el sitio lleva su propio registro de lo
 * que emitió y a quién se lo dio.
 *
 * Es la lista de lo entregado, no un segundo registro de códigos a la venta: se
 * marca inactivo apenas la cuenta pierde el código (baja, revocación), así el
 * enlace viejo deja de servir. Esa es la falla que este archivo evita.
 */

import { getJson, putJson } from "@/server/github-store";

const ARCHIVO = "data/codigos-emitidos.json";
const MAX = 2_000;
/** El proxy de audio consulta esto en cada canción: 5 minutos de caché. */
const CACHE_MS = 5 * 60 * 1000;

type Emitido = {
  /** Código completo. */
  c: string;
  /** Folio del pedido de origen. */
  f: string;
  /** Cuenta que lo tiene (null si se emitió sin cuenta). */
  u: string | null;
  /** ISO de emisión. */
  d: string;
  /** Sigue acreditando Premium. */
  a: boolean;
};

let cache: { mapa: Map<string, boolean>; expira: number } | null = null;
let enCurso: Promise<Emitido[]> | null = null;

function leerCrudo(): Promise<Emitido[]> {
  if (enCurso) return enCurso;
  enCurso = getJson<Emitido[]>("datos", ARCHIVO, [])
    .then((lista) =>
      Array.isArray(lista)
        ? lista.filter((e) => e && typeof e.c === "string" && typeof e.f === "string")
        : [],
    )
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

function cachear(lista: Emitido[]): void {
  const mapa = new Map<string, boolean>();
  for (const e of lista) mapa.set(e.c, Boolean(e.a));
  cache = { mapa, expira: Date.now() + CACHE_MS };
}

/** ¿Este código lo emitió el sitio y sigue vigente? */
export async function codigoEmitidoActivo(codigo: string): Promise<boolean> {
  if (!codigo) return false;
  const ahora = Date.now();
  if (cache && cache.expira > ahora) return cache.mapa.get(codigo) === true;
  try {
    const lista = await leerCrudo();
    cachear(lista);
    return cache?.mapa.get(codigo) === true;
  } catch {
    return false;
  }
}

/** Guarda los códigos recién emitidos (y reactiva uno que se reasigna). */
export async function registrarEmitidos(
  codigos: string[],
  folio: string,
  cuentaId: string | null = null,
): Promise<boolean> {
  if (!codigos.length) return true;
  try {
    const lista = await leerCrudo();
    const ahora = new Date().toISOString();
    const nuevos = new Map(codigos.map((c) => [c, { c, f: folio, u: cuentaId, d: ahora, a: true }]));
    // Los códigos de compras anteriores se dejan COMO ESTABAN: una emisión
    // nueva no puede apagar el Premium de todo el que compró antes.
    const siguiente: Emitido[] = [
      ...nuevos.values(),
      ...lista.filter((e) => !nuevos.has(e.c)),
    ].slice(0, MAX);
    const ok = await putJson("datos", ARCHIVO, siguiente, `códigos emitidos: ${codigos.length}`);
    if (ok) cachear(siguiente);
    return ok;
  } catch (e) {
    console.error("[codigos-emitidos] no se pudo registrar:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Suelta los códigos de una cuenta (baja o revocación) sin borrar el rastro. */
export async function soltarEmitidosDeCuenta(cuentaId: string): Promise<boolean> {
  if (!cuentaId) return true;
  try {
    const lista = await leerCrudo();
    if (!lista.some((e) => e.u === cuentaId && e.a)) return true;
    const siguiente = lista.map((e) => (e.u === cuentaId ? { ...e, a: false } : e));
    const ok = await putJson("datos", ARCHIVO, siguiente, `códigos liberados de la cuenta ${cuentaId}`);
    if (ok) cachear(siguiente);
    return ok;
  } catch {
    return false;
  }
}

/** Suelta el código exacto que se quitó de una cuenta. */
export async function soltarEmitido(codigo: string): Promise<boolean> {
  if (!codigo) return true;
  try {
    const lista = await leerCrudo();
    if (!lista.some((e) => e.c === codigo && e.a)) return true;
    const siguiente = lista.map((e) => (e.c === codigo ? { ...e, a: false } : e));
    const ok = await putJson("datos", ARCHIVO, siguiente, `código liberado: ${codigo.slice(0, 12)}…`);
    if (ok) cachear(siguiente);
    return ok;
  } catch {
    return false;
  }
}
