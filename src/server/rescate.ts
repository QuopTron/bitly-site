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
 *        · `YATTEE_URL` (+ `YATTEE_AUTH` "user:pass"): yattee-server, el
 *          backend del servidor de producción: busca (`/api/v1/search`),
 *          extrae con `player-client=web_embedded` y devuelve un stream
 *          FIRMADO de su relay (`/proxy/relay`, con Range y vencimiento);
 *        · `YT_DLP_BACKEND_URL`: el backend local `scripts/backend-yt-dlp.mjs`.
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
  normalizarISRC,
  preferirISRC,
  sinCreditosParenteticos,
  splitSearchQuery,
  type TrackResult,
} from "@/server/matching";

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
};

export type AudioResuelto = {
  url: string;
  /** Segundos (se usa en la barra del reproductor). */
  duracion: number;
  canal: "monochrome" | "stash-relay" | "youtube";
  /** De dónde salió la identidad: "qobuz-web" o el catálogo del respaldo. */
  proveedor: string;
  /** Id de la pista en el catálogo que resolvió. */
  id: string | null;
  isrc: string | null;
  bitDepth?: number;
  sampleRate?: number;
};

/* ── Caché de enlaces ────────────────────────────────────────────── */

type Enlace = { url: string; duracion: number; canal: "monochrome" | "stash-relay" | "youtube"; proveedor: string; id: string | null; isrc: string | null; expira: number };

const enlaces = new Map<string, Enlace>();
const MAX_ENLACES = 400;
/** Single-flight: dos clics seguidos sobre la misma pista comparten la misma
 *  resolución (idea tomada de monochrome: pendingRequests por clave). No se
 *  cachean los FALLOS: un corte del relay o de YouTube es transitorio y el
 *  siguiente clic debe poder reintentar de inmediato. */
const enVuelo = new Map<string, Promise<AudioResuelto | null>>();

function claveDe(p: PeticionAudio): string {
  // La calidad entra en la clave: el enlace FLAC de un Premium no puede
  // reutilizarlo una cuenta gratis (ni al revés, que se quedaría en estándar).
  return [
    p.titulo,
    p.artista,
    p.album ?? "",
    p.duracionMs ?? 0,
    p.isrc ?? "",
    p.ext ?? "",
    p.calidad ?? "flac",
  ]
    .join("|")
    .toLowerCase();
}

/** Claves equivalentes: la exacta y, si hay ISRC, una canónica por código. */
function clavesDe(p: PeticionAudio): string[] {
  const claves = [claveDe(p)];
  const isrc = normalizarISRC(p.isrc);
  if (isrc) claves.push(`isrc:${isrc}`);
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

type RelayStash = { bases: string[]; clave: string };
let configCache: { valor: RelayStash; expira: number } | null = null;

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
    };
    const bases = (datos.relays ?? [])
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((r) => r.base ?? "")
      .filter((b) => b.startsWith("http"));
    const clave = typeof datos.relay_key === "string" ? datos.relay_key : "";
    if (bases.length === 0 || clave.length === 0) return null;
    configCache = { valor: { bases, clave }, expira: Date.now() + TTL_CONFIG_MS };
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
        return null;
      }
      if (!res.ok) return null;
      const cuerpo = (await res.json()) as {
        url?: string;
        format_id?: number;
        bit_depth?: number;
        sample_rate?: number;
      };
      const audio = String(cuerpo.url ?? "");
      // Un 200 con error adentro es el peor caso del contrato: se trata como fallo
      // para no devolverle al reproductor una URL que no es.
      if (!audio.startsWith("https://")) return null;
      if (Number(cuerpo.format_id ?? 0) < 6) return null;
      // Sin `etsp` el reproductor no puede derivar el vencimiento.
      if (!/[?&]etsp=\d+/.test(audio)) return null;
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
    if (!res.ok) return [];
    const datos = (await res.json()) as { tracks?: PistaMonochrome[] };
    return (datos.tracks ?? []).filter((p) => p.playable !== false && idMonochrome(p));
  } catch {
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
  const pistas = await buscarMonochrome(`isrc:${clave}`, ms);
  const pista = pistas.find((p) => normalizarISRC(p.isrc ?? "") === clave);
  if (!pista) return null;
  return mintMonochrome(pista, clave);
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
  return mintMonochrome(pista, best.isrc);
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

function configYouTube(): { yattee: string; auth: string; local: string } {
  return {
    yattee: (process.env.YATTEE_URL ?? "").replace(/\/+$/, ""),
    auth: process.env.YATTEE_AUTH ?? "",
    local: (process.env.YT_DLP_BACKEND_URL ?? "").replace(/\/+$/, ""),
  };
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
  const { yattee, auth } = configYouTube();
  if (!yattee) return false;
  if (yatteeDespierto()) return true;
  if (despertandoYattee) return despertandoYattee;

  despertandoYattee = (async () => {
    const encabezados: Record<string, string> = { Accept: "application/json" };
    if (auth) encabezados.Authorization = `Basic ${btoa(auth)}`;
    try {
      await fetch(`${yattee}/`, { headers: encabezados, signal: AbortSignal.timeout(esperaMs) });
      // Si hubo respuesta, el host está despierto (el status no importa).
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
  const { yattee } = configYouTube();
  if (yattee) return despertarYattee(esperaMs);
  return despertarBackendYouTube(esperaMs);
}
/**
 * Cuánto espera la calidad estándar al canal de YouTube antes de seguir por la
 * vía sin pérdida. Es corto a propósito: si el catálogo sin pérdida tiene la
 * pista, suena en ~1 s y no hay razón para hacer esperar; y si el canal de
 * YouTube está roto (los ~25 s que tarda yt-dlp en rendirse cuando el servidor
 * no puede resolver el reto JS) el usuario no paga esa espera.
 */
const TOPE_ESTANDAR_YT_MS = 4_000;
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

/** GET JSON contra yattee con auth básica. Nunca lanza: `null` es "falló". */
async function pedirYattee<T>(
  cfg: { yattee: string; auth: string },
  ruta: string,
  ms: number,
): Promise<T | null> {
  const encabezados: Record<string, string> = { Accept: "application/json" };
  if (cfg.auth) encabezados.Authorization = `Basic ${btoa(cfg.auth)}`;

  // Un 502/504 del relay (o un corte de red) es transitorio: se reintenta una
  // vez antes de declarar que la pista no está. Los 4xx no se reintentan.
  for (let intento = 0; intento < 2; intento++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ms);
    try {
      const res = await fetch(`${cfg.yattee}${ruta}`, { signal: control.signal, headers: encabezados });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500 || intento === 1) return null;
    } catch {
      if (intento === 1) return null;
    } finally {
      clearTimeout(reloj);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
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
): number {
  // El título manda: YouTube devuelve covers, en vivo y "1 hour loop" para la
  // misma búsqueda. El artista/canal es una señal más débil (muchos canales se
  // llaman "Canserbero - Topic" o suben la canción con otro nombre).
  let punto = fieldScore(p.titulo, c.title ?? "") * 100;
  if (p.artista) punto += fieldScore(p.artista, c.author ?? "") * 35;
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

async function buscarCandidatosYattee(
  p: PeticionAudio,
  cfg: { yattee: string; auth: string },
): Promise<ResultadoBusquedaYattee[]> {
  const consulta = `${p.titulo} ${p.artista}`.replace(/\s+/g, " ").trim();
  if (!consulta) return [];

  const pedir = async (q: string) => {
    const resultados = await pedirYattee<ResultadoBusquedaYattee[]>(
      cfg,
      `/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
      TIMEOUT_YT_BUSQUEDA_MS,
    );
    return (Array.isArray(resultados) ? resultados : []).filter((r) => !!r.videoId && !r.liveNow);
  };

  const candidatos = await pedir(consulta);
  const mejorTitulo = candidatos.reduce((max, c) => Math.max(max, fieldScore(p.titulo, c.title ?? "")), 0);
  // Si el canal/artista ensució la búsqueda (re-subidos), el título solo suele
  // encontrar la grabación. Se suman sin duplicar por videoId.
  if (p.titulo && (candidatos.length === 0 || mejorTitulo < 2)) {
    const alternos = await pedir(p.titulo);
    const vistos = new Set(candidatos.map((c) => c.videoId));
    for (const c of alternos) {
      if (!vistos.has(c.videoId)) {
        candidatos.push(c);
        vistos.add(c.videoId);
      }
    }
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
    const directo = await pedirYattee<VideoYattee>(
      cfg,
      `/api/v1/videos/${encodeURIComponent(videoIdDirecto)}?proxy=true&proxy_mode=relay`,
      TIMEOUT_YT_RESOLVER_MS,
    );
    const elegido = formatoDe(directo);
    if (elegido) return elegido;
  }

  const ordenados = candidatos
    .map((c) => ({ c, punto: puntuarCandidatoYattee(c, p, objetivo) }))
    .sort((a, b) => b.punto - a.punto);

  // Si el primer video no tiene formatos de audio (en vivo, age-gated o el
  // extractor falló), se prueba el siguiente: devolver null al primer intento
  // hacía que la misma canción fallara de forma intermitente.
  for (const { c: elegida } of ordenados.slice(0, 4)) {
    const restante = TIMEOUT_YT_RESOLVER_MS - (Date.now() - inicio);
    if (restante < 3_000) break;
    const video = await pedirYattee<VideoYattee>(
      cfg,
      `/api/v1/videos/${encodeURIComponent(String(elegida.videoId))}?proxy=true&proxy_mode=relay`,
      restante,
    );
    const elegido = formatoDe(video);
    if (elegido) return elegido;
  }
  return null;
}

/**
 * Pide el audio COMPLETO al backend elegido. El backend local busca en YouTube
 * (`yt-dlp`, cliente `web_embedded`), elige el resultado cuya duración coincide
 * y devuelve la ruta de su PROXY (`/audio/<token>`); yattee devuelve el stream
 * firmado de su relay. En ambos casos el navegador reproduce del backend,
 * nunca de googlevideo.
 */
async function rescatarYouTube(p: PeticionAudio): Promise<{ stream: string; duracion: number } | null> {
  const cfg = configYouTube();
  if (cfg.yattee) {
    // Acá se espera el arranque completo: el visitante ya eligió la canción.
    await despertarYattee();
    return rescatarEnYattee(p, cfg);
  }
  if (!cfg.local) return null;
  // Acá sí conviene esperar el arranque: es el pedido de audio y el usuario ya
  // eligió la canción, así que vale más un tema que suene en el primer intento
  // que responder rápido con "no hay audio".
  await despertarBackendYouTube();
  const YT_BACKEND_URL = cfg.local;
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
 * Cuando ni la extensión ni el respaldo de Deezer tienen la canción (folklore
 * de nicho, re-subidos), el backend la busca en YouTube. Los resultados no
 * traen ISRC, pero el rescate de audio igual funciona: el MISMO backend
 * resuelve la pista por título+artista cuando se la piden.
 */
export async function buscarYouTubeBackend(consulta: string, limite: number): Promise<Item[] | null> {
  const cfg = configYouTube();
  const tope = Math.max(1, Math.min(24, limite));

  if (cfg.yattee) {
    // Gracia corta: si el servidor de Yattee está dormido, el ping lo despierta
    // sin hacer esperar la búsqueda entera (el catálogo contesta igual).
    await despertarYattee(6_000);
    const resultados = await pedirYattee<ResultadoBusquedaYattee[]>(
      cfg,
      `/api/v1/search?q=${encodeURIComponent(consulta)}&type=video`,
      TIMEOUT_YT_BUSQUEDA_MS,
    );
    if (!Array.isArray(resultados)) return null;
    return resultados
      .filter((r) => {
        const dur = Number(r.lengthSeconds ?? 0);
        return !!r.videoId && dur >= DURACION_MINIMA_YT_S && dur <= DURACION_MAXIMA_YT_S;
      })
      .slice(0, tope)
      .map((r) => {
        const id = String(r.videoId ?? "");
        const miniaturas = r.videoThumbnails ?? [];
        return {
          id,
          tipo: "track" as const,
          titulo: r.title ?? "",
          artista: r.author ?? "",
          album: "",
          caratula:
            miniaturas.find((t) => t.quality === "high")?.url ??
            miniaturas[miniaturas.length - 1]?.url ??
            `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          duracionMs: Math.max(0, Math.round(Number(r.lengthSeconds ?? 0) * 1000)),
          isrc: null,
        };
      });
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
    if (!res.ok) return null;
    const cuerpo = (await res.json()) as { items?: Item[] };
    return Array.isArray(cuerpo.items) ? cuerpo.items : null;
  } catch {
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
async function resolverAudioInterno(p: PeticionAudio, claves: string[]): Promise<AudioResuelto | null> {
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  const album = (p.album ?? "").trim();
  const duracionMs = Math.max(0, Math.round(p.duracionMs ?? 0));
  if (!titulo && !p.isrc) return null;

  // La config del relay se descarga mientras corre la identidad de la pista.
  if (!configCache || configCache.expira <= Date.now()) void traerConfigStash();

  // En paralelo desde ya (sin título el backend rechazaría igual): ver doc.
  const ytParalelo = titulo
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

  // Calidad estándar (cuenta gratis o sin sesión): YouTube entrega AAC ~128
  // kbps, que es exactamente "una calidad menor que el FLAC" sin transcodificar
  // nada en el servidor. Si ese backend no responde se sigue por el camino sin
  // pérdida: la demo prefiere sonar a quedarse muda.
  //
  // TOPE: el canal de YouTube se espera sólo un momento. Una extracción que
  // falla tarda ~25 s en decirlo (yt-dlp reintenta clientes) y antes de este
  // tope el usuario gratis se quedaba 25 s mirando el spinner por una canción
  // que el catálogo sin pérdida resuelve en ~1 s. Agotado el tope se sigue por
  // la vía sin pérdida; si TAMBIÉN falla, el respaldo final vuelve a esperar a
  // `ytParalelo` completo con su propio techo, así que el nicho no se pierde.
  if (p.calidad === "estandar") {
    const yt = await Promise.race([
      ytParalelo,
      new Promise<null>((listo) => setTimeout(() => listo(null), TOPE_ESTANDAR_YT_MS)),
    ]);
    if (yt) return devolverYouTube(yt);
  }

  type Cand = { id: string; duracionMs: number; isrc: string | null; proveedor: string };
  const porIsrc = isrcConfiable ?? isrcPista;

  // Monochrome corre en paralelo con la identidad de Qobuz: en cuanto hay un
  // ISRC (el de la pista o el que publica Deezer) se le pregunta a su catálogo.
  // Es la fuente sin pérdida más fiable cuando el relay de stash está ocupado.
  const monoParalelo = (async () => {
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

  const candidatosPromise = juntarCandidatos(pedido);
  const monoInicial = await monoParalelo;
  if (monoInicial.pista) return devolverMonochrome(monoInicial.pista);

  // El ISRC no está en el catálogo (o la fuente no trae uno): se busca por
  // nombre MIENTRAS corre la identidad de Qobuz, así el fallback no suma espera
  // cuando el ranking estricto acierta.
  const monoNombre = titulo ? resolverMonochromePorNombre(pedido) : Promise.resolve(null);

  let candidatos = await candidatosPromise;

  // El re-subido de YouTube/SoundCloud pone `ARTISTA - Canción` en el TÍTULO y
  // el canal en el campo artista ("Monsieur Blaya", "Maitre 80"), así que el
  // primer intento no acredita a nadie y el matching estricto —con razón— no
  // resuelve. Se reintenta con lo que el TÍTULO declara: es la señal que el
  // usuario tiene delante y la que el filtro por artista no pudo ver.
  if (candidatos.length === 0) {
    const partes = splitSearchQuery(titulo);
    const artistaTitulo = partes.artist.trim();
    const tituloTitulo = partes.title.trim();
    if (artistaTitulo && tituloTitulo) {
      candidatos = await juntarCandidatos({ ...pedido, titulo: tituloTitulo, artista: artistaTitulo });
    }
  }

  // Monochrome primero: su catálogo no depende del pool del relay. Si el ISRC
  // de la pista no estaba, se busca por nombre (ver resolverMonochromePorNombre)
  // y después se prueban los ISRC que acreditó Qobuz/Deezer.
  const monoPorNombre = await monoNombre;
  if (monoPorNombre) return devolverMonochrome(monoPorNombre);

  let mono = null as Awaited<ReturnType<typeof resolverMonochrome>>;
  const isrcsMonochrome = new Set<string>(monoInicial.isrc ? [monoInicial.isrc] : []);
  for (const c of candidatos) {
    const isrc = normalizarISRC(c.isrc ?? "");
    if (!isrc || isrcsMonochrome.has(isrc)) continue;
    isrcsMonochrome.add(isrc);
    mono = await resolverMonochrome(isrc, 2_500);
    if (mono) break;
  }
  if (mono) return devolverMonochrome(mono);

  for (const c of candidatos) {
    const mint = await mintaStash(c.id);
    if (!mint) continue;
    const duracion = c.duracionMs > 0 ? Math.round(c.duracionMs / 1000) : p.duracionMs ? Math.round(p.duracionMs / 1000) : 0;
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
  }

  // Último recurso: el audio COMPLETO vía el backend local de yt-dlp. El enlace
  // es del propio backend (su proxy), se cachea una hora —el token del backend
  // ya vive menos— y si no hay backend configurado o falla, la pista queda SIN
  // audio y la interfaz lo avisa: nunca se sirve un adelanto de 30 s. La
  // petición arrancó al entrar en la función (ver `ytParalelo`), así que acá
  // solo se espera el resultado, ya avanzado.
  const yt = await ytParalelo;
  if (!yt) return null;
  return devolverYouTube(yt);
}

/**
 * Punto de entrada con caché positiva/negativa y *single-flight*: clics
 * simultáneos sobre la misma pista comparten una única resolución.
 */
export async function resolverAudio(p: PeticionAudio): Promise<AudioResuelto | null> {
  const claves = clavesDe(p);

  const cacheado = enlaceCacheado(claves);
  if (cacheado) {
    return {
      url: cacheado.url,
      duracion: cacheado.duracion,
      canal: cacheado.canal,
      proveedor: cacheado.proveedor,
      id: cacheado.id,
      isrc: cacheado.isrc,
    };
  }
  const vueloKey = claves[0];
  const enCurso = enVuelo.get(vueloKey);
  if (enCurso) return enCurso;

  const tarea = resolverAudioInterno(p, claves).finally(() => {
    if (enVuelo.get(vueloKey) === tarea) enVuelo.delete(vueloKey);
  });
  enVuelo.set(vueloKey, tarea);
  return tarea;
}
