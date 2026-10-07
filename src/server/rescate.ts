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
 *           cae, el camino directo es el que evita bajar al adelanto. Un ISRC
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
 *      "ocupado" no es "no tengo esa pista" y bajar al adelanto por eso era
 *      parte del "rescató una demo que no sirve".
 *   3. RESPALDO. Si el catálogo o el relay no responden, cae al adelanto público
 *      de 30 s (`extensions/rescate.ts`), igual que la demo hacía antes; ese
 *      adelanto se COMPRUEBA con un GET de dos bytes antes de devolverlo, y si
 *      no suena se prueba el siguiente candidato.
 *
 * NOTA de alcance: los otros canales del backend (`arcod`, `espejos`) viven de
 * pools de cuentas de terceros que hoy están vacíos/baneados (ver
 * `bitly/docs/canales_rescate_alternativas.md`) y `qobuz-firmado` necesita un
 * `user_auth_token` con suscripción. El único canal vivo y sin credenciales es
 * `stash-relay`, que es el que se implementa acá. Agregar otro canal es sumar
 * una función a `canales` y llamarla antes que el respaldo.
 */

import { buscarEnExtension, isrcDeRespaldo, llamarExtension } from "@/server/extensions";
import { rescatarAudio } from "@/server/extensions/rescate";
import type { Item } from "@/server/extensions";
import {
  bestOriginalAlbumDuracion,
  esISRCValido,
  esProveedorAutoritativoISRC,
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
};

export type AudioResuelto = {
  url: string;
  /** Segundos (se usa en la barra del reproductor). */
  duracion: number;
  canal: "stash-relay" | "preview";
  /** De dónde salió la identidad: "qobuz-web" o el catálogo del respaldo. */
  proveedor: string;
  /** Id de la pista en el catálogo que resolvió. */
  id: string | null;
  isrc: string | null;
  bitDepth?: number;
  sampleRate?: number;
};

/* ── Caché de enlaces ────────────────────────────────────────────── */

type Enlace = { url: string; duracion: number; proveedor: string; id: string | null; isrc: string | null; expira: number };

const enlaces = new Map<string, Enlace>();
const MAX_ENLACES = 400;

function claveDe(p: PeticionAudio): string {
  return [p.titulo, p.artista, p.album ?? "", p.duracionMs ?? 0, p.isrc ?? "", p.ext ?? ""]
    .join("|")
    .toLowerCase();
}

function guardarEnlace(clave: string, e: Enlace) {
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
  enlaces.set(clave, e);
}

/* ── Canal stash-relay (provider/flacrescue/stash_relay.go) ──────── */

const CONFIG_URL = "https://stash-tipjar.rawnaldclark.workers.dev/lossless.json";
/** format_id 6 = FLAC 16/44,1 (el mismo que pide la app). */
const FORMATO_FLAC = "6";
const TTL_CONFIG_MS = 6 * 60 * 60 * 1000;
const TTL_ENLACE_MAX_MS = 45 * 60 * 1000;
const TTL_ENLACE_MIN_MS = 60 * 1000;
const MARGEN_ENLACE_MS = 5 * 60 * 1000;
const TIMEOUT_MINT_MS = 8_000;
const TIMEOUT_CONFIG_MS = 6_000;
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

async function traerConfigStash(forzar = false): Promise<RelayStash | null> {
  if (!forzar && configCache && configCache.expira > Date.now()) return configCache.valor;
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
 * entre reintentar y bajar a un adelanto de 30 s sin motivo — justo el caso de
 * "rescató una demo que no sirve". Se reintenta con una espera corta.
 */
const REINTENTOS_BUSY = 3;
const ESPERA_BUSY_MS = [400, 800, 1600];
/**
 * Techo de TODOS los intentos de mint de una pista. Reintentar vale, pero no a
 * cualquier precio: la demo no puede quedarse 20 s esperando al relay mientras
 * el usuario mira un spinner. Al agotarse, cae al adelanto como antes.
 */
const PRESUPUESTO_MINT_MS = 7_000;

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

async function mintearEn(base: string, clave: string, trackId: string, limite: number): Promise<Mint | null> {
  const url = `${base}/v1/qobuz/file?track_id=${encodeURIComponent(trackId)}&format_id=${FORMATO_FLAC}`;

  for (let intento = 0; intento <= REINTENTOS_BUSY; intento++) {
    if (Date.now() >= limite) return null;
    const ts = Math.floor(Date.now() / 1000);
    const firma = await firmarStash(clave, trackId, FORMATO_FLAC, ts);
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), Math.min(TIMEOUT_MINT_MS, Math.max(1000, limite - Date.now())));
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
      if (res.status === 429 || res.status === 503) {
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
    }
  }
  return null;
}

/** Pide el FLAC de [trackId] probando las bases del relay en orden de prioridad. */
async function mintaStash(trackId: string): Promise<Mint | null> {
  const limite = Date.now() + PRESUPUESTO_MINT_MS;
  let config = await traerConfigStash();
  for (let intento = 0; intento < 2 && config; intento++) {
    for (const base of config.bases) {
      const mint = await mintearEn(base, config.clave, trackId, limite);
      if (mint) return mint;
    }
    if (Date.now() >= limite) return null;
    // La config puede traer una clave rotada: se recarga UNA vez.
    config = intento === 0 ? await traerConfigStash(true) : null;
  }
  return null;
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
 * baja al adelanto de 30 s: la demo "suena, pero es un preview". Esta ruta no
 * tiene espejo de por medio, contesta con el ISRC de cada pista (así la
 * verificación sigue siendo exacta) y además es la que usa el backend.
 */
const QOBUZ_API = "https://www.qobuz.com/api.json/0.2";
const QOBUZ_APP_ID = "712109809";
const TIMEOUT_QOBUZ_MS = 8_000;

/**
 * Enfriamiento si el catálogo empieza a fallar seguido (429, 403, cortes):
 * sin esto cada reproducción pagaría el tope de timeout antes de caer al
 * respaldo. Tres fallos seguidos apagan la ruta un par de minutos; las demás
 * rutas (espejo y adelanto) siguen intentando mientras tanto.
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
const TOPE_RUTA_MS = 6_000;

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
 * ISRC primero, nombre después, adelanto público como último recurso.
 */
export async function resolverAudio(p: PeticionAudio): Promise<AudioResuelto | null> {
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  const album = (p.album ?? "").trim();
  const duracionMs = Math.max(0, Math.round(p.duracionMs ?? 0));
  if (!titulo && !p.isrc) return null;

  const clave = claveDe(p);
  const cacheado = enlaces.get(clave);
  if (cacheado && cacheado.expira > Date.now()) {
    return {
      url: cacheado.url,
      duracion: cacheado.duracion,
      canal: "stash-relay",
      proveedor: cacheado.proveedor,
      id: cacheado.id,
      isrc: cacheado.isrc,
    };
  }

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

  type Cand = { id: string; duracionMs: number; isrc: string | null; proveedor: string };
  const porIsrc = isrcConfiable ?? isrcPista;

  /**
   * Identidad de una pista: TRES rutas en PARALELO, empujadas en orden de
   * precisión (ISRC exacto, luego nombre) para que el mint pruebe primero la
   * grabación exacta.
   *
   * El catálogo PÚBLICO y el espejo de la extensión llegan al mismo sitio por
   * caminos distintos: si el espejo se cae (o se cuelga), la ruta directa
   * acredita la identidad y el rescate NO baja al adelanto de 30 s. Cada ruta
   * tiene su propio tope, así que una colgada no frena a las demás.
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

  let candidatos = await juntarCandidatos(pedido);

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

  for (const c of candidatos) {
    const mint = await mintaStash(c.id);
    if (!mint) continue;
    const duracion = c.duracionMs > 0 ? Math.round(c.duracionMs / 1000) : p.duracionMs ? Math.round(p.duracionMs / 1000) : 0;
    const enlace: Enlace = {
      url: mint.url,
      duracion,
      proveedor: c.proveedor,
      id: c.id,
      isrc: c.isrc,
      expira: Date.now() + Math.max(mint.ttl, TTL_ENLACE_MIN_MS),
    };
    guardarEnlace(clave, enlace);
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

  // Último recurso: el adelanto público de 30 s, que es lo que la demo ya sabía
  // hacer. Se cachea con una vida corta para no repetir la búsqueda al saltar.
  const preview = await rescatarAudio({
    titulo,
    artista,
    album,
    isrc: p.isrc ?? null,
    duracionMs,
  });
  if (!preview) return null;
  return {
    url: preview.url,
    duracion: preview.duracion,
    canal: "preview",
    proveedor: "catalogo",
    id: null,
    // El ISRC real del adelanto cuando el catálogo lo publica; si no, el pedido.
    isrc: normalizarISRC(preview.isrc) || (bienFormado ? isrcPedido : null),
  };
}
