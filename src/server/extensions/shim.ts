/**
 * Shim del host para las extensiones vendorizadas.
 *
 * Reproduce la superficie que las extensiones de la app usan dentro del
 * sandbox goja (http, fetch, log, storage, utils, gobackend y un Math
 * determinista), con las mismas formas de respuesta que
 * go_backend/internal/extensions.
 *
 * La red es lo delicado: http.get/fetch de la app son SÍNCRONOS, y en
 * Cloudflare Workers (y en cualquier runtime moderno) no podemos bloquear el
 * hilo esperando una respuesta. Por eso el shim trabaja por REPLAY:
 *
 *   1. cache hit  → devuelve la respuesta guardada (síncrono);
 *   2. cache miss → registra la petición en `pendientes` y devuelve un objeto
 *                   venenoso (status 0 / ok false), sin esperar nada;
 *   3. el driver (runtime.ts) fetchea los pendientes en paralelo al terminar
 *                   la corrida y vuelve a ejecutar el mismo método: ahora hay
 *                   caché, así que la extensión ve la respuesta real.
 *
 * Cada corrida usa un Math.random con semilla fija (por búsqueda) para que
 * los valores aleatorios que la extensión mete en una petición —device ids,
 * nonces— se repitan y la clave de caché converja.
 */

import { hmacSha1, md5Hex } from "./hash";
import type { Pendiente, RespuestaFetch, RespuestaHttp } from "./tipos";

/** Estado por sandbox (una sesión + una extensión). */
export type Sandbox = {
  almacen: Map<string, string>;
  cache: Map<string, Cacheada>;
  pendientes: Pendiente[];
  registros: string[];
  /** Semilla del `Math.random` de la corrida en curso. */
  semilla: number;
  /** Instante (ms) en el que arrancó la búsqueda en curso. */
  reloj: number;
  /**
   * Milisegundos virtuales avanzados en la corrida en curso. `Date.now()`
   * dentro de la extensión es `reloj + avance`, y `avance` crece 1 ms por
   * cada lectura: los `while (Date.now() < fin)` terminan, y como el avance
   * se reinicia en cada corrida, dos corridas leen la misma hora y firman lo
   * mismo (si no, la caché nunca convergería).
   */
  avance: number;
  /**
   * Tarro de cookies persistente del sandbox, como el `cookiejar` que usa el
   * backend Go de la app: clave = dominio, valor = cookies de ese dominio.
   */
  cookies: Map<string, Map<string, { valor: string; hostSolo: boolean }>>;
};

export type Cacheada = {
  status: number;
  body: string;
  cabeceras: Record<string, string[]>;
  url: string;
};

const LIMITE_CUERPO = 6 * 1024 * 1024;
const LIMITE_REGISTROS = 120;

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
];

/**
 * Los dos UAs móviles de la lista del backend Go sirven para SoundCloud una
 * página cuyos bundles no contienen el `client_id`, y la extensión solo
 * mira los últimos 8: la búsqueda sale siempre vacía. La demo sortea
 * únicamente entre los de escritorio.
 */
const UAS_ESCRITORIO = UAS.filter((ua) => !/Mobile|iPhone/.test(ua));

/* ── Red ─────────────────────────────────────────────────────────── */

const PRIVADOS =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/;

/** Bloquea SSRF trivial: solo http(s) y nunca hacia redes privadas. */
export function urlValida(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return (
    !PRIVADOS.test(u.hostname) && !u.hostname.endsWith(".local") && !u.hostname.endsWith(".internal")
  );
}

function canonico(nombre: string): string {
  return nombre
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p))
    .join("-");
}

function cabecerasDe(res: Response): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  res.headers.forEach((valor, clave) => {
    salida[canonico(clave)] = [valor];
  });
  const h = res.headers as Headers & {
    getSetCookie?: () => string[];
    getAll?: (n: string) => string[];
  };
  const cookies =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : typeof h.getAll === "function"
        ? h.getAll("set-cookie")
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie") as string]
          : [];
  if (cookies.length > 0) salida["Set-Cookie"] = cookies;
  return salida;
}

function clavePeticion(metodo: string, url: string, cuerpo: string) {
  return metodo + " " + url + " " + cuerpo;
}

/* ── Tarro de cookies ────────────────────────────────────────────── */

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Guarda los `Set-Cookie` de una respuesta (réplica del cookiejar de Go). */
function guardarCookies(sb: Sandbox, url: string, lineas: string[] | undefined) {
  const host = dominioDe(url);
  if (!host || !lineas || lineas.length === 0) return;
  for (const linea of lineas) {
    const [par, ...atributos] = linea.split(";");
    const corte = par.indexOf("=");
    if (corte <= 0) continue;
    const nombre = par.slice(0, corte).trim();
    if (!nombre) continue;
    const valor = par.slice(corte + 1).trim();
    let dominio = host;
    let hostSolo = true;
    let caducada = false;
    for (const atributo of atributos) {
      const i = atributo.indexOf("=");
      const k = (i === -1 ? atributo : atributo.slice(0, i)).trim().toLowerCase();
      const v = i === -1 ? "" : atributo.slice(i + 1).trim();
      if (k === "domain" && v) {
        dominio = v.replace(/^\./, "").toLowerCase();
        hostSolo = false;
      } else if (
        (k === "max-age" && Number(v) <= 0) ||
        (k === "expires" && Date.parse(v) <= Date.now())
      ) {
        caducada = true;
      }
    }
    let mapa = sb.cookies.get(dominio);
    if (caducada) {
      mapa?.delete(nombre);
      if (mapa && mapa.size === 0) sb.cookies.delete(dominio);
      continue;
    }
    if (!mapa) {
      mapa = new Map();
      sb.cookies.set(dominio, mapa);
    }
    if (!mapa.has(nombre)) registrar(sb, "debug", "cookie " + nombre + "@" + dominio);
    mapa.set(nombre, { valor, hostSolo });
  }
}

/** Cabecera `Cookie` que corresponde a la URL, si hay algo guardado. */
function cookiesPara(sb: Sandbox, url: string): string | undefined {
  const host = dominioDe(url);
  if (!host) return undefined;
  const partes: string[] = [];
  for (const [dominio, mapa] of sb.cookies) {
    for (const [nombre, galleta] of mapa) {
      if (host === dominio || (!galleta.hostSolo && host.endsWith("." + dominio))) {
        partes.push(nombre + "=" + galleta.valor);
      }
    }
  }
  return partes.length > 0 ? partes.join("; ") : undefined;
}

/**
 * Anota una petición pendiente si no está en caché. Devuelve la respuesta
 * guardada o `null` cuando falta (el llamador devuelve el veneno).
 */
function consultar(
  sb: Sandbox,
  metodo: string,
  url: string,
  cuerpo: string,
  cabeceras: Record<string, string>,
): Cacheada | null {
  if (!urlValida(url)) throw new TypeError("domain not allowed: " + url);
  const clave = clavePeticion(metodo, url, cuerpo);
  const guardada = sb.cache.get(clave);
  if (guardada) return guardada;
  if (!sb.pendientes.some((p) => p.clave === clave)) {
    sb.pendientes.push({ clave, metodo, url, cuerpo, cabeceras });
  }
  return null;
}

/** Trae de la red una petición pendiente y la memoriza en caché. */
export async function traerPendiente(
  sb: Sandbox,
  p: Pendiente,
  tiempoMs: number,
): Promise<void> {
  if (sb.cache.has(p.clave)) return;
  if (!urlValida(p.url)) {
    sb.cache.set(p.clave, { status: 0, body: "", cabeceras: {}, url: p.url });
    return;
  }

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), tiempoMs);
  const cabeceras: Record<string, string> = { ...p.cabeceras };
  const galleta = cookiesPara(sb, p.url);
  if (galleta && !Object.keys(cabeceras).some((k) => k.toLowerCase() === "cookie")) {
    cabeceras.Cookie = galleta;
  }
  try {
    const res = await globalThis.fetch(p.url, {
      method: p.metodo,
      headers: cabeceras,
      body: p.cuerpo || undefined,
      redirect: "follow",
      signal: control.signal,
    });
    let body = await res.text();
    if (body.length > LIMITE_CUERPO) body = body.slice(0, LIMITE_CUERPO);
    const cab = cabecerasDe(res);
    guardarCookies(sb, res.url || p.url, cab["Set-Cookie"]);
    sb.cache.set(p.clave, {
      status: res.status,
      body,
      cabeceras: cab,
      url: res.url || p.url,
    });
  } catch (e) {
    // Un fallo de red también se memoriza: la extensión ve su error sin
    // reintentar la misma URL para siempre.
    sb.cache.set(p.clave, { status: 0, body: "", cabeceras: {}, url: p.url });
    registrar(sb, "error", "sin respuesta " + p.metodo + " " + p.url + ": " + String(e));
  } finally {
    clearTimeout(reloj);
  }
}

/* ── Adaptadores de respuesta ────────────────────────────────────── */

const venenoHttp: RespuestaHttp = Object.freeze({
  status: 0,
  statusCode: 0,
  ok: false,
  body: "",
  headers: {},
  error: "pendiente",
});

function desdeCacheHttp(c: Cacheada): RespuestaHttp {
  return {
    status: c.status,
    statusCode: c.status,
    ok: c.status >= 200 && c.status < 300,
    body: c.body,
    headers: c.cabeceras,
    url: c.url,
  };
}

function desdeCacheFetch(c: Cacheada): RespuestaFetch {
  let parseado: unknown = null;
  let parseadoYa = false;
  const planas: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.cabeceras)) {
    planas[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return {
    ok: c.status >= 200 && c.status < 300,
    status: c.status,
    body: c.body,
    text: () => c.body,
    json: () => {
      if (!parseadoYa) {
        parseadoYa = true;
        try {
          parseado = JSON.parse(c.body);
        } catch {
          parseado = null;
        }
      }
      return parseado;
    },
    headers: Object.assign(
      {
        get: (nombre: string) => {
          const clave = canonico(nombre);
          const vals = c.cabeceras[clave] ?? c.cabeceras[nombre];
          return vals ? (Array.isArray(vals) ? vals.join(", ") : vals) : undefined;
        },
      },
      planas,
    ),
  };
}

const venenoFetch: RespuestaFetch = Object.freeze({
  ok: false,
  status: 0,
  body: "",
  text: () => "",
  json: () => null,
  headers: { get: () => undefined },
} as unknown as RespuestaFetch);

/* ── Objetos del entorno ─────────────────────────────────────────── */

function registrar(sb: Sandbox, nivel: string, ...args: unknown[]) {
  const texto = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a)))
    .join(" ");
  sb.registros.push("[" + nivel + "] " + texto);
  if (sb.registros.length > LIMITE_REGISTROS) sb.registros.shift();
}

function crearLog(sb: Sandbox) {
  const uno = (nivel: string) => (...args: unknown[]) => registrar(sb, nivel, ...args);
  const info = uno("info");
  return { info, debug: uno("debug"), warn: uno("warn"), error: uno("error"), log: info };
}

function crearStorage(sb: Sandbox) {
  return {
    get: (clave: string) => (sb.almacen.has(clave) ? sb.almacen.get(clave) : undefined),
    set: (clave: string, valor: unknown) => {
      sb.almacen.set(clave, String(valor));
    },
    delete: (clave: string) => {
      sb.almacen.delete(clave);
    },
    clear: () => sb.almacen.clear(),
    keys: () => [...sb.almacen.keys()],
  };
}

function normalizarCabeceras(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const salida: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val !== undefined && val !== null) salida[k] = String(val);
  }
  return salida;
}

function crearHttp(sb: Sandbox) {
  const base =
    (metodo: string, conCuerpo: boolean) =>
    (url: string, ...resto: unknown[]) => {
      const idxCuerpo = conCuerpo ? 0 : -1;
      const idxCabeceras = conCuerpo ? 1 : 0;
      const cuerpo = conCuerpo ? String(resto[idxCuerpo] ?? "") : "";
      const cabeceras = normalizarCabeceras(resto[idxCabeceras]);
      const cacheado = consultar(sb, metodo, String(url), cuerpo, cabeceras);
      if (!cacheado) return venenoHttp;
      return desdeCacheHttp(cacheado);
    };
  return {
    get: base("GET", false),
    post: base("POST", true),
    put: base("PUT", true),
    head: base("HEAD", false),
    statusCode: (codigo: number) => ESTADOS[codigo] ?? "",
  };
}

function crearFetch(sb: Sandbox) {
  return (
    url: string,
    opciones?: { method?: string; body?: string; headers?: Record<string, string> },
  ): RespuestaFetch => {
    const metodo = String(opciones?.method ?? "GET").toUpperCase();
    const cuerpo = metodo === "GET" || metodo === "HEAD" ? "" : String(opciones?.body ?? "");
    const cabeceras = normalizarCabeceras(opciones?.headers);
    const cacheado = consultar(sb, metodo, String(url), cuerpo, cabeceras);
    if (!cacheado) return venenoFetch;
    return desdeCacheFetch(cacheado);
  };
}

const ESTADOS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  410: "Gone",
  418: "I'm a teapot",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/* ── utils / gobackend ───────────────────────────────────────────── */

function b64aBytes(texto: string): Uint8Array {
  try {
    const bin = atob(texto);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function bytesAb64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function bytesAtexto(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function aBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v.map((n) => Number(n) & 0xff));
  return new Uint8Array(0);
}

function crearUtils(sb: Sandbox) {
  return {
    md5: (texto: string) => md5Hex(String(texto)),
    hmacSHA1: (clave: unknown, datos: unknown) => hmacSha1(aBytes(clave), aBytes(datos)),
    base64Encode: (texto: string) => bytesAb64(new TextEncoder().encode(String(texto))),
    base64Decode: (texto: string) => bytesAtexto(b64aBytes(String(texto))),
    randomUserAgent: () => UAS_ESCRITORIO[aleatorio(sb, UAS_ESCRITORIO.length)],
    appUserAgent: () => "Bitly/1.0",
    appVersion: () => "1.0.0",
    timestamp: () => Math.floor((sb.reloj || Date.now()) / 1000),
    timestampMs: () => sb.reloj || Date.now(),
    isDownloadCancelled: () => false,
    isRequestCancelled: () => false,
    getResolutionRemainingMs: () => 50_000,
    sleep: (ms: number) => {
      registrar(sb, "warn", "utils.sleep(" + ms + ") ignorado en la demo");
      return true;
    },
    // El descifrado Blowfish es solo para bajar audio de Deezer: fuera del
    // alcance de la demo, y la extensión no lo invoca al buscar.
    decryptBlockCipher: () => ({ success: false, error: "no disponible en la demo" }),
  };
}

function crearGobackend(sb: Sandbox) {
  const ahora = new Date(sb.reloj || Date.now());
  return {
    getLocalTime: () => ({
      hour: ahora.getHours(),
      minute: ahora.getMinutes(),
      second: ahora.getSeconds(),
      timezone: "UTC",
      offsetMinutes: -ahora.getTimezoneOffset(),
    }),
    getGreeting: () => {
      const h = ahora.getHours();
      return h < 12 ? "Buenos días" : h < 18 ? "Buenas tardes" : "Buenas noches";
    },
    getAudioQuality: () => ({ error: "no disponible en la demo" }),
    getLyricsLRC: () => ({ lyrics: "[instrumental:true]" }),
    checkISRCExists: () => ({ exists: false, filePath: "" }),
  };
}

/** PRNG con semilla (mulberry32): el mismo orden en cada corrida. */
function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aleatorio(sb: Sandbox, hasta: number): number {
  return Math.floor(mulberry32(sb.semilla++)() * hasta);
}

/** El Math de la extensión: idéntico al global, con `random` sembrado. */
function crearMatematicas(sb: Sandbox): Math {
  const sombra = Object.create(Math) as Math;
  Object.defineProperty(sombra, "random", {
    value: () => mulberry32(sb.semilla++)(),
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return sombra;
}

/**
 * El Date de la extensión: mismo contrato que el global, pero sobre un reloj
 * virtual que avanza 1 ms por lectura y se reinicia en cada corrida.
 *
 *  · `while (Date.now() < fin)` (p. ej. el `sleep` de Amazon) avanza el
 *    reloj con sus propias lecturas y termina en vez de girar para siempre;
 *  · dos corridas de la misma búsqueda leen exactamente la misma hora, así
 *    que las firmas/timestamps que la extensión mete en un cuerpo se
 *    repiten y la caché de la petición converge.
 */
function crearFecha(sb: Sandbox): DateConstructor {
  const tick = () => {
    sb.avance += 1;
    return sb.reloj + sb.avance;
  };
  class FechaVirtual extends Date {
    constructor(...args: any[]) {
      // `new Date(y, m, d, …)` se reconstruye con Reflect para no perder
      // argumentos; `new Date()` lee el reloj virtual.
      super(
        args.length === 0
          ? tick()
          : (Reflect.construct(Date, args) as Date).getTime(),
      );
    }
    static now() {
      return tick();
    }
  }
  return FechaVirtual as unknown as DateConstructor;
}

/**
 * El objeto que la función `crear(entorno)` de cada extensión recibe por
 * parámetro. Es TODO lo que el código de la extensión puede ver además de los
 * estándares del runtime (URL, Intl, JSON, setTimeout, console…).
 */
export function crearEntorno(sb: Sandbox) {
  const log = crearLog(sb);
  return {
    http: crearHttp(sb),
    fetch: crearFetch(sb),
    log,
    storage: crearStorage(sb),
    utils: crearUtils(sb),
    gobackend: crearGobackend(sb),
    Math: crearMatematicas(sb),
    Date: crearFecha(sb),
    console: log,
  };
}


