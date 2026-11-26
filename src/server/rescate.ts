/**
 * Rescate de audio de la demo: de una pista de CUALQUIER fuente a una URL que
 * el reproductor pueda sonar.
 *
 * Es el mismo camino que usa la app (`go_backend/internal/provider/flacrescue`),
 * adaptado a lo que la landing sí puede hacer:
 *
 *   1. IDENTIDAD. Se compara con el matching del backend
 *      (`bestOriginalAlbumDuracion`): título + artista + álbum + duración, con
 *      las versiones no originales descartadas. El ISRC manda cuando existe, en
 *      este orden de precisión:
 *        a. El ISRC de una fuente que puede dar fe de él
 *           (`matching.esProveedorAutoritativoISRC`) se resuelve contra el
 *           catálogo de Qobuz por DOS caminos en paralelo: la extensión
 *           `qobuz-web.checkAvailability` (vía su espejo, primero SOLO por ISRC
 *           y después con el título sin créditos entre paréntesis: el
 *           paréntesis hacía fallar su `titlesMatch`) y, sin espejo de por
 *           medio, la API pública `qobuz.com/api.json/0.2` —la del backend—
 *           que además devuelve el ISRC de cada pista. Cuando el espejo se
 *           cae, el camino directo evita depender de él. Un ISRC
 *           que Qobuz no indexa NO arma cuarentena: eso es un "no está", no un
 *           canal caído.
 *        b. Si la fuente no publica ISRC (Spotify, TIDAL, Amazon, YouTube) o el
 *           suyo no está indexado, se le pide el ISRC al catálogo de respaldo
 *           (`isrcDeRespaldo`, Deezer es autoritativo) y se resuelve por él. Así
 *           las 8 fuentes terminan matcheando por el mismo identificador.
 *        c. Si tampoco, se busca por nombre (también por los dos caminos) y,
 *           cuando el título declara `ARTISTA - Canción` (re-subidos), se
 *           reintenta con lo que el título dice en vez del canal que figura
 *           como artista.
 *   2. AUDIO. Ese id se canjea por una URL de CDN de Qobuz con el relay del
 *      proyecto Stash (`stash_relay.go`): una config firmada y pública trae la
 *      `relay_key`, y el mint va firmado con HMAC-SHA256. La URL trae su propio
 *      vencimiento (`etsp`), que se usa como TTL de la caché. Un `503 busy` del
 *      relay se reintenta con espera corta (dentro de un presupuesto de 7 s):
 *      "ocupado" no es "no tengo esa pista".
 *   3. YOUTUBE. Si el catálogo o el relay no consiguen el FLAC, se le pide el
 *      audio COMPLETO a un backend de yt-dlp, elegido por env:
 *        · `YT_DLP_BACKEND_URL`: el backend local de desarrollo
 *          (`scripts/backend-yt-dlp.mjs`, `pnpm yt-dlp`). Va PRIMERO para el
 *          audio cuando está configurado: en la misma máquina resuelve en ~7 s;
 *        · Invidious directo (`INVIDIOUS_URLS`): búsqueda PRINCIPAL en
 *          producción. Para AUDIO queda apagado por defecto
 *          (`INVIDIOUS_AUDIO_DIRECTO=1` lo habilita): sus URLs llevan la IP del
 *          worker y el navegador puede recibir 403/HTML.
 *        · `YATTEE_URL` (+ `YATTEE_AUTH` "user:pass"): canal de audio. Busca
 *          (`/api/v1/search`), extrae con `player-client=web_embedded` y
 *          devuelve un stream FIRMADO de su relay (`/proxy/relay`).
 *      Ambos proxyan el stream de googlevideo —el navegador nunca ve ese
 *      dominio, y el backend elude el binding de IP—. Sin backend configurado
 *      (o si falla), la pista queda SIN audio y la interfaz lo avisa: nunca se
 *      sirve un adelanto de 30 s.
 *
 * NOTA de alcance: los otros canales del backend (`arcod`, `espejos`) viven de
 * pools de cuentas de terceros que hoy están vacíos/baneados (ver
 * `bitly/docs/canales_rescate_alternativas.md`) y `qobuz-firmado` necesita un
 * `user_auth_token` con suscripción. Los canales vivos y sin credenciales son
 * `stash-relay` (FLAC) y el backend local de YouTube, los dos implementados acá.
 */

import { buscarEnExtension, isrcDeRespaldo, llamarExtension } from "@/server/extensions";
import type { Item } from "@/server/extensions";
import {
  bestOriginalAlbumDuracion,
  esISRCValido,
  esProveedorAutoritativoISRC,
  fieldScore,
  marcadoresDeVersion,
  normalizarISRC,
  preferirISRC,
  QueryFiltro,
  sinCreditosParenteticos,
  splitSearchQuery,
  versionPedidaCompatible,
  type TrackResult,
} from "@/server/matching";
import { tocaConsulta } from "@/server/relevancia";
import { crearSemaforo, esOcupado, type Semaforo } from "@/server/semaforo";

/* ── Tipos del contrato ──────────────────────────────────────────── */

export type PeticionAudio = {
  titulo: string;
  artista: string;
  album?: string;
  /** Milisegundos; 0/undefined = la fuente no lo publica. */
  duracionMs?: number;
  isrc?: string | null;
  /** Extensión de origen: decide si su ISRC es autoritativo. */
  ext?: string | null;
  /**
   * Id del item en la fuente de origen. En YouTube Music ES el videoId de
   * YouTube: cuando viene, el rescate resuelve ESE video en vez de adivinar
   * por nombre (lo que falla justo en artistas de nicho).
   */
  id?: string | null;
  /** VideoId de YouTube ya normalizado por `demo-proxy` (11 caracteres). */
  videoId?: string | null;
  /**
   * Calidad a servir. La decide el SERVIDOR (`demo-proxy`): "flac" sólo para
   * quien acredita Premium, "estandar" para el resto. "estandar" manda primero
   * por YouTube (AAC ~128 kbps) y sólo cae al canal sin pérdida si ese backend
   * no está disponible o no encuentra la pista, para que la demo nunca quede
   * muda por un canal caído.
   */
  calidad?: "flac" | "estandar";
  /**
   * Código Premium que mandó el navegador. Lo consume `demo-proxy` para
   * acreditar la calidad; `resolverAudio` no lo mira (recibe `calidad` ya
   * decidida) y no se cachea ni se guarda en ningún enlace.
   */
  codigo?: string | null;
  /**
   * Token de la cuenta del navegador. También lo consume sólo `demo-proxy`, para
   * que una sesión válida no gaste el cupo de rescates por IP.
   */
  token?: string | null;
  /**
   * Canales que el navegador ya intentó y no abrieron (429 del catálogo, 403
   * del relay, enlace vencido). Se piden los demás en vez de devolver otra vez
   * el mismo enlace roto: es la red que evita que la demo quede muda.
   */
  evitar?: string[];
};

export type AudioResuelto = {
  url: string;
  /** Segundos (se usa en la barra del reproductor). */
  duracion: number;
  canal: "monochrome" | "stash-relay" | "stash-tidal" | "bandcamp" | "youtube";
  /** De dónde salió la identidad: "qobuz-web" o el catálogo del respaldo. */
  proveedor: string;
  /** Id de la pista en el catálogo que resolvió. */
  id: string | null;
  isrc: string | null;
  bitDepth?: number;
  sampleRate?: number;
};

/* ── Caché de enlaces ────────────────────────────────────────────── */

type Enlace = { url: string; duracion: number; canal: "monochrome" | "stash-relay" | "stash-tidal" | "bandcamp" | "youtube"; proveedor: string; id: string | null; isrc: string | null; expira: number };

const enlaces = new Map<string, Enlace>();
const MAX_ENLACES = 400;
/** Single-flight: dos clics seguidos sobre la misma pista comparten la misma
 *  resolución (idea tomada de monochrome: pendingRequests por clave). No se
 *  cachean los FALLOS: un corte del relay o de YouTube es transitorio y el
 *  siguiente clic debe poder reintentar de inmediato. */
const enVuelo = new Map<string, Promise<{ audio: AudioResuelto | null; motivo: string | null }>>();

function claveDe(p: PeticionAudio): string {
  // La calidad entra en la clave: el enlace FLAC de un Premium no puede
  // reutilizarlo una cuenta gratis (ni al revés, que se quedaría en estándar).
  return [
    // Sólo los textos se pliegan: los id de YouTube distinguen mayúsculas y
    // bajarlas podía mezclar dos videos distintos.
    p.titulo.toLowerCase(),
    p.artista.toLowerCase(),
    (p.album ?? "").toLowerCase(),
    p.duracionMs ?? 0,
    p.isrc ?? "",
    // Sin el id, dos versiones distintas con igual título/artista/duración
    // compartían caché y una podía servir el audio de la otra (el remix).
    p.id ?? "",
    p.videoId ?? "",
    (p.ext ?? "").toLowerCase(),
    p.calidad ?? "flac",
  ].join("|");
}

/** Claves equivalentes: la exacta y, si hay ISRC, una canónica por código. */
function clavesDe(p: PeticionAudio): string[] {
  const claves = [claveDe(p)];
  const isrc = normalizarISRC(p.isrc);
  // La calidad también forma parte de la clave canónica: sin ella, un enlace
  // FLAC guardado por una cuenta Premium podía servirse a una gratis (o al
  // revés) sólo porque compartían ISRC.
  if (isrc) claves.push(`isrc:${isrc}:${p.calidad ?? "flac"}`);
  return claves;
}

function guardarEnlace(claves: string[], e: Enlace) {
  if (enlaces.size >= MAX_ENLACES) {
    // Poda simple: se van los vencidos y, si no alcanza, el más viejo.
    const ahora = Date.now();
    for (const [k, v] of enlaces) {
      if (v.expira <= ahora) enlaces.delete(k);
    }
    if (enlaces.size >= MAX_ENLACES) {
      let vieja: string | null = null;
      let vence = Infinity;
      for (const [k, v] of enlaces) {
        if (v.expira < vence) {
          vence = v.expira;
          vieja = k;
        }
      }
      if (vieja) enlaces.delete(vieja);
    }
  }
  for (const clave of claves) enlaces.set(clave, e);
}

function enlaceCacheado(claves: string[]): Enlace | null {
  const ahora = Date.now();
  for (const clave of claves) {
    const e = enlaces.get(clave);
    if (e && e.expira > ahora) return e;
  }
  return null;
}

/* ── Caché de audio compartida entre isolates ─────────────────────── */

type EntradaCacheAudio = { audio: AudioResuelto; expira: number };

const CACHE_AUDIO_URL = "https://bitly-site.pages.dev/__bitly-cache/v2/audio/";

/** `caches.default` en Cloudflare; `null` en Node o si el runtime no lo expone. */
function cacheDelBorde(): Cache | null {
  try {
    const almacen = (globalThis as { caches?: { default?: Cache } }).caches;
    return almacen?.default ?? null;
  } catch {
    return null;
  }
}

function peticionCacheAudio(clave: string): Request {
  return new Request(`${CACHE_AUDIO_URL}${encodeURIComponent(clave)}`, { method: "GET" });
}

/** Enlace guardado por OTRO isolate: evita repetir la extracción al mismo host. */
async function leerCacheAudio(claves: string[]): Promise<Enlace | null> {
  const cache = cacheDelBorde();
  if (!cache) return null;
  for (const clave of claves) {
    try {
      const respuesta = await cache.match(peticionCacheAudio(clave));
      if (!respuesta) continue;
      const entrada = (await respuesta.json()) as EntradaCacheAudio;
      if (!entrada?.audio || !entrada.expira || entrada.expira <= Date.now() + 30_000) {
        void cache.delete(peticionCacheAudio(clave)).catch(() => undefined);
        continue;
      }
      return { ...entrada.audio, expira: entrada.expira };
    } catch {
      // Una caché lenta o corrupta no puede tumbar una reproducción.
    }
  }
  return null;
}

/**
 * Publica un enlace en la caché del borde para que los demás isolates del
 * mismo centro de datos lo reutilicen. Sólo enlaces con vida útil suficiente:
 * un token que vence en 40 s no gana nada y ensucia la caché.
 */
async function guardarCacheAudio(claves: string[], enlace: Enlace): Promise<void> {
  const cache = cacheDelBorde();
  if (!cache) return;
  const segundos = Math.floor((enlace.expira - Date.now()) / 1000) - 60;
  if (segundos < 60) return;
  const ttl = Math.min(segundos, 45 * 60);
  const { expira, ...audio } = enlace;
  const cuerpo: EntradaCacheAudio = { audio, expira };
  const respuesta = new Response(JSON.stringify(cuerpo), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${ttl}`,
    },
  });
  for (const clave of claves) {
    try {
      await cache.put(peticionCacheAudio(clave), respuesta.clone());
    } catch {
      // La caché es una optimización; si falla, el rescate sigue normal.
    }
  }
}

/* ── Topes de concurrencia por isolate ────────────────────────────── */

function numeroEnv(nombre: string, defecto: number, minimo: number, maximo: number): number {
  const valor = Number(process.env[nombre]);
  if (!Number.isFinite(valor)) return defecto;
  return Math.max(minimo, Math.min(maximo, Math.floor(valor)));
}

let cupoRescate: Semaforo | null = null;
let cupoInvidious: Semaforo | null = null;
let cupoInvidiousBusqueda: Semaforo | null = null;
let cupoYatteeAudio: Semaforo | null = null;
let cupoYatteeBusqueda: Semaforo | null = null;

/** Rescates completos en paralelo: protege CPU/memoria y hosts externos. */
function cupoRescateActual(): Semaforo {
  cupoRescate ??= crearSemaforo(
    numeroEnv("RESCATE_CONCURRENCIA", 12, 3, 32),
    numeroEnv("RESCATE_COLA", 200, 20, 1000),
    numeroEnv("RESCATE_ESPERA_MS", 40_000, 5_000, 80_000),
  );
  return cupoRescate;
}

/** Invidious es UNA instancia pública: no se le mandan ráfagas sin freno. */
function cupoInvidiousActual(): Semaforo {
  cupoInvidious ??= crearSemaforo(
    numeroEnv("INVIDIOUS_CONCURRENCIA", 4, 1, 10),
    numeroEnv("INVIDIOUS_COLA", 80, 10, 400),
    numeroEnv("INVIDIOUS_ESPERA_MS", 25_000, 5_000, 60_000),
  );
  return cupoInvidious;
}

/**
 * Búsquedas en Invidious: cupo aparte para que una ráfaga de búsquedas no
 * consuma los turnos de audio (ni al revés). Es la misma instancia pública.
 */
function cupoInvidiousBusquedaActual(): Semaforo {
  cupoInvidiousBusqueda ??= crearSemaforo(
    2,
    40,
    numeroEnv("INVIDIOUS_BUSQUEDA_ESPERA_MS", 8_000, 3_000, 30_000),
  );
  return cupoInvidiousBusqueda;
}

/** Extracciones de audio de Yattee (yt-dlp + ffmpeg en Render). */
function cupoYatteeAudioActual(): Semaforo {
  cupoYatteeAudio ??= crearSemaforo(
    numeroEnv("YATTEE_CONCURRENCIA", 2, 1, 8),
    60,
    20_000,
  );
  return cupoYatteeAudio;
}

/** Búsquedas de Yattee: baratas, pero tampoco ilimitadas. */
function cupoYatteeBusquedaActual(): Semaforo {
  cupoYatteeBusqueda ??= crearSemaforo(
    numeroEnv("YATTEE_BUSQUEDA_CONCURRENCIA", 6, 2, 16),
    80,
    numeroEnv("YATTEE_BUSQUEDA_ESPERA_MS", 15_000, 5_000, 45_000),
  );
  return cupoYatteeBusqueda;
}


/* ── Canal stash-relay (provider/flacrescue/stash_relay.go) ──────── */

const CONFIG_URL = "https://stash-tipjar.rawnaldclark.workers.dev/lossless.json";
/** format_id 6 = FLAC 16/44,1 (el mismo que pide la app). */
const FORMATO_FLAC = "6";
const TTL_CONFIG_MS = 6 * 60 * 60 * 1000;
const TTL_ENLACE_MAX_MS = 45 * 60 * 1000;
const TTL_ENLACE_MIN_MS = 60 * 1000;
const MARGEN_ENLACE_MS = 5 * 60 * 1000;
const TIMEOUT_MINT_MS = 5_000;
const TIMEOUT_CONFIG_MS = 5_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type RelayStash = { bases: string[]; clave: string; tidalBase: string; tidalToken: string };
let configCache: { valor: RelayStash; expira: number } | null = null;

/**
 * Motivo del último rescate fallido (solo diagnóstico temporal). Lo anota
 * `resolverAudioInterno` en cada canal que se rinde, para leerlo desde el
 * cliente y saber exactamente por qué queda sin audio en producción.
 */
let motivoUltimoRescate: string | null = null;

export function ultimoMotivoRescate(): string | null {
  return motivoUltimoRescate;
}

function bytesAHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Un id de "instalación" estable por proceso: el relay lo usa para su cupo. */
const INSTALL = bytesAHex(crypto.getRandomValues(new Uint8Array(8)).buffer);

/**
 * HMAC-SHA256 del relay, con el MISMO contrato que `firmarStash` del backend:
 * la clave es el texto del `relay_key` (sus bytes UTF-8, no el hex decodificado)
 * y el mensaje es `<install>:<track_id>:<format_id>:<ts>`.
 */
async function firmarStash(claveTexto: string, trackId: string, formatId: string, ts: number): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(claveTexto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mensaje = new TextEncoder().encode(`${INSTALL}:${trackId}:${formatId}:${ts}`);
  return bytesAHex(await crypto.subtle.sign("HMAC", clave, mensaje));
}

let configEnVuelo: Promise<RelayStash | null> | null = null;

async function descargarConfigStash(): Promise<RelayStash | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_CONFIG_MS);
  try {
    const res = await fetch(CONFIG_URL, { signal: control.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const datos = (await res.json()) as {
      relays?: Array<{ base?: string; priority?: number }>;
      relay_key?: string;
      tidal_relay_url?: string;
      tidal_relay_token?: string;
    };
    const bases = (datos.relays ?? [])
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((r) => r.base ?? "")
      .filter((b) => b.startsWith("http"));
    const clave = typeof datos.relay_key === "string" ? datos.relay_key : "";
    const tidalBase = typeof datos.tidal_relay_url === "string" ? datos.tidal_relay_url.replace(/\/+$/, "") : "";
    const tidalToken = typeof datos.tidal_relay_token === "string" ? datos.tidal_relay_token : "";
    // El relay de Qobuz puede estar pausado (sin `relays`) mientras el de Tidal
    // sigue vivo: exigir ambos dejaría sin audio a la demo.
    if (clave.length === 0 || (bases.length === 0 && (!tidalBase || !tidalToken))) return null;
    configCache = { valor: { bases, clave, tidalBase, tidalToken }, expira: Date.now() + TTL_CONFIG_MS };
    return configCache.valor;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

async function traerConfigStash(forzar = false): Promise<RelayStash | null> {
  if (!forzar && configCache && configCache.expira > Date.now()) return configCache.valor;
  // Varias pistas a la vez comparten una sola descarga de la config.
  if (!forzar && configEnVuelo) return configEnVuelo;
  const tarea = descargarConfigStash();
  if (!forzar) {
    configEnVuelo = tarea;
    void tarea.finally(() => {
      if (configEnVuelo === tarea) configEnVuelo = null;
    });
  }
  return tarea;
}

/** Deriva el TTL del enlace de su propio `etsp` (segundos unix). */
function ttlDeEnlace(enlace: string): number {
  const m = /[?&]etsp=(\d+)/.exec(enlace);
  if (!m) return TTL_ENLACE_MIN_MS;
  const vence = Number(m[1]) * 1000;
  if (!Number.isFinite(vence)) return TTL_ENLACE_MIN_MS;
  const ttl = vence - Date.now() - MARGEN_ENLACE_MS;
  if (ttl <= 0) return 0;
  return Math.min(ttl, TTL_ENLACE_MAX_MS);
}

/**
 * El relay responde `503 {"error":"busy"}` cuando está saturado. Eso NO es
 * "no tengo esa pista": es "volvé en un momento". Distinguirlo es la diferencia
 * entre reintentar y descartar la pista sin motivo. Se reintenta con una espera
 * corta.
 */
const REINTENTOS_BUSY = 3;
const ESPERA_BUSY_MS = [400, 800, 1600];
/**
 * Techo de TODOS los intentos de mint de una pista. Reintentar vale, pero no a
 * cualquier precio: la demo no puede quedarse 20 s esperando al relay mientras
 * el usuario mira un spinner. Al agotarse, se pasa al canal de YouTube.
 */
const PRESUPUESTO_MINT_MS = 5_500;

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}

/**
 * Carrera HEDGED sobre una lista de intentos: el primero arranca ya y los
 * siguientes a los [escalonMs], así una base lenta no bloquea a una sana y el
 * proveedor no recibe N peticiones a la vez en el caso normal (el primero
 * resuelve). Devuelve el primer resultado no nulo, o null si ninguno dio nada.
 */
async function primeroQueResponda<T>(
  tareas: Array<() => Promise<T | null>>,
  escalonMs: number,
): Promise<T | null> {
  if (tareas.length === 0) return null;
  const intentos = tareas.map((tarea, i) =>
    dormir(i * escalonMs).then(async () => {
      const valor = await tarea();
      if (valor == null) throw new Error("sin resultado");
      return valor;
    }),
  );
  try {
    return await Promise.any(intentos);
  } catch {
    return null;
  }
}

/** Espera del reintento: la del encabezado si el relay la manda, si no la fija. */
function esperaDeBusy(res: Response, intento: number): number {
  const cabecera = Number(res.headers.get("retry-after") ?? 0);
  if (Number.isFinite(cabecera) && cabecera > 0) return Math.min(cabecera * 1000, 4000);
  return ESPERA_BUSY_MS[Math.min(intento, ESPERA_BUSY_MS.length - 1)];
}

type Mint = { url: string; bitDepth: number; sampleRate: number; ttl: number };

async function mintearEn(
  base: string,
  clave: string,
  trackId: string,
  limite: number,
  senal?: AbortSignal,
): Promise<Mint | null> {
  const url = `${base}/v1/qobuz/file?track_id=${encodeURIComponent(trackId)}&format_id=${FORMATO_FLAC}`;

  for (let intento = 0; intento <= REINTENTOS_BUSY; intento++) {
    if (senal?.aborted || Date.now() >= limite) return null;
    const ts = Math.floor(Date.now() / 1000);
    const firma = await firmarStash(clave, trackId, FORMATO_FLAC, ts);
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), Math.min(TIMEOUT_MINT_MS, Math.max(1000, limite - Date.now())));
    const alCancelar = () => control.abort();
    senal?.addEventListener("abort", alCancelar, { once: true });
    try {
      const res = await fetch(url, {
        signal: control.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "X-Stash-Version": "1",
          "X-Stash-Install": INSTALL,
          "X-Stash-Ts": String(ts),
          "X-Stash-Auth": firma,
          // "stream" (no "download"): el relay pacea las descargas y esto es una
          // reproducción, igual que hace la app en el camino de streaming.
          "X-Stash-Purpose": "stream",
        },
      });
      // 502/504 también son transitorios (misma política que monochrome).
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        const espera = esperaDeBusy(res, intento);
        if (intento < REINTENTOS_BUSY && Date.now() + espera < limite) {
          await dormir(espera);
          continue;
        }
        console.warn(`[stash] track ${trackId} ocupado: ${res.status} tras ${intento + 1} intentos`);
        return null;
      }
      if (!res.ok) {
        console.warn(`[stash] track ${trackId} respondió ${res.status}`);
        return null;
      }
      const cuerpo = (await res.json()) as {
        url?: string;
        format_id?: number;
        bit_depth?: number;
        sample_rate?: number;
      };
      const audio = String(cuerpo.url ?? "");
      // Un 200 con error adentro es el peor caso del contrato: se trata como fallo
      // para no devolverle al reproductor una URL que no es.
      if (!audio.startsWith("https://")) {
        console.warn(`[stash] track ${trackId} sin URL (${Object.keys(cuerpo).join(",") || "cuerpo vacío"})`);
        return null;
      }
      if (Number(cuerpo.format_id ?? 0) < 6) {
        console.warn(`[stash] track ${trackId} formato ${cuerpo.format_id} (sin FLAC)`);
        return null;
      }
      // Sin `etsp` el reproductor no puede derivar el vencimiento.
      if (!/[?&]etsp=\d+/.test(audio)) {
        console.warn(`[stash] track ${trackId} sin etsp en la URL`);
        return null;
      }
      return {
        url: audio,
        bitDepth: Number(cuerpo.bit_depth ?? 0),
        sampleRate: Number(cuerpo.sample_rate ?? 0),
        ttl: ttlDeEnlace(audio),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(reloj);
      senal?.removeEventListener("abort", alCancelar);
    }
  }
  return null;
}

/**
 * Pide el FLAC de [trackId] probando las bases del relay con *hedged requests*:
 * la primera arranca ya y las siguientes a los 300 ms, así una base lenta no
 * bloquea a una sana. La primera que responde gana y las demás se abortan.
 */
async function mintaStash(trackId: string): Promise<Mint | null> {
  const limite = Date.now() + PRESUPUESTO_MINT_MS;
  let config = await traerConfigStash();
  if (!config || config.bases.length === 0) return null;
  for (let intento = 0; intento < 2 && config; intento++) {
    const control = new AbortController();
    const corredores = config.bases.map((base, i) =>
      dormir(i * 300).then(async () => {
        if (control.signal.aborted) throw new Error("cancelado");
        const mint = await mintearEn(base, config!.clave, trackId, limite, control.signal);
        if (!mint) throw new Error("sin mint");
        return mint;
      }),
    );
    try {
      const mint = await Promise.any(corredores);
      control.abort();
      return mint;
    } catch {
      control.abort();
    }
    if (Date.now() >= limite) return null;
    // La config puede traer una clave rotada: se recarga UNA vez.
    config = intento === 0 ? await traerConfigStash(true) : null;
  }
  return null;
}

/* ── Canal stash-tidal (Tidal relay del proyecto Stash) ──────────── */

/**
 * El relay de Tidal de Stash entrega dos caras:
 *   · `/search?q=` devuelve catálogo (id `td:…`, ISRC, duración) sin firma.
 *   · `/stream/td:<id>?aac=only` devuelve el AAC 320 PROGRESIVO (un .mp4 de
 *     Tidal) que un `<audio>` sí reproduce. El FLAC solo sale como DASH, que
 *     el navegador no puede abrir sin MSE; por eso este canal es AAC.
 *
 * El enlace es de un CDN de Tidal con token propio (`token=<unix>~…`), no del
 * relay: el navegador lo pide directo y no pasa por el Worker. Eso evita gastar
 * ancho de Cloudflare y mantiene el Range del CDN.
 */
const TIMEOUT_TIDAL_MS = 6_000;
const PRESUPUESTO_TIDAL_MS = 8_000;

function ttlDeTokenTidal(enlace: string): number {
  const m = /[?&]token=(\d+)~/.exec(enlace);
  if (!m) return 10 * 60 * 1000;
  const vence = Number(m[1]) * 1000;
  if (!Number.isFinite(vence)) return 10 * 60 * 1000;
  const ttl = vence - Date.now() - MARGEN_ENLACE_MS;
  if (ttl <= 0) return 0;
  return Math.min(ttl, TTL_ENLACE_MAX_MS);
}

/** Mismo contrato que auth.js del relay: HMAC(key, "<install>:td:<id>:<ts>"). */
async function firmarStashTidal(claveTexto: string, trackId: string, ts: number): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(claveTexto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mensaje = new TextEncoder().encode(`${INSTALL}:td:${trackId}:${ts}`);
  return bytesAHex(await crypto.subtle.sign("HMAC", clave, mensaje));
}

async function mintaStashTidal(trackId: string, limite: number): Promise<Mint | null> {
  let config = await traerConfigStash();
  if (!config || !config.tidalBase || !config.tidalToken) return null;
  const id = trackId.replace(/^td:/, "");
  if (!/^\d+$/.test(id)) return null;

  for (let intento = 0; intento <= REINTENTOS_BUSY; intento++) {
    if (Date.now() >= limite) return null;
    const url = `${config.tidalBase}/stream/td:${id}?aac=only`;
    const ts = Math.floor(Date.now() / 1000);
    const firma = await firmarStashTidal(config.clave, id, ts);
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), Math.min(TIMEOUT_TIDAL_MS, Math.max(1000, limite - Date.now())));
    try {
      const res = await fetch(url, {
        signal: control.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "X-Access-Token": config.tidalToken,
          "X-Stash-Version": "1",
          "X-Stash-Install": INSTALL,
          "X-Stash-Ts": String(ts),
          "X-Stash-Auth": firma,
          "X-Stash-Purpose": "stream",
        },
      });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        const espera = esperaDeBusy(res, intento);
        if (intento < REINTENTOS_BUSY && Date.now() + espera < limite) {
          await dormir(espera);
          continue;
        }
        return null;
      }
      // La config se cachea 6 h y la `relay_key` rota upstream: ante un 401/403
      // se recarga UNA vez y se reintenta con la clave nueva, igual que el mint
      // de Qobuz. Sin esto una rotación dejaba el canal mudo hasta el TTL.
      if (res.status === 401 || res.status === 403) {
        if (intento > 0) return null;
        config = (await traerConfigStash(true)) ?? config;
        if (!config.tidalBase || !config.tidalToken) return null;
        continue;
      }
      if (!res.ok) return null;
      const cuerpo = (await res.json()) as {
        url?: string;
        codec?: string;
        sampleRate?: number;
      };
      const audio = String(cuerpo.url ?? "");
      // `?aac=only` puede degradar a FLAC/DASH en algunas pistas: el `<audio>`
      // no lo reproduce, así que se descarta en vez de devolver un enlace mudo.
      if (!audio.startsWith("https://") || String(cuerpo.codec ?? "") !== "aac") return null;
      const ttl = ttlDeTokenTidal(audio);
      if (ttl <= 0) return null;
      return {
        url: audio,
        bitDepth: 0,
        sampleRate: Number(cuerpo.sampleRate ?? 44100) || 44100,
        ttl,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }
  return null;
}

type PistaTidal = TrackResult;

async function buscarStashTidal(p: PeticionAudio): Promise<{ pista: PistaTidal; isrc: string } | null> {
  const config = await traerConfigStash();
  if (!config || !config.tidalBase || !config.tidalToken) return null;
  const consulta = `${p.titulo} ${p.artista}`.trim();
  if (!consulta) return null;

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_TIDAL_MS);
  try {
    const res = await fetch(`${config.tidalBase}/search?q=${encodeURIComponent(consulta)}`, {
      signal: control.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "X-Access-Token": config.tidalToken,
      },
    });
    if (!res.ok) return null;
    const cuerpo = (await res.json()) as {
      tracks?: Array<{
        id?: string;
        title?: string;
        artist?: string;
        album?: string;
        duration?: number;
        artwork?: string;
        isrc?: string;
      }>;
    };
    const pistas: PistaTidal[] = (cuerpo.tracks ?? [])
      .map((t) => ({
        id: String(t.id ?? ""),
        title: String(t.title ?? ""),
        artist: String(t.artist ?? ""),
        album: String(t.album ?? ""),
        coverUrl: String(t.artwork ?? ""),
        durationMs: Number(t.duration ?? 0) * 1000,
        isrc: normalizarISRC(t.isrc ?? ""),
        provider: "tidal",
      }))
      .filter((t) => /^td:\d+$/.test(t.id) && t.title !== "");
    if (pistas.length === 0) return null;

    // El ISRC es exacto y manda; el resto usa el mismo matching estricto del
    // backend (título + artista + álbum + duración) para no servir un cover.
    const isrcPedido = normalizarISRC(p.isrc);
    const porIsrc = isrcPedido
      ? pistas.find((t) => t.isrc !== "" && t.isrc === isrcPedido) ?? null
      : null;
    const pista = porIsrc ?? bestOriginalAlbumDuracion(p.titulo, p.artista, p.album ?? "", p.duracionMs ?? 0, pistas);
    if (!pista) return null;
    return { pista, isrc: pista.isrc || isrcPedido };
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

async function rescatarStashTidal(
  p: PeticionAudio,
): Promise<{ url: string; duracion: number; id: string; isrc: string; sampleRate: number; ttl: number } | null> {
  const limite = Date.now() + PRESUPUESTO_TIDAL_MS;
  const match = await buscarStashTidal(p);
  if (!match) return null;
  const mint = await mintaStashTidal(match.pista.id, limite);
  if (!mint) return null;
  const duracion =
    match.pista.durationMs > 0
      ? Math.round(match.pista.durationMs / 1000)
      : p.duracionMs
        ? Math.round(p.duracionMs / 1000)
        : 0;
  return {
    url: mint.url,
    duracion,
    id: match.pista.id,
    isrc: match.isrc,
    sampleRate: mint.sampleRate,
    ttl: mint.ttl,
  };
}

/* ── Canal monochrome (provider/flacrescue/monochrome.go) ────────── */

/**
 * tracks.monochrome.st es el catálogo propio del proyecto Monochrome: expone
 * `isrc:` en la búsqueda y sirve el audio completo con Range desde su propia
 * infraestructura, sin cuenta ni captcha (según la pista: FLAC o AAC 320).
 * Una sola búsqueda por ISRC y el
 * enlace es determinista (`/track/<id>`), así que se puede cachear 30 minutos.
 *
 * Se intenta ANTES del stash-relay porque este último vive de un pool
 * compartido que responde 503 "busy" cuando está saturado, mientras que
 * monochrome no depende de credenciales de terceros. El match es EXACTO por
 * ISRC: si el catálogo no lo indexa, se sigue con stash/YouTube en vez de
 * servir otra grabación.
 */
const MONOCHROME_BASE = "https://tracks.monochrome.st";
const TIMEOUT_MONOCHROME_MS = 4_000;
const TTL_MONOCHROME_MS = 30 * 60 * 1000;
/**
 * Enfriamiento del catálogo cuando su host de pistas limita (429) o niega.
 *
 * El catálogo se buscaba MUY bien, pero el archivo vive en otro host que bajo
 * carga responde 429: el enlace "existía" y el navegador quedaba mudo con «esa
 * pista no tiene audio». Antes de entregar un enlace de monochrome se prueba
 * con un Range mínimo; si falla, se marca el canal unos minutos y el rescate
 * sigue por stash/Bandcamp/YouTube sin devolverle a nadie un enlace muerto.
 */
let monoCaidoHasta = 0;
const MONO_ENFRIAMIENTO_MS = 3 * 60 * 1000;
// 1,5 s era demasiado corto para la primera conexión del Worker con el host de
// archivos (TLS + cola): una pista buena se descartaba por lenta y la canción
// caía a un canal que tampoco respondía. 4 s es holgado sin frenar el rescate.
const TIMEOUT_SONDA_MS = 4_000;

/** ¿El host de pistas de monochrome sirve este enlace ahora? */
async function monochromeDisponible(url: string): Promise<boolean> {
  if (Date.now() < monoCaidoHasta) return false;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_SONDA_MS);
  try {
    const res = await fetch(url, {
      // 32 bytes alcanzan para ver la firma del formato y detectar el caso
      // feo: el host contesta 206 con un XML de error en vez del audio.
      headers: { Range: "bytes=0-31", "User-Agent": USER_AGENT },
      signal: control.signal,
      redirect: "follow",
    });
    if (res.ok || res.status === 206) {
      // Se lee SÓLO el primer trozo y se corta: nunca se baja la pista entera.
      const lector = res.body?.getReader();
      let cabeza = new Uint8Array(0);
      if (lector) {
        const { value } = await lector.read();
        cabeza = value ?? cabeza;
        await lector.cancel().catch(() => undefined);
      } else {
        await res.body?.cancel().catch(() => undefined);
      }
      const texto = new TextDecoder().decode(cabeza.slice(0, 64)).trim().toLowerCase();
      if (/^(<\?xml|<error|<html|\{\s*")/.test(texto)) {
        console.warn("[mono] el archivo vino como error, no como audio");
        return false;
      }
      return true;
    }
    await res.body?.cancel().catch(() => undefined);
    // 429 es un límite de la IP del Worker, no del archivo: Cloudflare comparte
    // su salida con miles de clientes, así que el catálogo ve "demasiadas
    // peticiones" aunque la pista exista. El NAVEGADOR la baja desde la IP de
    // la persona, donde no hay ese cupo. Medido en producción: descartar el
    // enlace por el 429 del Worker dejaba sin audio a Bohemian Rhapsody,
    // So What, Enter Sandman y Lose Yourself con el FLAC disponible.
    if (res.status === 429) {
      console.warn("[mono] 429 desde la IP del Worker: se entrega igual (el navegador usa otra IP)");
      return true;
    }
    if (res.status === 403 || res.status >= 500) {
      monoCaidoHasta = Date.now() + MONO_ENFRIAMIENTO_MS;
    }
    console.warn(`[mono] el archivo respondio ${res.status}`);
    return false;
  } catch (e) {
    // Timeout o red caída: se prueba otro canal, pero sin castigar el catálogo
    // (puede ser un corte puntual de ESTE isolate, no del host).
    console.warn(`[mono] la sonda del archivo fallo: ${e instanceof Error ? e.message : e}`);
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Memoria ISRC → pista del isolate. El mismo tema se pide para el clic, la
 * precarga y el siguiente de la lista; sin esto cada repetición pagaba otra
 * búsqueda de 4 s aunque el catálogo ya hubiera contestado. Es positiva y con
 * vencimiento: un "no está" nunca se recuerda.
 */
const monoMemoria = new Map<string, { mint: Mint & { id: string; isrc: string; duracion: number }; expira: number }>();
const MAX_MONO_MEMORIA = 500;

function recordarMonochrome(clave: string, mint: Mint & { id: string; isrc: string; duracion: number }): void {
  if (monoMemoria.size >= MAX_MONO_MEMORIA) {
    const primero = monoMemoria.keys().next().value;
    if (primero) monoMemoria.delete(primero);
  }
  monoMemoria.set(clave, { mint, expira: Date.now() + TTL_MONOCHROME_MS });
}

type PistaMonochrome = {
  id?: string;
  trackId?: string;
  title?: string;
  artistNames?: string[];
  duration?: number;
  isrc?: string;
  playable?: boolean;
};

function idMonochrome(p: PistaMonochrome): string {
  for (const id of [p.id, p.trackId]) {
    const limpio = String(id ?? "").trim();
    if (limpio && /^\d+$/.test(limpio)) return limpio;
  }
  return "";
}

function mintMonochrome(pista: PistaMonochrome, isrc: string): Mint & { id: string; isrc: string; duracion: number } {
  const id = idMonochrome(pista);
  return {
    url: `${MONOCHROME_BASE}/track/${id}`,
    bitDepth: 16,
    sampleRate: 44100,
    ttl: TTL_MONOCHROME_MS,
    id,
    isrc,
    duracion: Math.max(0, Math.round((pista.duration ?? 0) / 1000)),
  };
}

async function buscarMonochrome(consulta: string, ms: number): Promise<PistaMonochrome[]> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    const url = `${MONOCHROME_BASE}/search/tracks?${new URLSearchParams({ q: consulta })}`;
    const res = await fetch(url, {
      signal: control.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      // Sin este aviso, un canal bloqueado desde la IP del Worker se veía igual
      // que un catálogo que no tiene la pista.
      console.warn(`[mono] la búsqueda respondió ${res.status}`);
      return [];
    }
    const datos = (await res.json()) as { tracks?: PistaMonochrome[] };
    return (datos.tracks ?? []).filter((p) => p.playable !== false && idMonochrome(p));
  } catch (e) {
    console.warn(`[mono] la búsqueda falló: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(reloj);
  }
}

async function resolverMonochrome(
  isrc: string,
  ms = TIMEOUT_MONOCHROME_MS,
): Promise<(Mint & { id: string; isrc: string; duracion: number }) | null> {
  const clave = normalizarISRC(isrc);
  if (!clave) return null;
  const memorizado = monoMemoria.get(`isrc:${clave}`);
  if (memorizado && memorizado.expira > Date.now()) return memorizado.mint;
  const pistas = await buscarMonochrome(`isrc:${clave}`, ms);
  const pista = pistas.find((p) => normalizarISRC(p.isrc ?? "") === clave);
  if (!pista) return null;
  const mint = mintMonochrome(pista, clave);
  recordarMonochrome(`isrc:${clave}`, mint);
  return mint;
}

/**
 * Segunda pasada del catálogo: buscar por NOMBRE cuando el ISRC no está
 * indexado. El mismo tema suele existir con OTRO ISRC en el catálogo (medido:
 * "Bohemian Rhapsody" de Queen está con `GBATS0910183`, mientras Deezer publica
 * `GBUM71029604`), y antes eso terminaba en "sin audio" aunque el FLAC estuviera
 * servido por la misma infraestructura. La identidad NO se relaja: el ranking
 * estricto del backend exige título fuerte, evidencia de artista y, si se
 * conoce, duración (±25% o 20 s); si nada pasa el filtro, se sigue sin audio.
 */
async function resolverMonochromePorNombre(
  p: PeticionAudio,
  ms = TIMEOUT_MONOCHROME_MS,
): Promise<(Mint & { id: string; isrc: string; duracion: number }) | null> {
  const titulo = p.titulo.trim();
  const artista = p.artista.trim();
  if (!titulo) return null;
  const claveNombre = [
    "nombre",
    titulo.toLowerCase(),
    artista.toLowerCase(),
    (p.album ?? "").toLowerCase(),
    Math.max(0, Math.round(p.duracionMs ?? 0)),
  ].join("|");
  const memorizado = monoMemoria.get(claveNombre);
  if (memorizado && memorizado.expira > Date.now()) return memorizado.mint;

  // Dos órdenes: el buscador del catálogo NO es simétrico (medido: "Queen
  // Bohemian Rhapsody" devuelve a Queen y "Bohemian Rhapsody Queen" devuelve
  // versiones de cuna). Se consultan los dos y se juntan sin duplicar.
  const consultas = [
    `${artista} ${titulo}`.replace(/\s+/g, " ").trim(),
    `${titulo} ${artista}`.replace(/\s+/g, " ").trim(),
  ].filter((c, i, todas) => c !== "" && todas.indexOf(c) === i);
  const listas = await Promise.all(consultas.map((c) => buscarMonochrome(c, ms)));
  const pistas = new Map<string, PistaMonochrome>();
  for (const lista of listas) {
    for (const pista of lista) {
      const id = idMonochrome(pista);
      if (id && !pistas.has(id)) pistas.set(id, pista);
    }
  }
  if (pistas.size === 0) return null;

  const porId = new Map<string, PistaMonochrome>();
  const cands: TrackResult[] = [];
  for (const [id, pista] of pistas) {
    porId.set(id, pista);
    cands.push({
      id,
      title: pista.title ?? "",
      artist: (pista.artistNames ?? []).join(", "),
      album: "",
      coverUrl: "",
      durationMs: Math.max(0, Math.round(pista.duration ?? 0)),
      isrc: normalizarISRC(pista.isrc ?? ""),
      provider: "monochrome",
    });
  }
  if (cands.length === 0) return null;

  const best = bestOriginalAlbumDuracion(titulo, artista, p.album ?? "", Math.max(0, Math.round(p.duracionMs ?? 0)), cands);
  if (!best) return null;
  const pista = porId.get(best.id);
  if (!pista) return null;
  const mint = mintMonochrome(pista, best.isrc);
  recordarMonochrome(claveNombre, mint);
  return mint;
}

/* ── Canal Bandcamp (audio público de artistas de nicho) ─────────── */

/**
 * Bandcamp publica el MP3 320/128 de cada pista en su propia página, con Range
 * y sin cuenta. No es FLAC, así que va DESPUÉS de monochrome y del relay, pero
 * rescata justo lo que los catálogos grandes no tienen: sellos independientes y
 * escenas locales (medido con "Quta (capo-kullawada)" de Los Thuthanaka).
 *
 * El buscador de Bandcamp es interno y sólo contesta por POST; su resultado
 * trae nombre, banda y URL de la pista, que se verifican con el mismo ranking
 * estricto que el resto de los canales antes de bajar un solo byte.
 */
const BANDCAMP_BUSQUEDA = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";
const TIMEOUT_BANDCAMP_MS = 6_000;
const TIMEOUT_JINA_MS = 15_000;
const TTL_BANDCAMP_MS = 15 * 60 * 1000;

type ResultadoBandcamp = {
  type?: string;
  id?: number;
  band_id?: number;
  album_id?: number;
  duration?: number;
  name?: string;
  band_name?: string;
  album_name?: string;
  item_url_path?: string;
  img?: string | null;
};

type AudioBandcamp = Mint & { id: string; isrc: null; duracion: number; pista: string };

function desescaparHtml(texto: string): string {
  return texto
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

let cacheCookiesBandcamp: { valor: string; expira: number } | null = null;

/**
 * POST al buscador. Fastly contesta con un reto HTML de 3 KB (200) y una cookie
 * `_fs_ch_st_*`; repetir el POST con esa cookie devuelve el JSON. Sin el
 * handshake, las tres consultas de `resolverBandcamp` caían al `catch` y la
 * pista de nicho quedaba como "sin coincidencia".
 */
async function buscarBandcamp(consulta: string): Promise<ResultadoBandcamp[]> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  const cuerpo = JSON.stringify({ search_text: consulta, search_filter: "t", full_page: false });
  const base = {
    method: "POST",
    signal: control.signal,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: cuerpo,
  } as const;
  try {
    const guardadas =
      cacheCookiesBandcamp && cacheCookiesBandcamp.expira > Date.now()
        ? cacheCookiesBandcamp.valor
        : "";
    let res = await fetch(BANDCAMP_BUSQUEDA, {
      ...base,
      headers: guardadas ? { ...base.headers, Cookie: guardadas } : base.headers,
    });
    if (!res.ok) return [];
    let texto = await res.text();
    if (!texto.trimStart().startsWith("{")) {
      const cookies = cookiesDeRespuesta(res);
      if (!cookies) return [];
      cacheCookiesBandcamp = { valor: cookies, expira: Date.now() + 8_000 };
      res = await fetch(BANDCAMP_BUSQUEDA, {
        ...base,
        headers: { ...base.headers, Cookie: cookies },
      });
      if (!res.ok) return [];
      texto = await res.text();
    }
    const datos = JSON.parse(texto) as { auto?: { results?: ResultadoBandcamp[] } };
    return datos.auto?.results ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Pide la página de la pista a la instancia de Yattee y devuelve su MP3.
 *
 * Bandcamp está detrás del reto anti-bot de Fastly: desde Cloudflare la página
 * llega con 200 pero sin `data-tralbum` (3 KB de desafío), así que el audio es
 * inalcanzable. La instancia sí la recibe completa y expone el MP3 firmado en
 * `/api/v1/bandcamp/audio`, que es exactamente lo que devuelve cualquier
 * visitante al darle play en la web de Bandcamp.
 */
async function audioPorInstanciaBandcamp(
  url: string,
): Promise<{ url: string; duracion: number } | null> {
  const cfg = configYouTube();
  if (cfg.yattees.length === 0) return null;
  for (const base of yatteesVivas()) {
    ultimoEstadoYt = 0;
    const datos = await conCupoYattee(() =>
      pedirYattee<{ ok?: boolean; mp3?: string; duracion?: number }>(
        { yattee: base, auth: cfg.auth },
        `/api/v1/bandcamp/audio?url=${encodeURIComponent(url)}`,
        20_000,
      ),
    );
    if (datos?.ok && datos.mp3) {
      return { url: datos.mp3, duracion: Math.max(0, Math.round(datos.duracion ?? 0)) };
    }
    if (!falloYattee()) break;
  }
  return null;
}

/**
 * Cookies del primer GET. Bandcamp/Fastly contesta el HTML con un reto de 3 KB
 * y `Set-Cookie: BACKENDID3=...`; repetir la petición con esas cookies devuelve
 * la página completa. Sin este segundo paso `data-tralbum` nunca aparece y la
 * pista de nicho quedaba sin audio.
 */
function cookiesDeRespuesta(res: Response): string {
  const cabeceras = res.headers as Headers & { getSetCookie?: () => string[] };
  const crudas = cabeceras.getSetCookie?.() ?? [];
  if (crudas.length > 0) {
    return crudas.map((c) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
  }
  // Fallback para runtimes sin getSetCookie(): separa por comas que inician una
  // cookie nueva, no las de "Expires=Wed, 21 Oct...".
  const unica = res.headers.get("set-cookie") ?? "";
  return unica
    .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Une cookies por nombre, conservando el valor más nuevo. Fastly entrega el
 * reto `_fs_ch_st_*` y, en la respuesta siguiente, `BACKENDID3`; para que
 * `stream_redirect` devuelva el 302 a `t4.bcbits.com` hacen falta LAS DOS. Si
 * se guarda sólo la primera, el redirect vuelve a caer en el reto de 3 KB.
 */
function fusionarCookies(...listas: string[]): string {
  const porNombre = new Map<string, string>();
  for (const lista of listas) {
    for (const par of lista.split(";")) {
      const limpio = par.trim();
      if (!limpio) continue;
      const separador = limpio.indexOf("=");
      if (separador <= 0) continue;
      porNombre.set(limpio.slice(0, separador), limpio.slice(separador + 1));
    }
  }
  return [...porNombre].map(([nombre, valor]) => `${nombre}=${valor}`).join("; ");
}

/**
 * Pide HTML a un lector externo y reintenta una vez si contesta 429/5xx.
 * Google Translate y Jina se saturan con ráfagas de pruebas; un reintento
 * corto evita que una pista de nicho quede muda por un límite temporal.
 */
async function pedirHtmlBandcamp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  intentos = 2,
): Promise<string | null> {
  for (let intento = 0; intento < intentos; intento++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: control.signal });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) return null;
      const espera = Number(res.headers.get("retry-after")) || 0;
      await new Promise((listo) => setTimeout(listo, Math.min(1_500, Math.max(300, espera * 1_000))));
    } catch {
      // Se reintenta una vez; si el host no contesta, el siguiente canal decide.
    } finally {
      clearTimeout(reloj);
    }
  }
  return null;
}

function audioDeTralbum(html: string): { url: string; duracion: number } | null {
  const atributo = /data-tralbum="([^"]+)"/.exec(html)?.[1];
  if (!atributo) return null;
  try {
    const datos = JSON.parse(desescaparHtml(atributo)) as {
      trackinfo?: Array<{ file?: Record<string, string>; duration?: number }>;
    };
    const pista = datos.trackinfo?.[0];
    const audio = pista?.file?.["mp3-128"] ?? pista?.file?.["mp3-v0"];
    if (!audio) return null;
    return { url: desescaparHtml(audio), duracion: Math.max(0, Math.round(pista?.duration ?? 0)) };
  } catch {
    return null;
  }
}

/**
 * Lectura de la página con Jina Reader, que devuelve el HTML crudo.
 *
 * Fastly bloquea las IPs de Cloudflare y la API móvil sigue devolviendo el
 * reto aunque se reenvíen sus cookies. Jina pide la página desde otra IP y con
 * `X-Return-Format: html` entrega el HTML completo, con `data-tralbum` y la URL
 * firmada de `t4.bcbits.com`. Es el camino que funciona en producción; el
 * proxy de Google Translate queda como segundo intento porque se satura
 * (429) con facilidad.
 */
async function leerPaginaBandcampJina(
  url: string,
): Promise<{ url: string; duracion: number } | null> {
  let destino: URL;
  try {
    const original = new URL(url);
    if (!/\.bandcamp\.com$/i.test(original.hostname)) return null;
    destino = new URL(`https://r.jina.ai/${original.toString()}`);
  } catch {
    return null;
  }
  const html = await pedirHtmlBandcamp(
    destino.toString(),
    {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
      "X-Return-Format": "html",
    },
    TIMEOUT_JINA_MS,
  );
  return html ? audioDeTralbum(html) : null;
}

/**
 * Lectura de la página a través del proxy de Google Translate.
 *
 * Fastly bloquea las IPs de Cloudflare con un reto que no se resuelve con
 * cookies (probado: 6 peticiones seguidas siguen devolviendo el HTML de 3 KB).
 * Google Translate sí recibe la página completa, con `data-tralbum` y la URL
 * firmada de `t4.bcbits.com`, pero se satura con facilidad (429); por eso va
 * después de Jina.
 */
async function leerPaginaBandcampTraducida(
  url: string,
): Promise<{ url: string; duracion: number } | null> {
  let destino: URL;
  try {
    const original = new URL(url);
    if (!/\.bandcamp\.com$/i.test(original.hostname)) return null;
    original.hostname = original.hostname.replace(/\./g, "-") + ".translate.goog";
    original.searchParams.set("_x_tr_sl", "auto");
    original.searchParams.set("_x_tr_tl", "en");
    original.searchParams.set("_x_tr_hl", "en");
    destino = original;
  } catch {
    return null;
  }
  const html = await pedirHtmlBandcamp(
    destino.toString(),
    { "User-Agent": USER_AGENT, Accept: "text/html" },
    TIMEOUT_BANDCAMP_MS,
  );
  return html ? audioDeTralbum(html) : null;
}

/** Lectura directa de la página, con el handshake de cookies de Fastly. */
async function leerPaginaBandcamp(url: string): Promise<{ url: string; duracion: number } | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  try {
    const cabeceras = { "User-Agent": USER_AGENT, Accept: "text/html" };
    const res = await fetch(url, { signal: control.signal, headers: cabeceras });
    if (!res.ok) return null;

    const directo = audioDeTralbum(await res.text());
    if (directo) return directo;

    const cookies = cookiesDeRespuesta(res);
    if (!cookies) return null;
    const res2 = await fetch(url, {
      signal: control.signal,
      headers: { ...cabeceras, Cookie: cookies },
    });
    if (!res2.ok) return null;
    return audioDeTralbum(await res2.text());
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * GET JSON a Bandcamp con el mismo handshake de cookies que el buscador.
 * La API móvil (`/api/mobile/...`) entrega `streaming_url` sin pedir parsear la
 * página, que es justo lo que Fastly bloquea desde las IPs de Cloudflare.
 */
async function pedirBandcampJson<T>(url: string): Promise<T | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  const cabeceras = { "User-Agent": USER_AGENT, Accept: "application/json" };
  let cookie =
    cacheCookiesBandcamp && cacheCookiesBandcamp.expira > Date.now()
      ? cacheCookiesBandcamp.valor
      : "";
  try {
    let res = await fetch(url, {
      signal: control.signal,
      headers: cookie ? { ...cabeceras, Cookie: cookie } : cabeceras,
    });
    if (!res.ok) return null;
    let texto = await res.text();
    if (!texto.trimStart().startsWith("{")) {
      const reto = cookiesDeRespuesta(res);
      if (!reto) return null;
      cookie = fusionarCookies(cookie, reto);
      cacheCookiesBandcamp = { valor: cookie, expira: Date.now() + 8_000 };
      res = await fetch(url, {
        signal: control.signal,
        headers: { ...cabeceras, Cookie: cookie },
      });
      if (!res.ok) return null;
      texto = await res.text();
    }
    // La segunda respuesta trae `BACKENDID3`, que no viene en el reto. Sin
    // guardarlo, el `stream_redirect` posterior no pasa de Fastly.
    const nuevas = cookiesDeRespuesta(res);
    if (nuevas) {
      cookie = fusionarCookies(cookie, nuevas);
      cacheCookiesBandcamp = { valor: cookie, expira: Date.now() + 8_000 };
    }
    return JSON.parse(texto) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Sigue `bandcamp.com/stream_redirect` con el handshake de cookies hasta la URL
 * firmada de `t4.bcbits.com`, que sí responde Range sin cookies. Se devuelve esa
 * URL final; el `<audio>` del visitante nunca ve el reto de Fastly.
 */
async function resolverRedireccionBandcamp(url: string): Promise<string | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  const cabeceras = { "User-Agent": USER_AGENT, Accept: "*/*" };
  let destino = url;
  let cookie =
    cacheCookiesBandcamp && cacheCookiesBandcamp.expira > Date.now()
      ? cacheCookiesBandcamp.valor
      : "";
  try {
    for (let paso = 0; paso < 4; paso++) {
      const res = await fetch(destino, {
        signal: control.signal,
        redirect: "manual",
        headers: cookie ? { ...cabeceras, Cookie: cookie } : cabeceras,
      });
      const nuevas = cookiesDeRespuesta(res);
      if (nuevas) {
        cookie = fusionarCookies(cookie, nuevas);
        cacheCookiesBandcamp = { valor: cookie, expira: Date.now() + 8_000 };
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        destino = new URL(location, destino).toString();
        if (/\.bcbits\.com\//i.test(destino)) return destino;
        continue;
      }
      if (res.status === 200) {
        const tipo = res.headers.get("content-type") ?? "";
        if (!tipo.includes("text/html")) return destino;
        // Reto HTML: la cookie recién recibida debe abrir la pista en el
        // segundo intento; si ya la teníamos, no hay nada más que hacer.
        if (paso === 0 && nuevas) continue;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** MP3 por la API móvil de Bandcamp (sin parsear la página con reto). */
async function audioPorMovilBandcamp(
  r: ResultadoBandcamp,
): Promise<{ url: string; duracion: number } | null> {
  const bandId = Number(r.band_id ?? 0);
  const trackId = Number(r.id ?? 0);
  if (!bandId || !trackId) return null;
  const datos = await pedirBandcampJson<{
    tracks?: Array<{
      streaming_url?: Record<string, string>;
      duration?: number;
      is_streamable?: boolean;
    }>;
  }>(
    `https://bandcamp.com/api/mobile/24/tralbum_details?band_id=${bandId}&tralbum_id=${trackId}&tralbum_type=t`,
  );
  const pista = datos?.tracks?.[0];
  if (!pista || pista.is_streamable === false) return null;
  const redirect =
    pista.streaming_url?.["mp3-128"] ?? pista.streaming_url?.["mp3-v0"] ?? pista.streaming_url?.mp3;
  if (!redirect) return null;
  const url = await resolverRedireccionBandcamp(redirect);
  if (!url) return null;
  return { url, duracion: Math.max(0, Math.round(pista.duration ?? 0)) };
}

/**
 * MP3 de una pista: primero se intenta la página directa y, si Bandcamp la
 * entrega como reto anti-bot (lo normal desde el Worker), se le pide a la
 * instancia de Yattee, que sí la recibe entera.
 */
async function audioDePaginaBandcamp(url: string): Promise<{ url: string; duracion: number } | null> {
  // En escalera, no en serie: la lectura propia arranca ya y los respaldos
  // entran uno por segundo. Antes Jina podía colgar el turno hasta 30 s (dos
  // intentos de 15 s) antes de probar Translate, que quizá tenía el MP3.
  const audio = await primeroQueResponda<{ url: string; duracion: number }>(
    [
      () => leerPaginaBandcamp(url),
      () => leerPaginaBandcampJina(url),
      () => leerPaginaBandcampTraducida(url),
      () => audioPorInstanciaBandcamp(url),
    ],
    1_000,
  );
  if (audio) return audio;
  console.warn(`[bandcamp] sin audio: ni la página directa, Jina, Translate ni la instancia devolvieron MP3 (${url})`);
  return null;
}

/**
 * Identifica la pista en Bandcamp por nombre y devuelve su MP3.
 *
 * El buscador de Bandcamp es MUY bueno con el nombre del ARTISTA solo: devuelve
 * todas sus pistas publicadas, y ahí están los discos de folklore que no existen
 * en Qobuz ni en el relay (Los Thuthanaka, por ejemplo). Antes se preguntaba
 * únicamente por "artista + título" y se filtraba con el comparador estricto de
 * Qobuz —pensado para ISRC y álbumes—, así que una pista que Bandcamp sí tenía
 * quedaba como «sin coincidencia». Ahora se busca también por artista y se
 * puntúa con el mismo comparador de campos que usa YouTube (título + artista),
 * que tolera comillas tipográficas, tildes y sufijos tipo "-4" del slug.
 */
async function resolverBandcamp(p: PeticionAudio): Promise<AudioBandcamp | null> {
  const titulo = p.titulo.trim();
  const artista = p.artista.trim();
  if (!titulo) return null;

  const consultas = [`${artista} ${titulo}`, artista]
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c, i, todas) => c !== "" && todas.indexOf(c) === i);
  const listas = await Promise.all(consultas.map((c) => buscarBandcamp(c)));
  const porId = new Map<string, ResultadoBandcamp>();
  for (const lista of listas) {
    for (const r of lista) {
      if (r.type !== "t" || !r.item_url_path) continue;
      porId.set(r.item_url_path, r);
    }
  }
  if (porId.size === 0) return null;

  const objetivo = Math.max(0, Math.round((p.duracionMs ?? 0) / 1000));
  const consultaVersion = `${titulo} ${artista} ${p.album ?? ""}`.trim();
  let mejor: { url: string; nombre: string; punto: number; r: ResultadoBandcamp } | null = null;

  for (const [url, r] of porId) {
    // El título tiene que aparecer de verdad (2 = contiene o mismo orden de
    // palabras, 3 = igual). Con 1 ("solape débil") se cuela cualquier cosa.
    const puntoTitulo = fieldScore(titulo, r.name ?? "");
    if (puntoTitulo < 2) continue;
    // Bandcamp no publica versiones separadas como YouTube: el remix aparece
    // con el nombre del original dentro ("Quta ... Jersey Club Remix"). Sin
    // este veto, una búsqueda de nicho podía elegir justo el remix.
    if (!versionPedidaCompatible(consultaVersion, `${r.name ?? ""} ${r.band_name ?? ""}`)) continue;
    // Y el artista tiene que coincidir (el canal de Bandcamp ES el artista).
    const puntoArtista = artista ? fieldScore(artista, r.band_name ?? "") : 0;
    if (artista && puntoArtista === 0) continue;

    let punto = puntoTitulo * 100 + puntoArtista * 40;
    // La duración del resultado, si viene, desempata versiones y directos.
    const dur = Number((r as { duration?: number }).duration ?? 0);
    if (objetivo > 0 && dur > 0) {
      const dif = Math.abs(dur - objetivo);
      if (dif <= 5) punto += 60;
      else if (dif <= 20) punto += 30;
      else if (dif > 90) punto -= 40;
    }
    if (!mejor || punto > mejor.punto) mejor = { url, nombre: r.name ?? "", punto, r };
  }
  if (!mejor) return null;

  // La API móvil evita el HTML con reto de Fastly; la página queda como
  // respaldo y, si ambas fallan, la instancia de Yattee.
  const movil = await audioPorMovilBandcamp(mejor.r);
  const pagina = movil ?? (await audioDePaginaBandcamp(mejor.url));
  if (!pagina) return null;
  return {
    url: pagina.url,
    bitDepth: 16,
    sampleRate: 44100,
    ttl: TTL_BANDCAMP_MS,
    id: mejor.url,
    isrc: null,
    duracion: pagina.duracion || objetivo,
    pista: mejor.nombre,
  };
}

/**
 * El buscador de Bandcamp devuelve la portada sin el prefijo `a` que exige el
 * CDN (`.../img/4178418448_3.jpg` responde 404; `.../img/a4178418448_3.jpg`
 * responde 200). Si la URL ya trae el prefijo, se deja intacta.
 */
function portadaBandcamp(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/img\/(\d+_\d+\.(?:jpe?g|png|webp))$/i, "/img/a$1");
}

/**
 * Búsqueda de pistas en Bandcamp para el fallback del LISTADO. Devuelve sólo
 * tracks que comparten una palabra significativa con la consulta: el buscador
 * de Bandcamp también aproxima y no queremos cambiar un resultado desviado por
 * otro. La reproducción vuelve a verificar título/artista al resolver el audio.
 */
export async function buscarBandcampItems(consulta: string, limite = 12): Promise<Item[]> {
  const resultados = await buscarBandcamp(consulta);
  const items: Item[] = [];
  const vistos = new Set<string>();
  for (const r of resultados) {
    if (r.type !== "t" || !r.item_url_path || vistos.has(r.item_url_path)) continue;
    const item: Item = {
      id: r.item_url_path,
      tipo: "track",
      titulo: r.name ?? "",
      artista: r.band_name ?? "",
      album: r.album_name ?? "",
      caratula: portadaBandcamp(r.img),
      duracionMs: 0,
      isrc: null,
    };
    if (!item.titulo || !tocaConsulta([item], consulta)) continue;
    vistos.add(r.item_url_path);
    items.push(item);
    if (items.length >= limite) break;
  }
  return items;
}

/* ── Canal YouTube (yattee-server o backend local de yt-dlp) ─────── */

/**
 * Dos backends equivalentes, elegidos por env. La lectura es PEREZOSO a
 * propósito: en Cloudflare Pages el worker siembra `process.env` recién en el
 * primer fetch (`sembrarEnv` de `scripts/cloudflare-worker.mjs` — el polyfill
 * de process llega vacío), así que un `const` de módulo nunca vería las envs.
 *
 *   · `YATTEE_URL` + `YATTEE_AUTH` ("user:pass"): yattee-server, backend del
 *     servidor de producción (búsqueda `/api/v1/search`, extracción con
 *     `player-client=web_embedded` y stream firmado de SU relay con Range).
 *   · `YT_DLP_BACKEND_URL`: backend local de desarrollo
 *     (`scripts/backend-yt-dlp.mjs`, ruta `/resolver`).
 *
 * Sin ninguna de las dos el canal no existe: un despliegue sin backend no cambia
 * de comportamiento y las pistas que el FLAC no resuelve quedan sin audio.
 */
/**
 * Cabeceras hacia el backend propio. Si `YT_DLP_TOKEN` está definido, el backend
 * publicado exige ese secreto en `/buscar` y `/resolver`; así un backend con URL
 * pública no queda de proxy abierto para cualquiera.
 */
function cabecerasBackend(): Record<string, string> {
  const token = (process.env.YT_DLP_TOKEN ?? "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function configYouTube(): { yattee: string; yattees: string[]; auth: string; local: string } {
  // Los dos servicios Render pueden apuntar al mismo repo: si el primero está
  // dormido/caído, el segundo evita que el canal quede sin audio. Se aceptan
  // `YATTEE_URL_2`, `YATTEE_URL_3` o una lista separada por comas.
  const yattees = [
    process.env.YATTEE_URL,
    process.env.YATTEE_URL_2,
    process.env.YATTEE_URL_3,
  ]
    .flatMap((url) => (url ?? "").split(","))
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter((url, i, todas) => !!url && todas.indexOf(url) === i);

  return {
    yattee: yattees[0] ?? "",
    yattees,
    auth: process.env.YATTEE_AUTH ?? "",
    local: (process.env.YT_DLP_BACKEND_URL ?? "").replace(/\/+$/, ""),
  };
}

/**
 * Invidious como tercer canal, sin pasar por Yattee.
 *
 * Yattee ya usa Invidious para extraer cuando esta configurado, pero si su
 * base se reinicia y pierde los ajustes (Render sin disco persistente) vuelve
 * a yt-dlp y falla con 429/Deno. Este canal va directo a la API de Invidious:
 * la busqueda y los formatos no dependen de la configuracion de Yattee.
 *
 * `INVIDIOUS_URLS` acepta una lista separada por comas. Sin env se usa la
 * instancia que ya funcionaba en produccion.
 */
function configInvidious(): string[] {
  const urls = [process.env.INVIDIOUS_URLS, process.env.INVIDIOUS_URL]
    .flatMap((url) => (url ?? "").split(","))
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter((url, i, todas) => !!url && todas.indexOf(url) === i);
  return urls.length > 0 ? urls : ["https://yt.chocolatemoo53.com"];
}

/**
 * Las URLs de audio de Invidious llevan `ip=` del host que las firmó: el
 * navegador del visitante sale por otra IP y el stream puede dar 403 o HTML
 * (MEDIA_ERR_SRC_NOT_SUPPORTED). Por eso este canal NO se usa para audio por
 * defecto; queda como opt-in para instancias que proxyean el stream o para
 * pruebas desde la misma red. La búsqueda sí lo usa sin problema.
 */
function invidiousAudioDirecto(): boolean {
  return /^(1|true|si|sí)$/i.test((process.env.INVIDIOUS_AUDIO_DIRECTO ?? "").trim());
}

/** Cuarentena por base: un Render en OOM no se reintenta en cada canción. */
const YATTEE_CAIDO_MS = 60_000;
const yatteeCaidos = new Map<string, number>();

function yatteesVivas(): string[] {
  const ahora = Date.now();
  const { yattees } = configYouTube();
  const vivas = yattees.filter((base) => (yatteeCaidos.get(base) ?? 0) <= ahora);
  // Si todas están en cuarentena, se intenta igual: mejor reintentar que
  // quedarse sin canal hasta que expire el plazo.
  return vivas.length > 0 ? vivas : yattees;
}

function marcarYatteeCaido(base: string): void {
  if (base) yatteeCaidos.set(base, Date.now() + YATTEE_CAIDO_MS);
}

function marcarYatteeVivo(base: string): void {
  if (base) yatteeCaidos.delete(base);
}

// Techo GENEROSO a propósito: una búsqueda fría de yt-dlp tarda ~15-20 s
// (boot + extracción + resolución de URL) y abortar antes devuelve "sin audio"
// aunque el backend iba a resolver. Las repeticiones entran en la caché del
// backend y el segundo intento es instantáneo.
const TIMEOUT_YT_RESOLVER_MS = 30_000;

/* ── Despertar del backend propio (planes free que se apagan) ────── */

/**
 * Si el backend vive en un plan gratuito que apaga la instancia por
 * inactividad (Render, Fly free y compañía), la primera petición después del
 * apagado paga el arranque —30 a 60 s— y con el timeout de búsqueda se perdía:
 * el visitante veía "sin resultados" y el siguiente tampoco alcanzaba.
 *
 * La solución es pedirle `/salud` ANTES de lo importante: el host arranca con
 * una petición barata, y cuando el visitante toca una canción el proceso ya está
 * listo. Se recuerda que quedó despierto para no repetir el ping en cada tema.
 */
let despiertoHasta = 0;
let despertando: Promise<boolean> | null = null;
const DESPIERTO_MS = 10 * 60 * 1000;
const DESPERTAR_MS = 40_000;

/** ¿El backend local contestó hace poco? (sólo lo sabe este isolate). */
export function backendLocalDespierto(): boolean {
  return Date.now() < despiertoHasta;
}

/**
 * Despierta el backend local y devuelve si quedó despierto.
 *
 * Varias peticiones simultáneas comparten un solo ping. Si el host está
 * apagado, el ping espera hasta `esperaMs`; abortar no lo cancela —el host sigue
 * arrancando—, así que el siguiente pedido ya lo encuentra listo.
 */
export async function despertarBackendYouTube(esperaMs = DESPERTAR_MS): Promise<boolean> {
  const { local } = configYouTube();
  if (!local) return false;
  if (backendLocalDespierto()) return true;
  if (despertando) return despertando;

  despertando = (async () => {
    try {
      const res = await fetch(`${local}/salud`, {
        headers: cabecerasBackend(),
        signal: AbortSignal.timeout(esperaMs),
      });
      if (res.ok) {
        despiertoHasta = Date.now() + DESPIERTO_MS;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      despertando = null;
    }
  })();

  return despertando;
}

/* ── Despertar de Yattee (el servidor del canal YouTube) ──────────── */

/**
 * Igual que el backend propio, pero para el servidor de Yattee: si vive en un
 * plan que apaga la instancia, la primera búsqueda paga el arranque y el
 * visitante se queda sin resultados de YouTube.
 *
 * Se le pega a la raíz y NO se mira el código: cualquier respuesta HTTP —200,
 * 401, 404— significa que el proceso está arriba y atendiendo. Lo que se mide
 * es que el host conteste, no qué contesta.
 */
let yatteeDespiertoHasta = 0;
let despertandoYattee: Promise<boolean> | null = null;

export function yatteeDespierto(): boolean {
  return Date.now() < yatteeDespiertoHasta;
}

export async function despertarYattee(esperaMs = DESPERTAR_MS): Promise<boolean> {
  const { yattees, auth } = configYouTube();
  if (yattees.length === 0) return false;
  if (yatteeDespierto()) return true;
  if (despertandoYattee) return despertandoYattee;

  despertandoYattee = (async () => {
    const encabezados: Record<string, string> = { Accept: "application/json" };
    if (auth) encabezados.Authorization = `Basic ${btoa(auth)}`;
    try {
      // En paralelo: los dos Render tardan lo mismo en arrancar y no queremos
      // pagar el arranque de uno después del otro. Se resuelve en cuanto UNA
      // instancia contesta: esperar a la más lenta (hasta `esperaMs`) metía ese
      // retraso dentro del rescate aunque ya hubiera un host listo.
      const despierto = await new Promise<boolean>((listo) => {
        let faltan = yattees.length;
        let terminado = false;
        const fin = (ok: boolean) => {
          faltan--;
          if (terminado) return;
          if (ok) {
            terminado = true;
            listo(true);
            return;
          }
          if (faltan === 0) {
            terminado = true;
            listo(false);
          }
        };
        for (const base of yattees) {
          fetch(`${base}/`, { headers: encabezados, signal: AbortSignal.timeout(esperaMs) }).then(
            () => {
              // Si hubo respuesta, el host está despierto (el status no importa).
              marcarYatteeVivo(base);
              fin(true);
            },
            () => fin(false),
          );
        }
      });
      if (!despierto) return false;
      yatteeDespiertoHasta = Date.now() + DESPIERTO_MS;
      return true;
    } catch {
      return false;
    } finally {
      despertandoYattee = null;
    }
  })();

  return despertandoYattee;
}

/**
 * Despierta el canal de YouTube que esté configurado: Yattee si está, si no el
 * backend propio. Es lo que llama el despertador del sitio al abrir la demo.
 */
export async function despertarCanalYouTube(esperaMs = DESPERTAR_MS): Promise<boolean> {
  const { yattees } = configYouTube();
  if (yattees.length > 0) return despertarYattee(esperaMs);
  return despertarBackendYouTube(esperaMs);
}
const TIMEOUT_YT_BUSQUEDA_MS = 15_000;
/** El relay de yattee firma con 6 h de vida: 1 h de caché queda holgado. */
const TTL_YT_ENLACE_MS = 60 * 60 * 1000;
/** Mismo margen de duración del backend local: ±40 s sobre el catálogo. */
const MARGEN_DURACION_YT_S = 40;
const DURACION_MINIMA_YT_S = 60;
/** Canciones, no sesiones en vivo ni mixes: 20 minutos es un techo generoso. */
const DURACION_MAXIMA_YT_S = 20 * 60;

type ResultadoBusquedaYattee = {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  liveNow?: boolean;
  videoThumbnails?: Array<{ quality?: string; url?: string }>;
};

type VideoYattee = {
  videoId?: string;
  lengthSeconds?: number;
  adaptiveFormats?: Array<{ itag?: number | string; type?: string; bitrate?: number; url?: string }>;
};

/** Último estado HTTP del canal de YouTube: explica un `null` en los logs. */
let ultimoEstadoYt = 0;

/** ¿Falló la BASE (red/5xx)? Un 200 vacío no justifica probar otra instancia. */
function falloYattee(): boolean {
  return ultimoEstadoYt < 0 || ultimoEstadoYt >= 500;
}

/**
 * Cupo de extracciones simultáneas contra Yattee.
 *
 * Cada `/videos/:id` lanza yt-dlp (Python + ffmpeg) en el Render de 512 MB. Dos
 * clics a la vez ya son dos procesos; una ráfaga de visitas los multiplica y el
 * host muere por OOM ("memoria llena"). El cupo encola en vez de rechazar: el
 * audio sale igual, sólo espera su turno.
 */
function conCupoYattee<T>(tarea: () => Promise<T>): Promise<T> {
  return cupoYatteeAudioActual().ejecutar(tarea);
}

/** Las búsquedas no lanzan ffmpeg, pero tampoco pueden saturar el Render. */
function conCupoBusquedaYattee<T>(tarea: () => Promise<T>): Promise<T> {
  return cupoYatteeBusquedaActual().ejecutar(tarea);
}

/** GET JSON contra yattee con auth básica. Nunca lanza: `null` es "falló". */
async function pedirYattee<T>(
  cfg: { yattee: string; auth: string },
  ruta: string,
  ms: number,
): Promise<T | null> {
  const encabezados: Record<string, string> = { Accept: "application/json" };
  if (cfg.auth) encabezados.Authorization = `Basic ${btoa(cfg.auth)}`;
  ultimoEstadoYt = 0;

  // Un 502/504 del relay (o un corte de red) es transitorio: se reintenta una
  // vez antes de declarar que la pista no está. Los 4xx no se reintentan.
  for (let intento = 0; intento < 2; intento++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    try {
      const res = await fetch(`${cfg.yattee}${ruta}`, { signal: control.signal, headers: encabezados });
      if (res.ok) {
        marcarYatteeVivo(cfg.yattee);
        return (await res.json()) as T;
      }
      ultimoEstadoYt = res.status;
      if (res.status >= 500 && intento === 1) marcarYatteeCaido(cfg.yattee);
      if (res.status < 500 || intento === 1) return null;
    } catch (e) {
      ultimoEstadoYt = -1;
      if (intento === 1) {
        marcarYatteeCaido(cfg.yattee);
        console.warn(`[yt] ${ruta.slice(0, 60)}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    } finally {
      clearTimeout(reloj);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** Ultimo estado HTTP de Invidious directo: explica un `null` en los logs. */
let ultimoEstadoInvidious = 0;

/** Una instancia que acaba de fallar no se reintenta en cada canción. */
const invidiousCaidos = new Map<string, number>();
const INVIDIOUS_CAIDO_MS = 60_000;

function invidiousVivas(): string[] {
  const ahora = Date.now();
  const todas = configInvidious();
  const vivas = todas.filter((base) => (invidiousCaidos.get(base) ?? 0) <= ahora);
  return vivas.length > 0 ? vivas : todas;
}

function marcarInvidiousCaido(base: string): void {
  if (base) invidiousCaidos.set(base, Date.now() + INVIDIOUS_CAIDO_MS);
}

function marcarInvidiousVivo(base: string): void {
  if (base) invidiousCaidos.delete(base);
}

/** GET JSON contra Invidious, con cupo por isolate y un reintento. */
async function pedirInvidious<T>(base: string, ruta: string, ms: number): Promise<T | null> {
  return cupoInvidiousActual()
    .ejecutar(() => pedirInvidiousInterno<T>(base, ruta, ms))
    .catch(() => null);
}

/** Igual que `pedirInvidious`, pero con el cupo liviano de búsquedas. */
async function pedirInvidiousBusqueda<T>(base: string, ruta: string, ms: number): Promise<T | null> {
  return cupoInvidiousBusquedaActual()
    .ejecutar(() => pedirInvidiousInterno<T>(base, ruta, ms))
    .catch(() => null);
}

async function pedirInvidiousInterno<T>(base: string, ruta: string, ms: number): Promise<T | null> {
  ultimoEstadoInvidious = 0;
  for (let intento = 0; intento < 2; intento++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    try {
      const res = await fetch(`${base}${ruta}`, {
        signal: control.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Bitly/1.0 (+https://bitly-site.pages.dev)",
        },
      });
      if (res.ok) {
        marcarInvidiousVivo(base);
        return (await res.json()) as T;
      }
      ultimoEstadoInvidious = res.status;
      if (res.status < 500 && res.status !== 429) return null;
      if (intento === 1) {
        marcarInvidiousCaido(base);
        return null;
      }
    } catch (e) {
      ultimoEstadoInvidious = -1;
      if (intento === 1) {
        marcarInvidiousCaido(base);
        console.warn(`[yt] invidious ${base}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    } finally {
      clearTimeout(reloj);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** Convierte resultados de busqueda de YouTube a items del catalogo. */
function aItemsYoutube(resultados: ResultadoBusquedaYattee[] | null, tope: number): Item[] {
  return (Array.isArray(resultados) ? resultados : [])
    .filter((r) => {
      const dur = Number(r.lengthSeconds ?? 0);
      return !!r.videoId && dur >= DURACION_MINIMA_YT_S && dur <= DURACION_MAXIMA_YT_S;
    })
    .slice(0, tope)
    .map((r) => {
      const id = String(r.videoId ?? "");
      const miniaturas = r.videoThumbnails ?? [];
      const caratula =
        miniaturas.find((t) => t.quality === "high")?.url ??
        miniaturas[miniaturas.length - 1]?.url ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return {
        id,
        tipo: "track" as const,
        titulo: r.title ?? "",
        artista: r.author ?? "",
        album: "",
        caratula,
        duracionMs: Math.max(0, Math.round(Number(r.lengthSeconds ?? 0) * 1000)),
        isrc: null,
      };
    });
}

/** Busca candidatos directamente en la API de Invidious. */
async function buscarCandidatosInvidious(
  p: PeticionAudio,
  base: string,
): Promise<ResultadoBusquedaYattee[]> {
  const consulta = `${p.titulo} ${p.artista}`.replace(/\s+/g, " ").trim();
  if (!consulta) return [];

  const pedir = async (q: string) => {
    const resultados = await pedirInvidious<ResultadoBusquedaYattee[]>(
      base,
      `/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
      TIMEOUT_YT_BUSQUEDA_MS,
    );
    return (Array.isArray(resultados) ? resultados : []).filter((r) => !!r.videoId && !r.liveNow);
  };

  const candidatos: ResultadoBusquedaYattee[] = [];
  const vistos = new Set<string>();
  const sumar = (mas: ResultadoBusquedaYattee[]) => {
    for (const c of mas) {
      if (!vistos.has(String(c.videoId))) {
        candidatos.push(c);
        vistos.add(String(c.videoId));
      }
    }
  };
  const mejorTitulo = () =>
    candidatos.reduce((max, c) => Math.max(max, fieldScore(p.titulo, c.title ?? "")), 0);

  const limpia = consultaYouTube(p.titulo);
  const paralelas = [consulta];
  if (
    limpia &&
    limpia.toLowerCase() !== p.titulo.trim().toLowerCase() &&
    limpia.toLowerCase() !== consulta.toLowerCase()
  ) {
    paralelas.push(limpia);
  }
  const listas = await Promise.all(paralelas.map((q) => pedir(q)));
  for (const lista of listas) sumar(lista);

  if (candidatos.length === 0 || mejorTitulo() < 2) {
    if (p.titulo) sumar(await pedir(p.titulo));
  }
  return candidatos;
}

/** Resuelve el audio usando Invidious directo, sin depender de Yattee. */
async function rescatarEnInvidious(
  p: PeticionAudio,
  base: string,
): Promise<{ stream: string; duracion: number } | null> {
  const inicio = Date.now();
  const candidatos = await buscarCandidatosInvidious(p, base);
  if (candidatos.length === 0) {
    console.warn(`[yt] invidious ${base}: sin candidatos (estado ${ultimoEstadoInvidious})`);
    return null;
  }

  const objetivo = Math.max(0, Math.round((p.duracionMs ?? 0) / 1000));

  const formatoDe = (video: VideoYattee | null): { stream: string; duracion: number } | null => {
    const formatos = (video?.adaptiveFormats ?? []).filter(
      (f) => f.url && (f.type ?? "").startsWith("audio/"),
    );
    if (formatos.length === 0) return null;
    const universales = formatos.filter((f) => /mp4|m4a/.test(f.type ?? ""));
    const mejor = (universales.length ? universales : formatos)
      .slice()
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return {
      stream: new URL(String(mejor.url), base).toString(),
      duracion: Math.max(0, Math.round(Number(video?.lengthSeconds ?? 0))),
    };
  };

  const videoIdDirecto = (p.videoId ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(videoIdDirecto)) {
    const directo = await pedirInvidious<VideoYattee>(
      base,
      `/api/v1/videos/${encodeURIComponent(videoIdDirecto)}?local=true`,
      TIMEOUT_YT_RESOLVER_MS,
    );
    const elegido = formatoDe(directo);
    if (elegido) return elegido;
  }

  const filtro = new QueryFiltro(p.titulo, p.artista, p.album ?? "");
  const ordenados = candidatos
    .map((c) => ({ c, punto: puntuarCandidatoYattee(c, p, objetivo, filtro) }))
    .filter((x) => Number.isFinite(x.punto))
    .sort((a, b) => b.punto - a.punto);
  if (ordenados.length === 0) return null;

  for (const { c: elegida } of ordenados.slice(0, 5)) {
    if (TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio) < 3_000) break;
    const restante = TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio);
    const video = await pedirInvidious<VideoYattee>(
      base,
      `/api/v1/videos/${encodeURIComponent(String(elegida.videoId))}?local=true`,
      Math.max(3_000, restante),
    );
    const elegido = formatoDe(video);
    if (elegido) return elegido;
  }
  console.warn(
    `[yt] invidious ${base}: sin audio (estado ${ultimoEstadoInvidious}, ${candidatos.length} candidatos)`,
  );
  return null;
}

/**
 * Pide el audio COMPLETO a yattee: busca la pista, elige el resultado cuya
 * duración coincide (±40 s, como el backend local) y devuelve el mejor formato
 * de AUDIO de su relay firmado (`proxy=true&proxy_mode=relay`): el navegador
 * reproduce del backend con Range, nunca de googlevideo —que amarra la URL a la
 * IP que la pidió.
 */
function puntuarCandidatoYattee(
  c: ResultadoBusquedaYattee,
  p: PeticionAudio,
  objetivo: number,
  filtro: QueryFiltro,
): number {
  // YouTube devuelve el remix, el cover y el "1 hour loop" de la misma canción.
  // Antes se puntuaban todos y el audio podía resolver justo la versión que el
  // usuario NO pidió. Con el filtro de consulta, una variante no pedida queda
  // fuera; si la consulta SÍ pide "remix"/"piano", esa versión se conserva.
  if (
    !versionPedidaCompatible(
      `${p.titulo} ${p.artista} ${p.album ?? ""}`,
      `${c.title ?? ""} ${c.author ?? ""}`,
    )
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  // El título manda; el artista/canal es una señal más débil (muchos canales se
  // llaman "Canserbero - Topic" o suben la canción con otro nombre).
  let punto = filtro.scoreTitulo(c.title ?? "") * 100;
  if (p.artista) punto += filtro.scoreArtista(c.author ?? "") * 35;

  const pedidas = marcadoresDeVersion(`${p.titulo} ${p.artista} ${p.album ?? ""}`);
  if (pedidas.length > 0) {
    const tiene = marcadoresDeVersion(c.title ?? "");
    const aciertos = pedidas.filter((m) => tiene.includes(m)).length;
    punto += aciertos * 80;
    if (aciertos === 0) punto -= 200;
  }

  const dur = Number(c.lengthSeconds ?? 0);
  if (objetivo > 0 && dur > 0) {
    const dif = Math.abs(dur - objetivo);
    if (dif <= 10) punto += 90;
    else if (dif <= MARGEN_DURACION_YT_S) punto += 45;
    else if (dif <= 90) punto += 10;
    else punto -= Math.min(60, Math.round(dif / 3));
  }
  return punto;
}

/**
 * Consulta de YouTube a partir del título, sin lo que lo vuelve infructuoso.
 *
 * YouTube devuelve CERO resultados para títulos con calificativos: el tema
 * «LOS THUTHANAKA - Quta (capo-kullawada) JERSEY CLUB REMIX» no encuentra nada,
 * mientras que «Quta capo-kullawada Los Thuthanaka» devuelve once videos, uno
 * de 244 s (la duración del original). Se van los paréntesis, los @handles y
 * las palabras de versión; quedan el nombre del tema y el del artista, que es
 * lo que identifica la grabación.
 */
const RUIDO_TITULO_YT =
  /\b(remix|rework|bootleg|flip|edit|version|versión|live|vivo|official|oficial|video|audio|lyrics|letra|hd|4k|8k|prod|feat|ft|instrumental|extended|radio)\b/gi;

function consultaYouTube(titulo: string): string {
  return titulo
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/@[\w.-]+/g, " ")
    .replace(RUIDO_TITULO_YT, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function buscarCandidatosYattee(
  p: PeticionAudio,
  cfg: { yattee: string; auth: string },
): Promise<ResultadoBusquedaYattee[]> {
  const consulta = `${p.titulo} ${p.artista}`.replace(/\s+/g, " ").trim();
  if (!consulta) return [];

  const pedir = async (q: string) => {
    const resultados = await conCupoBusquedaYattee(() =>
      pedirYattee<ResultadoBusquedaYattee[]>(
        cfg,
        `/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
        TIMEOUT_YT_BUSQUEDA_MS,
      ),
    );
    return (Array.isArray(resultados) ? resultados : []).filter((r) => !!r.videoId && !r.liveNow);
  };

  const candidatos: ResultadoBusquedaYattee[] = [];
  const vistos = new Set<string>();
  const sumar = (mas: ResultadoBusquedaYattee[]) => {
    for (const c of mas) {
      if (!vistos.has(String(c.videoId))) {
        candidatos.push(c);
        vistos.add(String(c.videoId));
      }
    }
  };
  const mejorTitulo = () =>
    candidatos.reduce((max, c) => Math.max(max, fieldScore(p.titulo, c.title ?? "")), 0);

  // La consulta cruda y la limpia van EN PARALELO: antes se pagaban dos
  // búsquedas secuenciales (~3 s cada una) para el mismo título con
  // calificativos. El título solo se pide después, y sólo si hizo falta.
  const limpia = consultaYouTube(p.titulo);
  const paralelas = [consulta];
  if (
    limpia &&
    limpia.toLowerCase() !== p.titulo.trim().toLowerCase() &&
    limpia.toLowerCase() !== consulta.toLowerCase()
  ) {
    paralelas.push(limpia);
  }
  const listas = await Promise.all(paralelas.map((q) => pedir(q)));
  for (const lista of listas) sumar(lista);

  if (candidatos.length === 0) console.warn(`[yt] búsqueda sin resultados (estado ${ultimoEstadoYt})`);

  // Si el canal/artista ensució la búsqueda (re-subidos), el título solo suele
  // encontrar la grabación. Se suman sin duplicar por videoId.
  if (p.titulo && (candidatos.length === 0 || mejorTitulo() < 2)) {
    sumar(await pedir(p.titulo));
  }
  return candidatos;
}

async function rescatarEnYattee(
  p: PeticionAudio,
  cfg: { yattee: string; auth: string },
): Promise<{ stream: string; duracion: number } | null> {
  const inicio = Date.now();
  const candidatos = await buscarCandidatosYattee(p, cfg);
  if (candidatos.length === 0) return null;

  const objetivo = Math.max(0, Math.round((p.duracionMs ?? 0) / 1000));

  /** Elige el formato reproducible del video y arma el stream del relay. */
  const formatoDe = (video: VideoYattee | null): { stream: string; duracion: number } | null => {
    const formatos = (video?.adaptiveFormats ?? []).filter(
      (f) => f.url && (f.type ?? "").startsWith("audio/"),
    );
    if (formatos.length === 0) return null;
    // `audio/m4a` (AAC) lo reproducen todos los navegadores; si no está, el
    // mejor que haya (opus en webm).
    const universales = formatos.filter((f) => /mp4|m4a/.test(f.type ?? ""));
    const mejor = (universales.length ? universales : formatos)
      .slice()
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return {
      stream: new URL(String(mejor.url), cfg.yattee).toString(),
      duracion: Math.max(0, Math.round(Number(video?.lengthSeconds ?? 0))),
    };
  };

  // Camino exacto: YouTube Music ya nos dio el videoId, así que no hay que
  // buscar nada (y en folklore de nicho la búsqueda puede no encontrarlo).
  const videoIdDirecto = (p.videoId ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(videoIdDirecto)) {
    const directo = await conCupoYattee(() =>
      pedirYattee<VideoYattee>(
        cfg,
        `/api/v1/videos/${encodeURIComponent(videoIdDirecto)}?proxy=true&proxy_mode=relay`,
        TIMEOUT_YT_RESOLVER_MS,
      ),
    );
    const elegido = formatoDe(directo);
    if (elegido) return elegido;
  }

  // Sin originales disponibles no se resuelve un remix: es preferible que el
  // canal devuelva null y el llamador pruebe otra fuente antes que reproducir
  // una versión que el usuario no pidió.
  const filtro = new QueryFiltro(p.titulo, p.artista, p.album ?? "");
  const ordenados = candidatos
    .map((c) => ({ c, punto: puntuarCandidatoYattee(c, p, objetivo, filtro) }))
    .filter((x) => Number.isFinite(x.punto))
    .sort((a, b) => b.punto - a.punto);
  if (ordenados.length === 0) {
    console.warn(`[yt] «${p.titulo}» sólo tenía versiones no pedidas · ${candidatos.length} candidatos`);
    return null;
  }

  // Si el primer video no tiene formatos de audio (en vivo, age-gated o el
  // extractor falló), se prueba el siguiente: devolver null al primer intento
  // hacía que la misma canción fallara de forma intermitente.
  for (const { c: elegida } of ordenados.slice(0, 5)) {
    if (TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio) < 3_000) break;
    const video = await conCupoYattee(() => {
      const restante = TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio);
      return pedirYattee<VideoYattee>(
        cfg,
        `/api/v1/videos/${encodeURIComponent(String(elegida.videoId))}?proxy=true&proxy_mode=relay`,
        Math.max(3_000, restante),
      );
    });
    const elegido = formatoDe(video);
    if (elegido) return elegido;
    console.warn(
      `[yt] video ${elegida.videoId} sin audio (estado ${ultimoEstadoYt}, formatos ${
        (video?.adaptiveFormats ?? []).length
      })`,
    );
  }
  console.warn(`[yt] «${p.titulo}» sin audio · ${candidatos.length} candidatos · ${Date.now() - inicio}ms`);
  return null;
}

/**
 * Pide el audio COMPLETO al backend elegido. El backend local busca en YouTube
 * (`yt-dlp`, cliente `web_embedded`), elige el resultado cuya duración coincide
 * y devuelve la ruta de su PROXY (`/audio/<token>`); yattee devuelve el stream
 * firmado de su relay. En ambos casos el navegador reproduce del backend,
 * nunca de googlevideo.
 */
async function rescatarEnBackendPropio(
  p: PeticionAudio,
  YT_BACKEND_URL: string,
): Promise<{ stream: string; duracion: number } | null> {
  // Acá sí conviene esperar el arranque: es el pedido de audio y el usuario ya
  // eligió la canción, así que vale más un tema que suene en el primer intento
  // que responder rápido con "no hay audio".
  await despertarBackendYouTube();
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  const duracion = String(Math.max(0, Math.round((p.duracionMs ?? 0) / 1000)));
  const inicio = Date.now();

  // Camino exacto (igual que en yattee): si la pista vino de YouTube Music, su
  // id ES el videoId y el backend no tiene que buscarla por nombre.
  const videoIdDirecto = (p.videoId ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(videoIdDirecto)) {
    try {
      const res = await fetch(
        `${YT_BACKEND_URL}/resolver?videoId=${encodeURIComponent(videoIdDirecto)}`,
        { headers: cabecerasBackend(), signal: AbortSignal.timeout(TIMEOUT_YT_RESOLVER_MS) },
      );
      if (res.ok) {
        const cuerpo = (await res.json()) as { stream?: string; duracion?: number };
        const stream = String(cuerpo.stream ?? "");
        if (stream.startsWith("/audio/")) {
          return {
            stream: new URL(stream, YT_BACKEND_URL).toString(),
            duracion: Math.max(0, Math.round(Number(cuerpo.duracion ?? 0))),
          };
        }
      }
    } catch {
      // Se cae a la búsqueda por título, que es el camino de siempre.
    }
  }

  // Segundo intento sin artista: en re-subidos el "artista" del catálogo es el
  // canal ("Canserbero - Topic") y ensucia la búsqueda de yt-dlp.
  const intentos = artista ? [{ titulo, artista }, { titulo, artista: "" }] : [{ titulo, artista: "" }];
  for (const intento of intentos) {
    const consulta = new URLSearchParams({ ...intento, duracion });
    const restante = TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio);
    if (restante < 3_000) return null;
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), restante);
    try {
      const res = await fetch(`${YT_BACKEND_URL}/resolver?${consulta}`, {
        headers: cabecerasBackend(),
        signal: control.signal,
      });
      if (res.ok) {
        const cuerpo = (await res.json()) as { stream?: string; duracion?: number };
        const stream = String(cuerpo.stream ?? "");
        if (stream.startsWith("/audio/")) {
          return {
            stream: new URL(stream, YT_BACKEND_URL).toString(),
            duracion: Math.max(0, Math.round(Number(cuerpo.duracion ?? 0))),
          };
        }
      }
    } catch {
      // Se prueba la variante siguiente.
    } finally {
      clearTimeout(reloj);
    }
  }
  return null;
}

/**
 * Pide el audio al canal de YouTube.
 *
 * Orden pensado para aguantar muchas visitas:
 *   1. Backend local, sólo en desarrollo.
 *   2. Yattee (relay firmado). Es el único canal de audio de YouTube que
 *      funciona para cualquier visitante: el relay descarga con SU IP y el
 *      navegador recibe un stream del propio Yattee.
 *   3. Invidious directo, sólo si `INVIDIOUS_AUDIO_DIRECTO=1`. Sus URLs
 *      `videoplayback` quedan firmadas con la IP del worker y el navegador
 *      suele recibir 403/HTML.
 *
 * Cada base está en cuarentena tras un fallo de red/5xx para no castigar al
 * mismo host con cada canción. Los semáforos impiden que una ráfaga lance
 * decenas de extracciones a la vez.
 */
async function rescatarYouTube(p: PeticionAudio): Promise<{ stream: string; duracion: number } | null> {
  const cfg = configYouTube();
  console.warn(`[yt] rescatarYouTube local=${!!cfg.local} yattees=${cfg.yattees.length}`);
  if (cfg.local) {
    const propio = await rescatarEnBackendPropio(p, cfg.local).catch(() => null);
    if (propio) return propio;
  }

  if (cfg.yattees.length > 0) {
    // Gracia corta: el despertador del sitio (demoDespertar) ya le da 40 s al
    // arranque desde que se abre la demo. Si el audio entrara a esperar otro
    // arranque completo, el rescate se iría a 70-90 s y el visitante vería
    // "no hay audio" justo cuando el backend terminaba de despertar. Con 6 s,
    // el primer clic falla rápido y el reintento del cliente encuentra la
    // instancia ya despierta.
    await despertarYattee(6_000).catch(() => false);
    for (const base of yatteesVivas()) {
      ultimoEstadoYt = 0;
      try {
        const resuelto = await rescatarEnYattee(p, { yattee: base, auth: cfg.auth });
        if (resuelto) return resuelto;
      } catch {
        // Si esta base está saturada, se prueba la siguiente o se devuelve null.
      }
      // Si la base contestó bien (200) pero no tenía la pista, la otra instancia
      // del mismo repo tampoco la va a tener: no se paga otro timeout.
      if (!falloYattee()) break;
    }
  }

  if (invidiousAudioDirecto()) {
    for (const base of invidiousVivas()) {
      try {
        const resuelto = await rescatarEnInvidious(p, base);
        if (resuelto) return resuelto;
      } catch {
        // Una base ocupada/caída no cancela el resto del rescate.
      }
    }
  }
  return null;
}

/**
 * Cuando ni la extensión ni el respaldo de Deezer tienen la canción (folklore
 * de nicho, re-subidos), el backend la busca en YouTube. Los resultados no
 * traen ISRC, pero el rescate de audio igual funciona: el MISMO backend
 * resuelve la pista por título+artista cuando se la piden.
 */
export async function buscarYouTubeBackend(consulta: string, limite: number): Promise<Item[] | null> {
  const cfg = configYouTube();
  console.warn(`[yt] buscarYouTubeBackend local=${!!cfg.local} yattees=${cfg.yattees.length}`);
  const tope = Math.max(1, Math.min(24, limite));

  // Invidious directo primero: es una sola petición HTTP, no despierta ni
  // encola extracciones en Yattee y su búsqueda ya cubre el catálogo de YouTube.
  for (const base of invidiousVivas()) {
    try {
      const resultados = await pedirInvidiousBusqueda<ResultadoBusquedaYattee[]>(
        base,
        `/api/v1/search?q=${encodeURIComponent(consulta)}&type=video`,
        TIMEOUT_YT_BUSQUEDA_MS,
      );
      const encontrados = aItemsYoutube(resultados, tope);
      if (encontrados.length > 0) return encontrados;
    } catch {
      // Base saturada/caída: se prueba la siguiente o se cae a Yattee.
    }
  }

  if (cfg.yattees.length > 0) {
    // Gracia corta: si el servidor de Yattee está dormido, el ping lo despierta
    // sin hacer esperar la búsqueda entera (el catálogo contesta igual).
    await despertarYattee(6_000).catch(() => false);
    for (const base of yatteesVivas()) {
      ultimoEstadoYt = 0;
      try {
        const resultados = await conCupoBusquedaYattee(() =>
          pedirYattee<ResultadoBusquedaYattee[]>(
            { yattee: base, auth: cfg.auth },
            `/api/v1/search?q=${encodeURIComponent(consulta)}&type=video`,
            TIMEOUT_YT_BUSQUEDA_MS,
          ),
        );
        const encontrados = aItemsYoutube(resultados, tope);
        // Yattee no encontró nada (o no contestó): si hay backend propio, se
        // prueba ahí. Es justo el caso del folklore que el índice no cubre.
        if (encontrados.length > 0) return encontrados;
      } catch {
        // Saturado: no se bloquea la búsqueda entera.
      }
      if (!falloYattee()) break;
    }
  }

  if (!cfg.local) return null;
  // Antes de buscar se le da un margen corto al arranque: si el host está
  // despierto contesta al instante, y si está apagado se dispara el ping sin
  // hacer esperar la búsqueda entera.
  await despertarBackendYouTube(6_000);
  const YT_BACKEND_URL = cfg.local;
  const qs = new URLSearchParams({ consulta, limite: String(tope) });
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_YT_BUSQUEDA_MS);
  try {
    const res = await fetch(`${YT_BACKEND_URL}/buscar?${qs}`, {
      headers: cabecerasBackend(),
      signal: control.signal,
    });
    if (!res.ok) {
      console.warn(`[yt] /buscar local status ${res.status}`);
      return null;
    }
    const cuerpo = (await res.json()) as { items?: Item[] };
    return Array.isArray(cuerpo.items) ? cuerpo.items : null;
  } catch (e) {
    console.warn(`[yt] /buscar local: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/* ── Catálogo (qobuz-web) ────────────────────────────────────────── */

/** Sesión del sandbox del catálogo: no pertenece a ninguna pestaña. */
const SESION_CATALOGO = "catalogo-rescate";

function aTrackResult(i: Item): TrackResult {
  return {
    id: i.id,
    title: i.titulo,
    artist: i.artista,
    album: i.album,
    coverUrl: i.caratula ?? "",
    durationMs: i.duracionMs,
    isrc: i.isrc ?? "",
    provider: "qobuz-web",
  };
}

/**
 * Cuarentena del contrato por ISRC: si el canal FALLA, no se vuelve a pagar su
 * ronda de red en cada reproducción. Es la misma idea que la cuarentena de
 * bases del canal en el backend: un canal caído no se consulta en cada canción
 * mientras siga caído.
 *
 * Ojo con qué arma la cuarentena: solo la excepción (canal caído, timeout, geo
 * bloqueo). Un "no está" (`available: false`) es una respuesta VÁLIDA y no dice
 * nada del ISRC de la siguiente canción; tratarla como fallo dejaba 10 minutos
 * sin verificar NINGÚN ISRC tras la primera pista que el catálogo no indexaba.
 */
let isrcEnCuarentenaHasta = 0;
const CUARENTENA_ISRC_MS = 10 * 60 * 1000;

/**
 * Id de la pista de Qobuz verificada por ISRC (contrato `checkAvailability`).
 *
 * Dos intentos, del más exacto al más flexible:
 *
 *   1. POR ISRC SOLO. Qobuz indexa el ISRC como consulta y devuelve la pista
 *      exacta en ~1 s, sin depender de que el título coincida.
 *   2. POR NOMBRE. Solo si el ISRC no está indexado. Se manda el título SIN los
 *      créditos entre paréntesis: `Get Lucky (feat. Pharrell Williams and Nile
 *      Rodgers)` hacía fallar `checkAvailability` —su `titlesMatch` no perdona
 *      el paréntesis— mientras que `Get Lucky` lo resolvía al instante. El ISRC
 *      sigue viajando en la llamada, así que la verificación sigue siendo exacta.
 */
async function idVerificadoPorISRC(p: PeticionAudio, isrc: string): Promise<string | null> {
  if (Date.now() < isrcEnCuarentenaHasta) return null;

  const pedirId = async (args: unknown[]): Promise<string | null> => {
    const r = await llamarExtension<{ available?: boolean; track_id?: string }>({
      sesion: SESION_CATALOGO,
      ext: "qobuz-web",
      metodo: "checkAvailability",
      args,
    });
    const id = String(r?.track_id ?? "").trim();
    return r?.available && id ? id : null;
  };

  try {
    const exacto = await pedirId([isrc, "", "", { duration_ms: 0 }]);
    if (exacto) return exacto;

    const sinCreditos = sinCreditosParenteticos(p.titulo).trim() || p.titulo;
    return await pedirId([
      isrc,
      sinCreditos,
      p.artista,
      { duration_ms: Math.max(0, Math.round(p.duracionMs ?? 0)) },
    ]);
  } catch {
    isrcEnCuarentenaHasta = Date.now() + CUARENTENA_ISRC_MS;
    return null;
  }
}

/**
 * Identidad por el ISRC que publica el catálogo de respaldo.
 *
 * Es el puente entre fuentes: una pista que llegó de Spotify, TIDAL, Amazon o
 * YouTube no trae ISRC (o trae uno inferido), y por eso no tenía con qué pedir
 * el FLAC. Se le pide el ISRC a Deezer —autoritativo— con el matching estricto
 * y con ESE código se resuelve la pista de Qobuz. Así las 8 fuentes terminan
 * matcheando por el mismo identificador, no solo las que lo publican.
 */
async function idPorISRCDeRespaldo(
  p: PeticionAudio,
): Promise<{ id: string; isrc: string } | null> {
  const isrc = await isrcDeRespaldo({
    titulo: p.titulo,
    artista: p.artista,
    album: p.album ?? "",
    duracionMs: p.duracionMs ?? 0,
  });
  if (!isrc) return null;
  const id = await idVerificadoPorISRC(p, isrc);
  return id ? { id, isrc } : null;
}

/** Id de la pista de Qobuz elegida por NOMBRE, con el ranking del backend. */
async function idPorNombre(p: PeticionAudio, isrcConfiable: string | null): Promise<{ id: string; duracionMs: number; isrc: string } | null> {
  const consulta = `${p.titulo} ${p.artista}`.trim();
  if (!consulta) return null;
  let items: Item[];
  try {
    items = await buscarEnExtension({
      sesion: SESION_CATALOGO,
      ext: "qobuz-web",
      consulta,
      filtro: null,
      limite: 10,
    });
  } catch {
    return null;
  }
  if (items.length === 0) return null;

  let cands = items.filter((i) => i.tipo === "track" && i.id !== "").map(aTrackResult);
  if (isrcConfiable) cands = preferirISRC(isrcConfiable, cands);
  const best = bestOriginalAlbumDuracion(
    p.titulo,
    p.artista,
    p.album ?? "",
    Math.max(0, Math.round(p.duracionMs ?? 0)),
    cands,
  );
  if (!best) return null;
  // CONFIRMACIÓN de identidad: si el ISRC del pedido es confiable y el candidato
  // declara OTRO, no es la misma grabación (el catálogo renombró o el ranking
  // eligió un parecido). Se comparan plegados (sin guiones ni espacios), porque
  // el mismo código llega escrito de formas distintas según la fuente. Un
  // candidato sin ISRC sigue valiendo: SoundCloud y YouTube no lo publican y
  // rechazarlos dejaría canciones sin audio.
  const declarado = normalizarISRC(best.isrc);
  if (isrcConfiable && declarado && declarado !== normalizarISRC(isrcConfiable)) return null;
  return { id: best.id, duracionMs: best.durationMs, isrc: declarado };
}

/* ── Catálogo público de Qobuz (api.json/0.2) ────────────────────── */

/**
 * El mismo catálogo que usa el backend Go (`qobuzAPIBaseURL` + `app_id`
 * público), pedido DIRECTO a Qobuz en vez de pasar por la extensión.
 *
 * `qobuz-web` consulta un espejo (`api.zarz.moe`) y cuando ese espejo falla —
 * 502/500 en `qbz` y `qbz2`, que se caen y vuelven— `idVerificadoPorISRC` y
 * `idPorNombre` devuelven `null`, NO queda ningún candidato y el rescate entero
 * cae al canal de YouTube: esta ruta no tiene espejo de por medio, contesta con
 * el ISRC de cada pista (así la verificación sigue siendo exacta) y además es la
 * que usa el backend.
 */
const QOBUZ_API = "https://www.qobuz.com/api.json/0.2";
const QOBUZ_APP_ID = "712109809";
const TIMEOUT_QOBUZ_MS = 8_000;

/**
 * Enfriamiento si el catálogo empieza a fallar seguido (429, 403, cortes):
 * sin esto cada reproducción pagaría el tope de timeout antes de caer al
 * siguiente canal. Tres fallos seguidos apagan la ruta un par de minutos; las
 * demás rutas (espejo y catálogo público) siguen intentando mientras tanto.
 */
const FALLAS_QOBUZ_PARA_ENFRIAR = 3;
const ENFRIAMIENTO_QOBUZ_MS = 2 * 60 * 1000;
let qobuzFallas = 0;
let qobuzEnfriaHasta = 0;

function anotarFallaQobuz() {
  qobuzFallas++;
  if (qobuzFallas < FALLAS_QOBUZ_PARA_ENFRIAR) return;
  qobuzFallas = 0;
  qobuzEnfriaHasta = Date.now() + ENFRIAMIENTO_QOBUZ_MS;
}

type PistaQobuz = {
  id: number | string;
  title?: string;
  performer?: { name?: string };
  album?: { title?: string; image?: { large?: string } };
  duration?: number;
  isrc?: string;
};

/** Búsqueda contra la API pública. Nunca lanza: un fallo es "sin resultados". */
async function qobuzApi(consulta: string, limite: number): Promise<PistaQobuz[]> {
  if (Date.now() < qobuzEnfriaHasta) return [];
  const url = `${QOBUZ_API}/track/search?query=${encodeURIComponent(consulta)}&limit=${limite}&app_id=${QOBUZ_APP_ID}`;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_QOBUZ_MS);
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      anotarFallaQobuz();
      return [];
    }
    const datos = (await res.json()) as { tracks?: { items?: PistaQobuz[] } };
    qobuzFallas = 0;
    return Array.isArray(datos?.tracks?.items) ? datos.tracks.items : [];
  } catch {
    anotarFallaQobuz();
    return [];
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Identidad contra el catálogo público, con los MISMOS dos intentos (y el mismo
 * orden) que `idVerificadoPorISRC`:
 *
 *   1. POR ISRC. Qobuz indexa el código como consulta: el resultado que lo
 *      declara es la grabación exacta, sin depender del título ni del artista.
 *   2. POR NOMBRE. Si el ISRC no está indexado (o no hay), se busca
 *      `título artista` y el ranking del backend (`bestOriginalAlbumDuracion`)
 *      elige, con la MISMA confirmación de `idPorNombre`: un candidato que
 *      declare un ISRC distinto al confiable no es la misma grabación.
 */
async function idPorCatalogoQobuz(
  p: PeticionAudio,
  isrc: string | null,
  isrcConfiable: string | null,
): Promise<{ id: string; duracionMs: number; isrc: string | null } | null> {
  if (isrc) {
    const porCodigo = await qobuzApi(isrc, 8);
    const exacta = porCodigo.find((i) => normalizarISRC(i.isrc ?? "") === isrc);
    if (exacta) {
      return {
        id: String(exacta.id),
        duracionMs: Math.max(0, Math.round(Number(exacta.duration ?? 0)) * 1000),
        isrc,
      };
    }
  }

  const consulta = `${p.titulo} ${p.artista}`.trim();
  if (!consulta) return null;
  const filas = await qobuzApi(consulta, 10);
  if (filas.length === 0) return null;

  const cands: TrackResult[] = filas
    .filter((i) => String(i.id ?? "") !== "")
    .map((i) => ({
      id: String(i.id),
      title: i.title ?? "",
      artist: i.performer?.name ?? "",
      album: i.album?.title ?? "",
      coverUrl: i.album?.image?.large ?? "",
      durationMs: Math.max(0, Math.round(Number(i.duration ?? 0)) * 1000),
      isrc: normalizarISRC(i.isrc ?? ""),
      provider: "qobuz-web",
    }));
  const ordenados = isrcConfiable ? preferirISRC(isrcConfiable, cands) : cands;
  const best = bestOriginalAlbumDuracion(
    p.titulo,
    p.artista,
    p.album ?? "",
    Math.max(0, Math.round(p.duracionMs ?? 0)),
    ordenados,
  );
  if (!best) return null;
  const declarado = normalizarISRC(best.isrc);
  if (isrcConfiable && declarado && declarado !== normalizarISRC(isrcConfiable)) return null;
  return { id: best.id, duracionMs: best.durationMs, isrc: declarado || null };
}

/**
 * Tope por ruta de identidad: una fuente colgada no puede dejar el rescate
 * esperando (el techo del runtime son 20 s y el usuario mira un spinner).
 */
const TOPE_RUTA_MS = 3_500;
/**
 * Cuánto se espera al catálogo de monochrome (y al respaldo de ISRC por Deezer)
 * ANTES de arrancar el resto de los canales.
 *
 * Era `TOPE_RUTA_MS * 2` (7 s) y bloqueaba a TODOS los canales siguientes: el
 * clic pagaba 7 s antes de que el relay intentara nada, aunque el FLAC estuviera
 * servido al toque. 2,5 s alcanza para un catálogo que responde en ~1 s; si no
 * contestó, el relay es otra infraestructura y puede tener la misma pista.
 */
const TOPE_MONO_INICIAL_MS = 2_500;
/**
 * Ventaja de monochrome en la carrera contra el relay: su catálogo no gasta
 * cupo de terceros, así que gana los empates y, si contesta dentro de esta
 * ventana, el relay ni arranca.
 */
const CORTESIA_MONO_MS = 400;
/**
 * Ventaja de monochrome/relay sobre Tidal en la carrera sin pérdida. Tidal
 * entrega AAC 320 y arranca YA, así que sin esta cortesía ganaría casi siempre
 * a monochrome (FLAC) por unos cientos de ms. Con Qobuz pausado no hay FLAC
 * de relay: la cortesía es corta para que el clic no espere de más.
 */
const CORTESIA_TIDAL_MS = 350;
const CORTESIA_TIDAL_CON_QOBUZ_MS = 1_500;
/**
 * Reloj del tramo sin pérdida (monochrome + relay). Pasado este tiempo sin
 * audio se sigue con Bandcamp y YouTube en vez de quedarse esperando: con 6 s
 * alcanza para el presupuesto del mint (5,5 s) y su sonda `etsp`.
 */
const PRESUPUESTO_SIN_PERDIDA_MS = 6_000;
/**
 * Techo del ÚLTIMO intento (YouTube) cuando ya fallaron los canales sin
 * pérdida. Sin esto, un yattee caído o despertándose dejaba al visitante
 * esperando hasta 60 s por una pista que ningún otro canal va a rescatar: cada
 * canal debe tener su propio reloj y rendirse solo.
 */
// Con el PO token provider externo, la primera extracción de un video tarda
// ~20 s (mint del token + yt-dlp + relay); con 25 s el nicho que solo existe en
// YouTube se quedaba sin audio justo cuando ya empezaba a resolverse.
const TOPE_YT_FINAL_MS = 25_000;

/** Techo del rescate entero: aunque un camino externo se cuelgue, la demo
 * devuelve rápido (con su motivo) en vez de dejar al visitante 90 s a la espera. */
const TOPE_RESCATE_MS = 45_000;

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, mal) => {
    const reloj = setTimeout(() => mal(new Error("la ruta de identidad tardó demasiado")), ms);
    p.then(
      (v) => {
        clearTimeout(reloj);
        ok(v);
      },
      (e) => {
        clearTimeout(reloj);
        mal(e);
      },
    );
  });
}

/* ── Resolución ──────────────────────────────────────────────────── */

/**
 * Resuelve el audio de una pista. Nunca lanza: `null` significa "no hay audio"
 * y la interfaz lo muestra. El orden es el de la app: identidad verificada por
 * ISRC primero, nombre después; si el FLAC no se consigue, audio completo vía
 * el backend local de YouTube; sin backend, sin audio (nunca un adelanto).
 *
 * El canal YouTube se lanza EN PARALELO con la identidad de stash: si el FLAC
 * se consigue, su promesa se descarta (y el backend queda tibio para la
 * próxima); si stash falla, el último recurso ya lleva la mayor parte de su
 * espera encima. Sin esto el clic paga identidad (~6 s) + búsqueda de YouTube
 * en SERIE, que era justo el salto de ~10 s a ~25 s en canciones sin FLAC.
 */
async function resolverAudioInterno(
  p: PeticionAudio,
  claves: string[],
  evitar: Set<string>,
): Promise<AudioResuelto | null> {
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  const album = (p.album ?? "").trim();
  const duracionMs = Math.max(0, Math.round(p.duracionMs ?? 0));
  if (!titulo && !p.isrc) {
    motivoUltimoRescate = "sin-titulo";
    return null;
  }

  // Traza de canales para poder explicar un "no hay audio" desde los logs del
  // worker. Sin esto, un fallo en producción era indistinguible de otro: sólo
  // se veía el `null`, nunca QUÉ canal había fallado ni cuánto había tardado.
  const traza: string[] = [];
  const t0 = Date.now();
  const anotar = (texto: string) => traza.push(`${texto}@${Date.now() - t0}ms`);

  // La config del relay se descarga mientras corre la identidad de la pista.
  if (!configCache || configCache.expira <= Date.now()) void traerConfigStash();

  // En paralelo desde ya (sin título el backend rechazaría igual): ver doc.
  const ytParalelo =
    titulo && !evitar.has("youtube")
      ? rescatarYouTube({ ...p, titulo, artista, album, duracionMs })
      : Promise.resolve(null);

  const isrcPedido = normalizarISRC(p.isrc);
  const bienFormado = esISRCValido(isrcPedido);
  // Solo el ISRC de un proveedor que puede dar fe de él IDENTIFICA: el de
  // YouTube/SoundCloud se infiere por parecido, así que no se usa para rechazar.
  const isrcConfiable =
    bienFormado && esProveedorAutoritativoISRC(p.ext ?? "") ? isrcPedido : null;
  // Como PISTA sirve igual aunque no sea autoritativo: si Qobuz tiene indexado
  // ese ISRC, es la misma grabación por definición (el código es único).
  const isrcPista = bienFormado ? isrcPedido : null;
  const pedido = { ...p, titulo, artista, album, duracionMs };

  // Tidal arranca YA, en paralelo con la identidad y con Monochrome. Antes
  // esperaba a que venciera el tramo sin pérdida (6 s) y recién ahí empezaba su
  // propia búsqueda (~1-2 s): con Qobuz pausado eso era tiempo muerto.
  const tidalParalelo =
    !evitar.has("stash-tidal") && titulo
      ? conTope(rescatarStashTidal(pedido), PRESUPUESTO_TIDAL_MS).catch(() => null)
      : Promise.resolve(null);

  /** Enlace del canal YouTube (completo, del propio backend), ya cacheado. */
  const devolverYouTube = (yt: { stream: string; duracion: number }): AudioResuelto => {
    const duracionYt =
      yt.duracion > 0 ? yt.duracion : duracionMs > 0 ? Math.round(duracionMs / 1000) : 0;
    const enlace: Enlace = {
      url: yt.stream,
      duracion: duracionYt,
      canal: "youtube",
      proveedor: "youtube",
      id: null,
      isrc: bienFormado ? isrcPedido : null,
      expira: Date.now() + TTL_YT_ENLACE_MS,
    };
    guardarEnlace(claves, enlace);
    return {
      url: enlace.url,
      duracion: enlace.duracion,
      canal: "youtube",
      proveedor: enlace.proveedor,
      id: null,
      isrc: enlace.isrc,
    };
  };

  type Cand = { id: string; duracionMs: number; isrc: string | null; proveedor: string };
  const porIsrc = isrcConfiable ?? isrcPista;

  // Monochrome corre en paralelo con la identidad de Qobuz: en cuanto hay un
  // ISRC (el de la pista o el que publica Deezer) se le pregunta a su catálogo.
  // Es la fuente sin pérdida más fiable cuando el relay de stash está ocupado.
  type MonoInicial = { isrc: string | null; pista: Awaited<ReturnType<typeof resolverMonochrome>> };
  const monoParalelo: Promise<MonoInicial> = evitar.has("monochrome")
    ? Promise.resolve({ isrc: null, pista: null })
    : (async () => {
        const isrc = porIsrc ?? (await isrcDeRespaldo(pedido));
        return { isrc, pista: isrc ? await resolverMonochrome(isrc) : null };
      })();

  /**
   * Identidad de una pista: TRES rutas en PARALELO, empujadas en orden de
   * precisión (ISRC exacto, luego nombre) para que el mint pruebe primero la
   * grabación exacta.
   *
    * El catálogo PÚBLICO y el espejo de la extensión llegan al mismo sitio por
    * caminos distintos: si el espejo se cae (o se cuelga), la ruta directa
    * acredita la identidad sin depender de él. Cada ruta tiene su propio tope,
    * así que una colgada no frena a las demás.
   *
   * Los resultados se juntan en vez de quedarse con el primero: si el mint del
   * primer id falla, el segundo sigue siendo un intento legítimo.
   */
  const juntarCandidatos = async (q: PeticionAudio): Promise<Cand[]> => {
    if (!q.titulo && !porIsrc) return [];

    let espejoIsrc: Promise<Cand | null>;
    if (porIsrc) {
      const exacto: string = porIsrc;
      espejoIsrc = idVerificadoPorISRC(q, exacto).then((id): Cand | null =>
        id ? { id, duracionMs, isrc: exacto, proveedor: "qobuz-web" } : null,
      );
    } else {
      // Todas las fuentes terminan matcheando por ISRC: si la pista no trae uno
      // confiable, el respaldo (Deezer) lo publica y el espejo lo verifica.
      espejoIsrc = idPorISRCDeRespaldo(q).then((r): Cand | null =>
        r ? { id: r.id, duracionMs, isrc: r.isrc, proveedor: "qobuz-web" } : null,
      );
    }

    const rutas: Array<Promise<Cand | null>> = [
      conTope(espejoIsrc, TOPE_RUTA_MS).catch(() => null),
      conTope(
        idPorCatalogoQobuz(q, porIsrc, isrcConfiable).then((r): Cand | null =>
          r
            ? {
                id: r.id,
                duracionMs: r.duracionMs || duracionMs,
                isrc: r.isrc ?? isrcConfiable,
                proveedor: "qobuz-web",
              }
            : null,
        ),
        TOPE_RUTA_MS,
      ).catch(() => null),
    ];
    if (q.titulo) {
      rutas.push(
        conTope(
          idPorNombre(q, isrcConfiable).then((r): Cand | null =>
            r
              ? { id: r.id, duracionMs: r.duracionMs, isrc: r.isrc || isrcConfiable, proveedor: "qobuz-web" }
              : null,
          ),
          TOPE_RUTA_MS,
        ).catch(() => null),
      );
    }

    const resultados = await Promise.all(rutas);
    return resultados.filter((c): c is Cand => c !== null);
  };

  const devolverMonochrome = (mono: NonNullable<Awaited<ReturnType<typeof resolverMonochrome>>>): AudioResuelto => {
    const duracion = mono.duracion > 0 ? mono.duracion : Math.round(duracionMs / 1000);
    const enlace: Enlace = {
      url: mono.url,
      duracion,
      canal: "monochrome",
      proveedor: "monochrome",
      id: mono.id,
      isrc: mono.isrc,
      expira: Date.now() + mono.ttl,
    };
    guardarEnlace(claves, enlace);
    return {
      url: enlace.url,
      duracion: enlace.duracion,
      canal: "monochrome",
      proveedor: enlace.proveedor,
      id: enlace.id,
      isrc: enlace.isrc,
      bitDepth: mono.bitDepth,
      sampleRate: mono.sampleRate,
    };
  };

  const devolverBandcamp = (bc: AudioBandcamp): AudioResuelto => {
    const enlace: Enlace = {
      url: bc.url,
      duracion: bc.duracion,
      canal: "bandcamp",
      proveedor: "bandcamp",
      id: bc.id,
      isrc: null,
      expira: Date.now() + bc.ttl,
    };
    guardarEnlace(claves, enlace);
    return {
      url: enlace.url,
      duracion: enlace.duracion,
      canal: "bandcamp",
      proveedor: enlace.proveedor,
      id: enlace.id,
      isrc: enlace.isrc,
      bitDepth: bc.bitDepth,
      sampleRate: bc.sampleRate,
    };
  };

  const candidatosPromise = juntarCandidatos(pedido);
  // El ISRC no está en el catálogo (o la fuente no trae uno): la búsqueda por
  // nombre arranca YA, en paralelo con la identidad de Qobuz. Antes esperaba a
  // que terminara `monoParalelo` (que puede incluir Deezer) y recién entonces
  // empezaba otra búsqueda de 4 s: era el tramo más largo del rescate de nicho.
  const monoNombre =
    titulo && !evitar.has("monochrome")
      ? resolverMonochromePorNombre(pedido)
      : Promise.resolve(null);

  // Bandcamp se busca con un pequeño retardo, en paralelo con el catálogo y el
  // relay: si el FLAC aparece primero, su resultado se descarta; si no (nicho),
  // ya está listo y no paga otra espera al final. El retardo evita gastar dos
  // búsquedas en el caso común, que monochrome resuelve en menos de un segundo.
  const bandcampParalelo = (async () => {
    if (!titulo || !artista || evitar.has("bandcamp")) return null;
    await new Promise((listo) => setTimeout(listo, 1_200));
    return resolverBandcamp(pedido);
  })();

  // La identidad por ISRC ya NO es una puerta delante de los demás canales: es
  // un carril más que compite desde el primer milisegundo. Antes se esperaba
  // hasta 2,5 s aquí y luego otros 4 s de sonda antes de mirar Tidal/Bandcamp.
  const monoInicialPromise = conTope(monoParalelo, TOPE_MONO_INICIAL_MS).catch(
    (): MonoInicial => ({ isrc: null, pista: null }),
  );

  // El reintento por «ARTISTA - Canción» en el TÍTULO se pliega DENTRO de la
  // identidad: así el relay y los ISRC de monochrome lo esperan una sola vez y
  // en paralelo, en vez de pagar otra ronda secuencial antes de arrancar.
  const candidatosFinalesPromise = (async (): Promise<Cand[]> => {
    let candidatos = await candidatosPromise;
    anotar(`cands=${candidatos.length}`);
    if (candidatos.length === 0) {
      const partes = splitSearchQuery(titulo);
      const artistaTitulo = partes.artist.trim();
      const tituloTitulo = partes.title.trim();
      if (artistaTitulo && tituloTitulo) {
        candidatos = await juntarCandidatos({ ...pedido, titulo: tituloTitulo, artista: artistaTitulo });
        anotar(`cands-retry=${candidatos.length}`);
      }
    }
    return candidatos;
  })().catch((): Cand[] => []);

  // Devolver el FLAC del relay con los datos del candidato que lo resolvió.
  const devolverStash = (mint: Mint, c: Cand): AudioResuelto => {
    const duracion =
      c.duracionMs > 0
        ? Math.round(c.duracionMs / 1000)
        : p.duracionMs
          ? Math.round(p.duracionMs / 1000)
          : 0;
    const enlace: Enlace = {
      url: mint.url,
      duracion,
      canal: "stash-relay",
      proveedor: c.proveedor,
      id: c.id,
      isrc: c.isrc,
      expira: Date.now() + Math.max(mint.ttl, TTL_ENLACE_MIN_MS),
    };
    guardarEnlace(claves, enlace);
    return {
      url: enlace.url,
      duracion: enlace.duracion,
      canal: "stash-relay",
      proveedor: enlace.proveedor,
      id: enlace.id,
      isrc: enlace.isrc,
      bitDepth: mint.bitDepth,
      sampleRate: mint.sampleRate,
    };
  };

  /** AAC 320 progresivo del relay de Tidal: suena en `<audio>`, no es FLAC. */
  const devolverStashTidal = (t: NonNullable<Awaited<ReturnType<typeof rescatarStashTidal>>>): AudioResuelto => {
    const enlace: Enlace = {
      url: t.url,
      duracion: t.duracion,
      canal: "stash-tidal",
      proveedor: "tidal",
      id: t.id,
      isrc: t.isrc,
      expira: Date.now() + Math.max(t.ttl, TTL_ENLACE_MIN_MS),
    };
    guardarEnlace(claves, enlace);
    return {
      url: enlace.url,
      duracion: enlace.duracion,
      canal: "stash-tidal",
      proveedor: enlace.proveedor,
      id: enlace.id,
      isrc: enlace.isrc,
      sampleRate: t.sampleRate,
    };
  };

  type Mono = NonNullable<Awaited<ReturnType<typeof resolverMonochrome>>>;
  type Tidal = NonNullable<Awaited<typeof tidalParalelo>>;
  type Ganador =
    | { canal: "monochrome"; mono: Mono }
    | { canal: "stash-relay"; mint: Mint; c: Cand }
    | { canal: "stash-tidal"; tidal: Tidal }
    | { canal: "bandcamp"; bc: AudioBandcamp }
    | { canal: "youtube"; yt: { stream: string; duracion: number } };

  // Una sonda por ganador: el carril sólo existe si el host sirve el archivo
  // AHORA, para no devolver un enlace que el navegador descubra muerto.
  const conSonda = (m: Mono | null): Promise<Mono | null> =>
    m ? monochromeDisponible(m.url).then((ok) => (ok ? m : null)) : Promise.resolve(null);

  // Todos los carriles arrancan YA, sin puertas delante. Cada uno resuelve
  // `null` si su canal no tiene la pista, así que los lentos no frenan a nadie.
  const monoIsrcLane: Promise<Ganador | null> = monoInicialPromise
    .then((mi) => conSonda(mi.pista))
    .then((m) => (m ? { canal: "monochrome" as const, mono: m } : null))
    .catch(() => null);

  const monoNombreLane: Promise<Ganador | null> = monoNombre
    .then(conSonda)
    .then((m) => (m ? { canal: "monochrome" as const, mono: m } : null))
    .catch(() => null);

  // Los ISRC que acreditaron Qobuz/Deezer, sin repetir, contra el catálogo de
  // monochrome. En PARALELO (hedged): antes era un `for` con `await` dentro, así
  // que cada ISRC sin match costaba 2,5 s antes de probar el siguiente.
  const monoCandsLane: Promise<Ganador | null> = (async () => {
    if (evitar.has("monochrome")) return null;
    const [candidatos, mi] = await Promise.all([candidatosFinalesPromise, monoInicialPromise]);
    const vistos = new Set<string>(mi.isrc ? [mi.isrc] : []);
    const tareas: Array<() => Promise<Mono | null>> = [];
    for (const c of candidatos) {
      const isrc = normalizarISRC(c.isrc ?? "");
      if (!isrc || vistos.has(isrc)) continue;
      vistos.add(isrc);
      tareas.push(() => resolverMonochrome(isrc, 2_500));
    }
    if (tareas.length === 0) return null;
    const m = await conSonda(await primeroQueResponda(tareas, 250));
    return m ? { canal: "monochrome" as const, mono: m } : null;
  })().catch(() => null);

  const relayLane: Promise<Ganador | null> = (async () => {
    if (evitar.has("stash-relay")) return null;
    const candidatos = await candidatosFinalesPromise;
    if (candidatos.length === 0) return null;
    // Cortesía: si monochrome está por resolver, no se gasta cupo del relay.
    await dormir(CORTESIA_MONO_MS);
    const r = await primeroQueResponda(
      candidatos.map((c) => () => mintaStash(c.id).then((mint) => (mint ? { mint, c } : null))),
      300,
    );
    return r ? { canal: "stash-relay" as const, mint: r.mint, c: r.c } : null;
  })().catch(() => null);

  // Tidal entrega AAC 320 progresivo (su FLAC es DASH y el navegador no lo
  // abre). Compite con una cortesía para que un FLAC que estaba por salir no
  // pierda el clic por milisegundos.
  const qobuzActivo = (configCache?.valor.bases.length ?? 0) > 0;
  const cortesiaTidal = qobuzActivo ? CORTESIA_TIDAL_CON_QOBUZ_MS : CORTESIA_TIDAL_MS;
  const tidalLane: Promise<Ganador | null> = dormir(cortesiaTidal)
    .then(() => tidalParalelo)
    .then((t) => (t ? { canal: "stash-tidal" as const, tidal: t } : null))
    .catch(() => null);

  // Tope propio: la página de Bandcamp puede demorarse, y no vale la pena
  // retener el rescate entero esperándola.
  const bandcampLane: Promise<Ganador | null> = conTope(bandcampParalelo, 20_000)
    .catch(() => null)
    .then((bc) => (bc ? { canal: "bandcamp" as const, bc } : null));

  const youtubeLane: Promise<Ganador | null> = evitar.has("youtube")
    ? Promise.resolve(null)
    : ytParalelo
        .then((yt) => (yt ? { canal: "youtube" as const, yt } : null))
        .catch(() => null);

  const devolverGanador = (ganador: Ganador): AudioResuelto => {
    motivoUltimoRescate = null;
    switch (ganador.canal) {
      case "monochrome":
        return devolverMonochrome(ganador.mono);
      case "stash-tidal":
        return devolverStashTidal(ganador.tidal);
      case "stash-relay":
        return devolverStash(ganador.mint, ganador.c);
      case "bandcamp":
        return devolverBandcamp(ganador.bc);
      case "youtube":
        return devolverYouTube(ganador.yt);
    }
  };

  // Calidad estándar (cuenta gratis o sin sesión): el visitante recibe el
  // PRIMER audio que suene, sin puertas secuenciales. Bandcamp entra con su
  // retardo de 1,2 s y YouTube corre desde el inicio; si el FLAC está, suele
  // llegar antes que todos y se lleva el clic.
  if (p.calidad === "estandar") {
    const ganador = await primeroQueResponda<Ganador>(
      [
        () => monoIsrcLane,
        () => monoNombreLane,
        () => monoCandsLane,
        () => relayLane,
        () => tidalLane,
        () => bandcampLane,
        () => youtubeLane,
      ],
      0,
    );
    if (ganador) {
      anotar(`gana=${ganador.canal}@${Date.now() - t0}ms`);
      return devolverGanador(ganador);
    }
    motivoUltimoRescate = "sin-audio";
    console.warn(`[rescate] sin audio «${titulo}» · ${traza.join(" ")} · ${Date.now() - t0}ms`);
    return null;
  }

  // Premium: primero el tramo sin pérdida con su presupuesto, medido desde el
  // inicio (antes el reloj arrancaba recién después de las puertas). Si nada
  // aparece, Bandcamp (MP3 público) y sólo al final el YouTube completo.
  const ganadorSinPerdida = await Promise.race([
    primeroQueResponda<Ganador>(
      [() => monoIsrcLane, () => monoNombreLane, () => monoCandsLane, () => relayLane, () => tidalLane],
      0,
    ),
    dormir(qobuzActivo ? PRESUPUESTO_SIN_PERDIDA_MS : 2_500).then((): Ganador | null => null),
  ]);
  if (ganadorSinPerdida) {
    anotar(`gana=${ganadorSinPerdida.canal}@${Date.now() - t0}ms`);
    return devolverGanador(ganadorSinPerdida);
  }
  motivoUltimoRescate = qobuzActivo ? "mono-stash-sin-audio" : "mono-sin-audio";
  anotar("sin pérdida agotado");

  // Sin FLAC ni relay, Bandcamp cubre el nicho con su MP3 público. Va antes de
  // YouTube porque no depende de un backend externo ni de credenciales. Tiene
  // su propio tope: el reto de Fastly desde el Worker puede demorarse.
  motivoUltimoRescate = "bandcamp-sin-audio";
  const bandcamp = await conTope(bandcampParalelo, 20_000).catch(() => null);
  if (bandcamp) {
    anotar(`gana=bandcamp@${Date.now() - t0}ms`);
    return devolverBandcamp(bandcamp);
  }
  anotar("bandcamp-sin-match");

  // Último recurso: el audio COMPLETO vía el backend local de yt-dlp. El enlace
  // es del propio backend (su proxy), se cachea una hora -el token del backend
  // ya vive menos- y si no hay backend configurado o falla, la pista queda SIN
  // audio y la interfaz lo avisa: nunca se sirve un adelanto de 30 s. La
  // petición arrancó al entrar en la función (ver `ytParalelo`), así que acá
  // solo se espera el resultado, ya avanzado.
  if (evitar.has("youtube")) {
    motivoUltimoRescate = "youtube-descartado";
    console.warn(`[rescate] sin audio «${titulo}» · ${traza.join(" ")} · youtube descartado`);
    return null;
  }
  const yt = await conTope(ytParalelo, TOPE_YT_FINAL_MS).catch(() => null);
  if (!yt) {
    motivoUltimoRescate = "youtube-sin-audio";
    anotar("youtube-sin-audio");
    console.warn(`[rescate] sin audio «${titulo}» · ${traza.join(" ")} · ${Date.now() - t0}ms`);
    return null;
  }
  return devolverGanador({ canal: "youtube", yt });
}

/* ── Salud de los canales (panel del dueño) ───────────────────────── */

/**
 * Prueba cada canal desde el Worker, no desde la computadora del dueño.
 *
 * Es la única forma de distinguir "mi red llega" de "el Worker llega":
 * monochrome, el relay, Bandcamp y Yattee se comportan distinto según la IP de
 * salida, y sin esto un canal caído se veía igual que un catálogo sin la pista.
 */
export type PruebaCanal = { canal: string; ok: boolean; ms: number; detalle: string };

export async function probarCanalesDemo(): Promise<PruebaCanal[]> {
  const pedido: PeticionAudio = {
    titulo: "Bohemian Rhapsody",
    artista: "Queen",
    album: "A Night At The Opera",
    duracionMs: 355_000,
  };

  const medir = async (canal: string, tarea: () => Promise<string>): Promise<PruebaCanal> => {
    const t = Date.now();
    try {
      const detalle = await tarea();
      return { canal, ok: true, ms: Date.now() - t, detalle };
    } catch (e) {
      return { canal, ok: false, ms: Date.now() - t, detalle: e instanceof Error ? e.message : String(e) };
    }
  };

  // El relay de Stash hoy es Tidal (Qobuz quedó retirado upstream): las dos
  // filas del panel comparten la MISMA prueba para no mostrar una verde y la
  // otra roja por dos peticiones simultáneas al mismo relay.
  let saludTidal: Promise<{ titulo: string; host: string }> | null = null;
  const comprobarTidal = () => {
    saludTidal ??= (async () => {
      const match = await buscarStashTidal(pedido);
      if (!match) throw new Error("el catálogo de Tidal no devolvió la pista");
      const mint = await mintaStashTidal(match.pista.id, Date.now() + PRESUPUESTO_TIDAL_MS);
      if (!mint) throw new Error("el relay no entregó AAC progresivo");
      return { titulo: match.pista.title, host: new URL(mint.url).host };
    })();
    return saludTidal;
  };

  return Promise.all([
    medir("monochrome", async () => {
      const lista = await buscarMonochrome("Queen Bohemian Rhapsody", 6_000);
      if (lista.length === 0) throw new Error("el catálogo no devolvió resultados");
      const pista = lista[0];
      const id = idMonochrome(pista);
      if (!id) throw new Error("resultado sin id reproducible");
      const mint = mintMonochrome(pista, normalizarISRC(pista.isrc ?? ""));
      const suena = await monochromeDisponible(mint.url);
      if (!suena) throw new Error(`el catálogo responde (${lista.length}) pero el archivo no se sirve`);
      return `${lista.length} resultados · archivo con Range OK`;
    }),
    medir("stash-relay", async () => {
      const cfg = await traerConfigStash(true);
      if (!cfg) throw new Error("no se pudo leer lossless.json");
      if (cfg.bases.length > 0) {
        return `${cfg.bases.length} relay(s) · ${cfg.bases.map((b) => new URL(b).host).join(", ")}`;
      }
      // Stash retiró los relays compartidos de Qobuz (el campo `relays` ya no
      // se lee upstream): el relay vivo del proyecto es el de Tidal.
      if (cfg.tidalBase && cfg.tidalToken) {
        const t = await comprobarTidal();
        return `Qobuz retirado por Stash · Tidal OK (${t.host})`;
      }
      throw new Error("sin relay de Qobuz ni de Tidal");
    }),
    medir("stash-tidal", async () => {
      const t = await comprobarTidal();
      return `${t.titulo} · ${t.host}`;
    }),
    medir("bandcamp", async () => {
      const bc = await resolverBandcamp(pedido);
      if (!bc) throw new Error("sin coincidencia en la búsqueda");
      return `${bc.duracion}s · ${new URL(bc.url).host}`;
    }),
    medir("youtube", async () => {
      const cfg = configYouTube();
      if (!cfg.yattee && !cfg.local) throw new Error("sin YATTEE_URL ni YT_DLP_BACKEND_URL");
      if (cfg.local) {
        const despierto = await despertarBackendYouTube(20_000);
        if (!despierto) throw new Error(`el backend local no contestó ${cfg.local}`);
        return `backend propio despierto · ${new URL(cfg.local).host}`;
      }
      const consulta = encodeURIComponent("Queen Bohemian Rhapsody");
      const lista = await pedirYattee<ResultadoBusquedaYattee[]>(
        cfg,
        `/api/v1/search?q=${consulta}&type=video`,
        12_000,
      );
      if (!lista || !Array.isArray(lista) || lista.length === 0) throw new Error("la búsqueda no devolvió nada");
      const primero = lista.find((v) => v.videoId && !v.liveNow);
      if (!primero?.videoId) throw new Error(`resultados sin videoId (${lista.length})`);
      const video = await pedirYattee<VideoYattee>(
        cfg,
        `/api/v1/videos/${encodeURIComponent(primero.videoId)}?proxy=true&proxy_mode=relay`,
        25_000,
      );
      const formatos = (video?.adaptiveFormats ?? []).filter(
        (f) => f.url && (f.type ?? "").startsWith("audio/"),
      );
      if (!video) throw new Error(`el video ${primero.videoId} no respondió`);
      if (formatos.length === 0) throw new Error(`el video ${primero.videoId} sin formatos de audio`);
      return `${lista.length} resultados · ${formatos.length} formatos de audio`;
    }),
  ]);
}

/**
 * Punto de entrada con caché positiva/negativa y *single-flight*: clics
 * simultáneos sobre la misma pista comparten una única resolución.
 */
export async function resolverAudio(p: PeticionAudio): Promise<{ audio: AudioResuelto | null; motivo: string | null }> {
  const claves = clavesDe(p);
  const evitar = new Set((Array.isArray(p.evitar) ? p.evitar : []).map((c) => String(c)));

  // Un enlace cacheado del canal que el navegador ya intentó y no abrió: no se
  // devuelve el enlace roto, se resuelve de nuevo para pedir otro canal.
  const cacheado = enlaceCacheado(claves);
  if (cacheado && !evitar.has(cacheado.canal)) {
    motivoUltimoRescate = null;
    return { audio: cacheado, motivo: null };
  }

  // Caché del borde: otro isolate ya resolvió esta pista. Es lo que evita que
  // 100 visitas sobre la misma canción paguen 100 extracciones al mismo host.
  const compartido = await leerCacheAudio(claves);
  if (compartido && !evitar.has(compartido.canal)) {
    guardarEnlace(claves, compartido);
    motivoUltimoRescate = null;
    return { audio: compartido, motivo: null };
  }

  const vueloKey = `${claves[0]}|${[...evitar].sort().join(",")}`;
  const enCurso = enVuelo.get(vueloKey);
  if (enCurso) return enCurso;

  const tarea = (async () => {
    const resuelto = await conTope(
      cupoRescateActual().ejecutar(() => resolverAudioInterno(p, claves, evitar)),
      TOPE_RESCATE_MS,
    ).catch((error) => {
      motivoUltimoRescate = esOcupado(error) ? "servidor-ocupado" : "rescate-tiempo-agotado";
      return null;
    });
    if (resuelto) {
      const enlace = enlaceCacheado(claves);
      if (enlace) await guardarCacheAudio(claves, enlace);
    }
    return { audio: resuelto, motivo: resuelto ? null : (motivoUltimoRescate ?? "rescate-tiempo-agotado") };
  })().finally(() => {
    if (enVuelo.get(vueloKey) === tarea) enVuelo.delete(vueloKey);
  });
  enVuelo.set(vueloKey, tarea);
  return tarea;
}
