/**
 * Runtime de las extensiones de la demo: crea un sandbox por sesión+extensión,
 * lo hace correr y normaliza lo que devuelve.
 *
 * El driver implementa el REPLAY descrito en `shim.ts`: mientras haya
 * peticiones sin resolver, la misma función se vuelve a ejecutar hasta que la
 * extensión vea respuestas reales. Cada corrida congela el reloj y la semilla
 * aleatoria para que las URLs/cuerpos que firma no cambien entre corridas y
 * la caché converja.
 *
 * Reproduce la semántica de `extension_provider_search.go`:
 *   · con filtro del manifest → customSearch(query, {limit, filter})
 *   · sin filtro              → searchTracks(query, limit) si existe,
 *                               si no customSearch(query, {limit})
 */

import { normalizarItems, categoriaDe } from "./normalizar";
import { crearEntorno, traerPendiente, type Sandbox } from "./shim";
import type { Item, TipoResultado } from "./tipos";
import { creadores } from "./vendor";

type SandboxActivo = Sandbox & {
  api: Record<string, any>;
  ext: string;
  iniciado: boolean;
  /** Semilla con la que arranca cada corrida de la búsqueda en curso. */
  semillaBase: number;
};

type Registro = { sb: SandboxActivo; uso: Promise<unknown>; tocado: number };

const MAX_CORRIDAS = 25;
const TIEMPO_PETICION_MS = 12_000;
/** Techo de toda la llamada (todas las corridas y sus peticiones). */
const LIMITE_BUSQUEDA_MS = 20_000;
const MAX_SANDBOXES = 40;

/** "sesión|ext" → registro (sandbox + candado de serialización). */
const registros = new Map<string, Registro>();

function nuevaSemilla(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function obtenerRegistro(sesion: string, ext: string): Registro {
  const clave = sesion + "|" + ext;
  const previo = registros.get(clave);
  if (previo) {
    previo.tocado = Date.now();
    return previo;
  }

  const creador = creadores[ext];
  if (!creador) throw new Error("extensión desconocida: " + ext);

  const sb: SandboxActivo = {
    almacen: new Map(),
    cache: new Map(),
    cookies: new Map(),
    pendientes: [],
    registros: [],
    semilla: 1,
    reloj: Date.now(),
    avance: 0,
    api: {},
    ext,
    iniciado: false,
    semillaBase: 1,
  };
  const api = creador(crearEntorno(sb));
  if (!api || typeof api !== "object") throw new Error("la extensión no registró su API: " + ext);
  sb.api = api;

  const registro: Registro = { sb, uso: Promise.resolve(), tocado: Date.now() };
  registros.set(clave, registro);

  // LRU barato: si hay demasiados sandboxes se cae el más viejo; su caché se
  // vuelve a llenar en la siguiente búsqueda.
  if (registros.size > MAX_SANDBOXES) {
    let vieja: string | null = null;
    let viejo = Infinity;
    for (const [k, v] of registros) {
      if (v.tocado < viejo) {
        viejo = v.tocado;
        vieja = k;
      }
    }
    if (vieja) registros.delete(vieja);
  }

  return registro;
}

/**
 * Ejecuta `fn` (una función de la extensión) resolviendo las peticiones de
 * red que vaya registrando: una tanda por corrida, hasta converger.
 */
async function conReplay<T>(
  sb: SandboxActivo,
  fn: () => T | Promise<T>,
  hasta: number,
): Promise<T> {
  let ultimoError: unknown = null;
  let ultimoValor: T | undefined = undefined;

  for (let corrida = 0; corrida < MAX_CORRIDAS; corrida++) {
    if (Date.now() > hasta) {
      throw ultimoError ?? new Error("se agotó el tiempo de la búsqueda");
    }
    // El reloj virtual y la semilla se reinician: cada corrida debe leer y
    // firmar exactamente lo mismo que la anterior para converger.
    sb.avance = 0;
    sb.semilla = sb.semillaBase;
    sb.pendientes = [];
    try {
      ultimoValor = await fn();
      ultimoError = null;
    } catch (e) {
      ultimoError = e;
    }

    if (sb.pendientes.length === 0) {
      if (ultimoError) throw ultimoError;
      return ultimoValor as T;
    }

    const unicos = new Map<string, (typeof sb.pendientes)[number]>();
    for (const p of sb.pendientes) unicos.set(p.clave, p);
    await Promise.all(
      [...unicos.values()].map((p) => traerPendiente(sb, p, TIEMPO_PETICION_MS)),
    );
  }

  throw ultimoError ?? new Error("la extensión no terminó de resolver la red");
}

/** Serializa las llamadas sobre un mismo sandbox. */
function enRegistro<T>(reg: Registro, fn: () => Promise<T>): Promise<T> {
  const propia = reg.uso.then(fn, fn);
  reg.uso = propia.then(
    () => undefined,
    () => undefined,
  );
  return propia;
}

export type BusquedaExtension = {
  sesion: string;
  ext: string;
  consulta: string;
  /** Id de filtro del manifest (p. ej. "tracks") o null para "todo". */
  filtro: string | null;
  limite: number;
};

/**
 * Busca en una extensión. Lanza si la extensión no pudo responder: el
 * llamador decide si cae al catálogo de respaldo.
 */
export async function buscarEnExtension(opts: BusquedaExtension): Promise<Item[]> {
  const reg = obtenerRegistro(opts.sesion, opts.ext);
  const consulta = opts.consulta.trim();
  const limite = Math.max(1, Math.min(50, opts.limite || 12));
  const filtro = opts.filtro?.trim() || null;
  const tipoFijo: TipoResultado | undefined = filtro
    ? (categoriaDe(filtro) ?? "track")
    : undefined;

  if (!consulta) return [];

  return enRegistro(reg, async () => {
    const sb = reg.sb;
    const hasta = Date.now() + LIMITE_BUSQUEDA_MS;
    sb.reloj = Date.now();
    sb.semillaBase = nuevaSemilla(opts.ext + "|" + consulta + "|" + (filtro ?? ""));
    sb.semilla = sb.semillaBase;
    sb.avance = 0;

    if (!sb.iniciado) {
      await conReplay(sb, () => sb.api.initialize?.({}), hasta);
      sb.iniciado = true;
    }

    const metodo = filtro
      ? "customSearch"
      : typeof sb.api.searchTracks === "function"
        ? "searchTracks"
        : "customSearch";
    if (typeof sb.api[metodo] !== "function") {
      throw new Error("la extensión no expone " + metodo);
    }

    const crudo = await conReplay(
      sb,
      () =>
        metodo === "customSearch"
          ? sb.api.customSearch(consulta, filtro ? { limit: limite, filter: filtro } : { limit: limite })
          : sb.api.searchTracks(consulta, limite),
      hasta,
    );

    return normalizarItems(crudo, tipoFijo).slice(0, limite);
  });
}

export type LlamadaExtension = {
  sesion: string;
  ext: string;
  /** Nombre del método expuesto por la extensión (p. ej. "checkAvailability"). */
  metodo: string;
  args?: unknown[];
};

/**
 * Llama a un método cualquiera de la extensión (no solo la búsqueda). Lo usa el
 * rescate de audio para `checkAvailability` de `qobuz-web`, que es el contrato
 * de la app: "ISRC + nombre + duración entra, id verificado de Qobuz sale".
 * Comparte el sandbox, el replay y la serialización de `buscarEnExtension`.
 */
export async function llamarExtension<T>(opts: LlamadaExtension): Promise<T> {
  const reg = obtenerRegistro(opts.sesion, opts.ext);
  return enRegistro(reg, async () => {
    const sb = reg.sb;
    const hasta = Date.now() + LIMITE_BUSQUEDA_MS;
    const args = opts.args ?? [];
    sb.reloj = Date.now();
    sb.semillaBase = nuevaSemilla(opts.ext + "|" + opts.metodo + "|" + JSON.stringify(args));
    sb.semilla = sb.semillaBase;
    sb.avance = 0;

    if (!sb.iniciado) {
      await conReplay(sb, () => sb.api.initialize?.({}), hasta);
      sb.iniciado = true;
    }
    const fn = sb.api[opts.metodo];
    if (typeof fn !== "function") throw new Error("la extensión no expone " + opts.metodo);
    return conReplay(sb, () => fn(...args), hasta);
  });
}

/** Diagnóstico: últimos registros de log del sandbox (para el harness). */
export function registrosDe(sesion: string, ext: string): string[] {
  return registros.get(sesion + "|" + ext)?.sb.registros ?? [];
}

/**
 * Diagnóstico: respuestas cacheadas de la última llamada (para el harness).
 * `sub` filtra por URL; `limite` recorta cada cuerpo.
 */
export function cacheDe(
  sesion: string,
  ext: string,
  sub?: string,
  limite = 4000,
): { clave: string; estado: number; cuerpo: string }[] {
  const sb = registros.get(sesion + "|" + ext)?.sb;
  if (!sb) return [];
  const salida: { clave: string; estado: number; cuerpo: string }[] = [];
  for (const [clave, resp] of sb.cache) {
    if (sub && !clave.includes(sub)) continue;
    const cuerpo = resp.body ?? "";
    salida.push({
      clave,
      estado: resp.status,
      cuerpo: cuerpo.length > limite ? cuerpo.slice(0, limite) + `…[${cuerpo.length}]` : cuerpo,
    });
  }
  return salida;
}
