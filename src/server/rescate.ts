/**
 * Rescate de audio de la demo: de una pista de CUALQUIER fuente a una URL que
 * el reproductor pueda sonar.
 *
 * Es el mismo camino que usa la app (`go_backend/internal/provider/flacrescue`),
 * adaptado a lo que la landing sí puede hacer:
 *
 *   1. IDENTIDAD. Con un ISRC de un proveedor que puede dar fe de él
 *      (`matching.esProveedorAutoritativoISRC`) se le pide a la extensión
 *      `qobuz-web` su `checkAvailability(isrc, título, artista, {duration_ms})`,
 *      que devuelve el id de la pista VERIFICADA de Qobuz. Sin ISRC confiable se
 *      busca por nombre y se rankea con el matching del backend
 *      (`bestOriginalAlbumDuracion`): título + artista + álbum + duración, con
 *      las versiones no originales descartadas.
 *   2. AUDIO. Ese id se canjea por una URL de CDN de Qobuz con el relay del
 *      proyecto Stash (`stash_relay.go`): una config firmada y pública trae la
 *      `relay_key`, y el mint va firmado con HMAC-SHA256. La URL trae su propio
 *      vencimiento (`etsp`), que se usa como TTL de la caché.
 *   3. RESPALDO. Si el catálogo o el relay no responden, cae al adelanto público
 *      de 30 s (`extensions/rescate.ts`), igual que la demo hacía antes.
 *
 * NOTA de alcance: los otros canales del backend (`arcod`, `espejos`) viven de
 * pools de cuentas de terceros que hoy están vacíos/baneados (ver
 * `bitly/docs/canales_rescate_alternativas.md`) y `qobuz-firmado` necesita un
 * `user_auth_token` con suscripción. El único canal vivo y sin credenciales es
 * `stash-relay`, que es el que se implementa acá. Agregar otro canal es sumar
 * una función a `canales` y llamarla antes que el respaldo.
 */

import { buscarEnExtension, llamarExtension } from "@/server/extensions";
import { rescatarAudio } from "@/server/extensions/rescate";
import type { Item } from "@/server/extensions";
import {
  bestOriginalAlbumDuracion,
  esProveedorAutoritativoISRC,
  preferirISRC,
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

async function mintearEn(base: string, clave: string, trackId: string): Promise<{ url: string; bitDepth: number; sampleRate: number; ttl: number } | null> {
  const ts = Math.floor(Date.now() / 1000);
  const firma = await firmarStash(clave, trackId, FORMATO_FLAC, ts);
  const url = `${base}/v1/qobuz/file?track_id=${encodeURIComponent(trackId)}&format_id=${FORMATO_FLAC}`;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_MINT_MS);
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

/** Pide el FLAC de [trackId] probando las bases del relay en orden de prioridad. */
async function mintaStash(trackId: string): Promise<{ url: string; bitDepth: number; sampleRate: number; ttl: number } | null> {
  let config = await traerConfigStash();
  for (let intento = 0; intento < 2 && config; intento++) {
    for (const base of config.bases) {
      const mint = await mintearEn(base, config.clave, trackId);
      if (mint) return mint;
    }
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
 * Cuarentena del contrato por ISRC: si `checkAvailability` acaba de fallar, no
 * se vuelve a pagar su ronda de red en cada reproducción. Es la misma idea que
 * la cuarentena de bases del canal en el backend: un canal caído no se consulta
 * en cada canción mientras siga caído.
 */
let isrcEnCuarentenaHasta = 0;
const CUARENTENA_ISRC_MS = 10 * 60 * 1000;

/** Id de la pista de Qobuz verificada por ISRC (contrato `checkAvailability`). */
async function idVerificadoPorISRC(p: PeticionAudio, isrc: string): Promise<string | null> {
  if (Date.now() < isrcEnCuarentenaHasta) return null;
  try {
    const r = await llamarExtension<{ available?: boolean; track_id?: string }>({
      sesion: SESION_CATALOGO,
      ext: "qobuz-web",
      metodo: "checkAvailability",
      args: [
        isrc,
        p.titulo,
        p.artista,
        { duration_ms: Math.max(0, Math.round(p.duracionMs ?? 0)) },
      ],
    });
    const id = String(r?.track_id ?? "").trim();
    if (r?.available && id) return id;
    isrcEnCuarentenaHasta = Date.now() + CUARENTENA_ISRC_MS;
    return null;
  } catch {
    isrcEnCuarentenaHasta = Date.now() + CUARENTENA_ISRC_MS;
    return null;
  }
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
  // eligió un parecido). Un candidato sin ISRC sigue valiendo: SoundCloud y
  // YouTube no lo publican y rechazarlos dejaría canciones sin audio.
  if (isrcConfiable && best.isrc && best.isrc.trim().toUpperCase() !== isrcConfiable) return null;
  return { id: best.id, duracionMs: best.durationMs, isrc: best.isrc };
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

  // Solo el ISRC de un proveedor que puede dar fe de él sirve para identificar.
  const isrcConfiable =
    p.isrc && esProveedorAutoritativoISRC(p.ext ?? "") ? String(p.isrc).trim().toUpperCase() : null;

  const candidatos: Array<{ id: string; duracionMs: number; isrc: string | null; proveedor: string }> = [];

  if (isrcConfiable) {
    const id = await idVerificadoPorISRC({ ...p, titulo, artista }, isrcConfiable);
    if (id) candidatos.push({ id, duracionMs: p.duracionMs ?? 0, isrc: isrcConfiable, proveedor: "qobuz-web" });
  }

  if (candidatos.length === 0) {
    const porNombre = await idPorNombre({ ...p, titulo, artista }, isrcConfiable);
    if (porNombre) {
      candidatos.push({
        id: porNombre.id,
        duracionMs: porNombre.duracionMs,
        isrc: porNombre.isrc || isrcConfiable,
        proveedor: "qobuz-web",
      });
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
  const preview = await rescatarAudio({ titulo, artista, isrc: p.isrc ?? null, duracionMs: p.duracionMs ?? 0 });
  if (!preview) return null;
  return {
    url: preview.url,
    duracion: preview.duracion,
    canal: "preview",
    proveedor: "catalogo",
    id: null,
    isrc: p.isrc ?? null,
  };
}
