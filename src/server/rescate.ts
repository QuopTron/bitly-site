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
 *        · `YATTEE_URL` (+ `YATTEE_AUTH` "user:pass"): yattee-server, el canal
 *          que usa PRODUCCIÓN (medido: búsqueda 3 s, extracción 2 s con caché y
 *          ~25 s la primera vez, relay con Range y vencimiento). Busca
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
  canal: "monochrome" | "stash-relay" | "bandcamp" | "youtube";
  /** De dónde salió la identidad: "qobuz-web" o el catálogo del respaldo. */
  proveedor: string;
  /** Id de la pista en el catálogo que resolvió. */
  id: string | null;
  isrc: string | null;
  bitDepth?: number;
  sampleRate?: number;
};

/* ── Caché de enlaces ────────────────────────────────────────────── */

type Enlace = { url: string; duracion: number; canal: "monochrome" | "stash-relay" | "bandcamp" | "youtube"; proveedor: string; id: string | null; isrc: string | null; expira: number };

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
const TTL_BANDCAMP_MS = 15 * 60 * 1000;

type ResultadoBandcamp = {
  type?: string;
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

async function buscarBandcamp(consulta: string): Promise<ResultadoBandcamp[]> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  try {
    const res = await fetch(BANDCAMP_BUSQUEDA, {
      method: "POST",
      signal: control.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ search_text: consulta, search_filter: "t", full_page: false }),
    });
    if (!res.ok) return [];
    const datos = (await res.json()) as { auto?: { results?: ResultadoBandcamp[] } };
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

/** Lectura directa de la página (funciona desde una IP residencial). */
async function leerPaginaBandcamp(url: string): Promise<{ url: string; duracion: number } | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_BANDCAMP_MS);
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const atributo = /data-tralbum="([^"]+)"/.exec(html)?.[1];
    if (!atributo) return null;
    const datos = JSON.parse(desescaparHtml(atributo)) as {
      trackinfo?: Array<{ file?: Record<string, string>; duration?: number }>;
    };
    const pista = datos.trackinfo?.[0];
    const audio = pista?.file?.["mp3-128"] ?? pista?.file?.["mp3-v0"];
    if (!audio) return null;
    const duracion = Math.max(0, Math.round(pista?.duration ?? 0));
    return { url: desescaparHtml(audio), duracion };
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * MP3 de una pista: primero se intenta la página directa y, si Bandcamp la
 * entrega como reto anti-bot (lo normal desde el Worker), se le pide a la
 * instancia de Yattee, que sí la recibe entera.
 */
async function audioDePaginaBandcamp(url: string): Promise<{ url: string; duracion: number } | null> {
  const propio = await leerPaginaBandcamp(url);
  if (propio) return propio;
  const porInstancia = await audioPorInstanciaBandcamp(url);
  if (porInstancia) return porInstancia;
  console.warn(`[bandcamp] sin audio: ni la página directa ni la instancia devolvieron MP3 (${url})`);
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

  const consultas = [`${artista} ${titulo}`, `${titulo} ${artista}`, artista]
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
  let mejor: { url: string; nombre: string; punto: number } | null = null;

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
    if (!mejor || punto > mejor.punto) mejor = { url, nombre: r.name ?? "", punto };
  }
  if (!mejor) return null;

  const pagina = await audioDePaginaBandcamp(mejor.url);
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
      // pagar el arranque de uno después del otro.
      const respuestas = await Promise.all(
        yattees.map(async (base) => {
          try {
            await fetch(`${base}/`, { headers: encabezados, signal: AbortSignal.timeout(esperaMs) });
            // Si hubo respuesta, el host está despierto (el status no importa).
            marcarYatteeVivo(base);
            return true;
          } catch {
            return false;
          }
        }),
      );
      if (!respuestas.some(Boolean)) return false;
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
const MAX_YATTEE_AUDIO = Math.max(1, Math.min(8, Number(process.env.YATTEE_CONCURRENCIA) || 2));
let yatteeActivos = 0;
const yatteeEspera: Array<() => void> = [];

async function conCupoYattee<T>(tarea: () => Promise<T>): Promise<T> {
  if (yatteeActivos < MAX_YATTEE_AUDIO) {
    yatteeActivos++;
  } else {
    // El turno se TRANSFIERE desde quien libera, así `yatteeActivos` no baja.
    await new Promise<void>((resolver) => yatteeEspera.push(resolver));
  }
  try {
    return await tarea();
  } finally {
    const siguiente = yatteeEspera.shift();
    if (siguiente) siguiente();
    else yatteeActivos--;
  }
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
    const resultados = await pedirYattee<ResultadoBusquedaYattee[]>(
      cfg,
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
 * Pide el audio al canal de YouTube. El backend local va PRIMERO cuando está
 * configurado (desarrollo: `pnpm yt-dlp` resuelve en ~7 s en la misma máquina);
 * en producción no hay backend propio publicado y el canal es yattee, que
 * resuelve el material de nicho en ~25 s la primera vez y ~2 s con la caché de
 * su extractor.
 */
async function rescatarYouTube(p: PeticionAudio): Promise<{ stream: string; duracion: number } | null> {
  const cfg = configYouTube();
  if (cfg.local) {
    const propio = await rescatarEnBackendPropio(p, cfg.local);
    if (propio) return propio;
  }
  if (cfg.yattees.length === 0) return null;
  await despertarYattee();
  for (const base of yatteesVivas()) {
    ultimoEstadoYt = 0;
    const resuelto = await rescatarEnYattee(p, { yattee: base, auth: cfg.auth });
    if (resuelto) return resuelto;
    // Si la base contestó bien (200) pero no tenía la pista, la otra instancia
    // del mismo repo tampoco la va a tener: no se paga otro timeout.
    if (!falloYattee()) break;
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

  if (cfg.yattees.length > 0) {
    // Gracia corta: si el servidor de Yattee está dormido, el ping lo despierta
    // sin hacer esperar la búsqueda entera (el catálogo contesta igual).
    await despertarYattee(6_000);
    for (const base of yatteesVivas()) {
      ultimoEstadoYt = 0;
      const resultados = await pedirYattee<ResultadoBusquedaYattee[]>(
        { yattee: base, auth: cfg.auth },
        `/api/v1/search?q=${encodeURIComponent(consulta)}&type=video`,
        TIMEOUT_YT_BUSQUEDA_MS,
      );
      const encontrados = (Array.isArray(resultados) ? resultados : [])
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
      // Yattee no encontró nada (o no contestó): si hay backend propio, se
      // prueba ahí. Es justo el caso del folklore que el índice no cubre.
      if (encontrados.length > 0) return encontrados;
      if (!falloYattee()) break;
    }
    if (!cfg.local) return null;
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
/**
 * Techo del ÚLTIMO intento (YouTube) cuando ya fallaron los canales sin
 * pérdida. Sin esto, un yattee caído o despertándose dejaba al visitante
 * esperando hasta 60 s por una pista que ningún otro canal va a rescatar: cada
 * canal debe tener su propio reloj y rendirse solo.
 */
// Con el PO token provider externo, la primera extracción de un video tarda
// ~20 s (mint del token + yt-dlp + relay); con 15 s el nicho que solo existe en
// YouTube se quedaba sin audio justo cuando ya empezaba a resolverse.
const TOPE_YT_FINAL_MS = 32_000;

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
  if (!titulo && !p.isrc) return null;

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
  if (p.calidad === "estandar" && !evitar.has("youtube")) {
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

  // Con techo propio: si el respaldo de ISRC (Deezer) o el catálogo de monochrome
  // se cuelgan, el rescate sigue igual con el relay y Bandcamp. Antes esta
  // espera era libre y podía comerse el presupuesto entero antes de preguntarle
  // a ningún otro canal.
  const monoInicial = await conTope(monoParalelo, TOPE_RUTA_MS * 2).catch((): MonoInicial => ({
    isrc: null,
    pista: null,
  }));
  if (monoInicial.pista && (await monochromeDisponible(monoInicial.pista.url))) {
    return devolverMonochrome(monoInicial.pista);
  }
  anotar(monoInicial.pista ? "mono-isrc-sin-audio" : "mono-isrc-sin-match");

  const [candidatosResueltos, monoPorNombre] = await Promise.all([candidatosPromise, monoNombre]);
  let candidatos = candidatosResueltos;
  anotar(`cands=${candidatos.length}`);

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
  // de la pista no estaba, ya se buscó por nombre en paralelo
  // (ver resolverMonochromePorNombre); después se prueban los ISRC que
  // acreditaron Qobuz/Deezer.
  if (monoPorNombre && (await monochromeDisponible(monoPorNombre.url))) {
    return devolverMonochrome(monoPorNombre);
  }
  anotar(monoPorNombre ? "mono-nombre-sin-audio" : "mono-nombre-sin-match");

  let mono = null as Awaited<ReturnType<typeof resolverMonochrome>>;
  const isrcsMonochrome = new Set<string>(monoInicial.isrc ? [monoInicial.isrc] : []);
  for (const c of evitar.has("monochrome") ? [] : candidatos) {
    const isrc = normalizarISRC(c.isrc ?? "");
    if (!isrc || isrcsMonochrome.has(isrc)) continue;
    isrcsMonochrome.add(isrc);
    mono = await resolverMonochrome(isrc, 2_500);
    if (mono) break;
  }
  if (mono && (await monochromeDisponible(mono.url))) return devolverMonochrome(mono);
  anotar(mono ? "mono-isrc-cands-sin-audio" : "mono-isrc-cands-sin-match");

  let mintsFallidos = 0;
  for (const c of evitar.has("stash-relay") ? [] : candidatos) {
    const mint = await mintaStash(c.id);
    if (!mint) {
      mintsFallidos++;
      continue;
    }
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

  anotar(`stash-fallos=${mintsFallidos}/${candidatos.length}`);

  // Sin FLAC ni relay, Bandcamp cubre el nicho con su MP3 público. Va antes de
  // YouTube porque no depende de un backend externo ni de credenciales.
  const bandcamp = await bandcampParalelo;
  if (bandcamp) return devolverBandcamp(bandcamp);
  anotar("bandcamp-sin-match");

  // Último recurso: el audio COMPLETO vía el backend local de yt-dlp. El enlace
  // es del propio backend (su proxy), se cachea una hora -el token del backend
  // ya vive menos- y si no hay backend configurado o falla, la pista queda SIN
  // audio y la interfaz lo avisa: nunca se sirve un adelanto de 30 s. La
  // petición arrancó al entrar en la función (ver `ytParalelo`), así que acá
  // solo se espera el resultado, ya avanzado.
  if (evitar.has("youtube")) {
    console.warn(`[rescate] sin audio «${titulo}» · ${traza.join(" ")} · youtube descartado`);
    return null;
  }
  const yt = await conTope(ytParalelo, TOPE_YT_FINAL_MS).catch(() => null);
  if (!yt) {
    anotar("youtube-sin-audio");
    console.warn(`[rescate] sin audio «${titulo}» · ${traza.join(" ")} · ${Date.now() - t0}ms`);
    return null;
  }
  return devolverYouTube(yt);
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
      return `${cfg.bases.length} relay(s) · ${cfg.bases.map((b) => new URL(b).host).join(", ")}`;
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
export async function resolverAudio(p: PeticionAudio): Promise<AudioResuelto | null> {
  const claves = clavesDe(p);
  const evitar = new Set((Array.isArray(p.evitar) ? p.evitar : []).map((c) => String(c)));

  // Un enlace cacheado del canal que el navegador acaba de fallar no sirve:
  // se resuelve de nuevo para pedir OTRO canal.
  const cacheado = enlaceCacheado(claves);
  if (cacheado && !evitar.has(cacheado.canal)) {
    return {
      url: cacheado.url,
      duracion: cacheado.duracion,
      canal: cacheado.canal,
      proveedor: cacheado.proveedor,
      id: cacheado.id,
      isrc: cacheado.isrc,
    };
  }
  const vueloKey = `${claves[0]}|${[...evitar].sort().join(",")}`;
  const enCurso = enVuelo.get(vueloKey);
  if (enCurso) return enCurso;

  const tarea = resolverAudioInterno(p, claves, evitar).finally(() => {
    if (enVuelo.get(vueloKey) === tarea) enVuelo.delete(vueloKey);
  });
  enVuelo.set(vueloKey, tarea);
  return tarea;
}
