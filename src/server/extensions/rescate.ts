/**
 * Catálogo de respaldo de la demo y ADELANTO público como último recurso.
 *
 * `buscarRespaldo` es lo que se usa cuando una extensión no puede responder: el
 * catálogo público de Deezer, con sus resultados marcados como "respaldo".
 *
 * `rescatarAudio` es el ÚLTIMO recurso del rescate de audio: si el canal
 * principal (`@/server/rescate`, Qobuz + stash-relay) no consigue el FLAC, acá
 * se busca el adelanto oficial de 30 s que el catálogo publica para oyentes —el
 * mismo camino por ISRC que usa la app, pero sin bajar nada— de modo que la
 * demo nunca queda muda por un canal caído.
 */

import {
  bestOriginalAlbumDuracion,
  esISRCValido,
  normalizarISRC,
  splitSearchQuery,
  type TrackResult,
} from "@/server/matching";
import { categoriaDe } from "./normalizar";
import type { Item, TipoResultado } from "./tipos";

const DEEZER = "https://api.deezer.com";
const ITUNES = "https://itunes.apple.com/search";
const PREVIEW_SEGUNDOS = 30;

async function pedir(url: string, ms = 8000): Promise<any | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    const res = await fetch(url, { signal: control.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizar(s).split(/\s+/).filter(Boolean);
}

function duracionCoincide(expectedMs: number, foundMs: number): boolean {
  if (!expectedMs || !foundMs) return true;
  return Math.abs(expectedMs - foundMs) <= 10_000;
}

function textoClave(s: string): string {
  return normalizar(s).replace(/\b(feat|ft|with|vs|x)\b/g, " ");
}

function coincideTitulo(expected: string, found: string): boolean {
  const e = textoClave(expected);
  const f = textoClave(found);
  if (!e || !f) return false;
  if (e === f || e.includes(f) || f.includes(e)) return true;

  const et = tokens(e);
  const ft = tokens(f);
  if (!et.length || !ft.length) return false;

  const interseccion = et.filter((t) => ft.includes(t)).length;
  return interseccion >= Math.max(2, Math.min(et.length, ft.length) - 1);
}

function coincideArtista(expected: string, found: string): boolean {
  const e = textoClave(expected);
  const f = textoClave(found);
  if (!e || !f) return true;
  if (e === f || e.includes(f) || f.includes(e)) return true;

  const et = tokens(e);
  const ft = tokens(f);
  if (!et.length || !ft.length) return false;

  const interseccion = et.filter((t) => ft.includes(t)).length;
  return interseccion >= Math.max(1, Math.min(et.length, ft.length) - 1);
}

/* ── Catálogo de respaldo ────────────────────────────────────────── */

const RUTAS: Record<TipoResultado, string> = {
  track: "/search",
  album: "/search/album",
  artist: "/search/artist",
  playlist: "/search/playlist",
};

function desdeDeezer(datos: any, tipo: TipoResultado): Item[] {
  const filas: any[] = Array.isArray(datos?.data) ? datos.data : [];
  const items: Item[] = [];
  for (const r of filas) {
    if (!r?.id) continue;
    items.push({
      id: String(r.id),
      tipo,
      titulo: r.title ?? r.name ?? "",
      artista: r.artist?.name ?? r.artist ?? "",
      album: r.album?.title ?? "",
      caratula:
        r.album?.cover_xl ??
        r.album?.cover_big ??
        r.album?.cover_medium ??
        r.picture_xl ??
        r.picture_medium ??
        null,
      duracionMs: tipo === "track" && r.duration ? Number(r.duration) * 1000 : 0,
      // Deezer SÍ publica el ISRC en el resultado de búsqueda. Descartarlo (como
      // se hacía) dejaba al respaldo sin la única identidad de la grabación: la
      // pista venía con su ISRC y la interfaz mostraba `null`, así que no había
      // nada con qué confirmar que lo rescatado era lo pedido.
      isrc: normalizarISRC(r.isrc) || null,
    });
  }
  return items;
}

/** Busca en Deezer cuando la extensión no pudo responder. */
export async function buscarRespaldo(
  consulta: string,
  filtro: string | null,
  limite: number,
): Promise<Item[]> {
  const tipo = (filtro ? categoriaDe(filtro) : null) ?? "track";
  const url = `${DEEZER}${RUTAS[tipo]}?q=${encodeURIComponent(consulta)}&limit=${limite}`;
  const datos = await pedir(url);
  if (!datos) throw new Error("el catálogo de respaldo no responde");
  return desdeDeezer(datos, tipo).slice(0, limite);
}

/* ── Rescate de audio ────────────────────────────────────────────── */

export type Audio = { url: string; duracion: number; isrc?: string | null };

/* ── Validación del adelanto ─────────────────────────────────────── */

/**
 * Un adelanto que no suena no sirve de nada.
 *
 * Los CDN (Deezer sobre todo) devuelven URLs firmadas que caducan y a veces
 * responden 403/404, así que el catálogo puede publicar un `preview` que el
 * reproductor no puede abrir. Sirvió poner un `<audio>` que no arranca: acá se
 * comprueba ANTES de devolverlo, con un GET de dos bytes, y si no suena se pasa
 * al siguiente candidato en vez de dejar la demo muda.
 */
const TTL_VIVO_MS = 10 * 60 * 1000;
const TTL_MUERTO_MS = 60 * 1000;
const vivos = new Map<string, { ok: boolean; expira: number }>();

async function suenaDeVerdad(url: string): Promise<boolean> {
  const previo = vivos.get(url);
  if (previo && previo.expira > Date.now()) return previo.ok;

  let ok = false;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 5000);
  try {
    const res = await fetch(url, { signal: control.signal, headers: { Range: "bytes=0-1" } });
    const tipo = (res.headers.get("content-type") ?? "").toLowerCase();
    ok = (res.status === 200 || res.status === 206) && (tipo === "" || tipo.startsWith("audio/") || tipo.startsWith("application/octet-stream"));
    if (ok) await res.arrayBuffer();
  } catch {
    ok = false;
  } finally {
    clearTimeout(reloj);
  }

  if (vivos.size > 200) vivos.clear();
  vivos.set(url, { ok, expira: Date.now() + (ok ? TTL_VIVO_MS : TTL_MUERTO_MS) });
  return ok;
}

function conPreview(r: any, isrc: string | null = null): Audio | null {
  return r?.preview ? { url: String(r.preview), duracion: PREVIEW_SEGUNDOS, isrc } : null;
}

async function porIsrc(isrc: string): Promise<Audio | null> {
  const codigo = normalizarISRC(isrc);
  if (!esISRCValido(codigo)) return null;
  const datos = await pedir(`${DEEZER}/track/isrc:${encodeURIComponent(codigo)}`);
  const audio = conPreview(datos, codigo);
  return audio && (await suenaDeVerdad(audio.url)) ? audio : null;
}

async function porDeezer(titulo: string, artista: string, duracionMs = 0): Promise<Audio | null> {
  const q = `artist:"${artista}" track:"${titulo}"`;
  const datos = await pedir(`${DEEZER}/search?q=${encodeURIComponent(q)}&limit=8`);
  const filas: any[] = Array.isArray(datos?.data) ? datos.data : [];
  const candidatos: Audio[] = [];
  for (const r of filas) {
    if (!r?.preview) continue;
    const nombre = String(r?.title ?? "");
    const artistaFound = String(r?.artist?.name ?? "");
    const durFound = Number(r?.duration ?? 0) * 1000;
    if (!coincideTitulo(titulo, nombre)) continue;
    if (artista && !coincideArtista(artista, artistaFound)) continue;
    if (!duracionCoincide(duracionMs, durFound)) continue;
    candidatos.push({ url: String(r.preview), duracion: PREVIEW_SEGUNDOS, isrc: normalizarISRC(r.isrc) || null });
  }
  return primerVivo(candidatos);
}

async function porItunes(titulo: string, artista: string, duracionMs = 0): Promise<Audio | null> {
  const term = `${artista} ${titulo}`.trim();
  const url = `${ITUNES}?${new URLSearchParams({ term, entity: "song", limit: "8", media: "music" })}`;
  const datos = await pedir(url);
  const filas: any[] = Array.isArray(datos?.results) ? datos.results : [];
  const candidatos: Audio[] = [];
  for (const r of filas) {
    if (!r?.previewUrl) continue;
    const nombre = String(r.trackName ?? "");
    const artistaFound = String(r.artistName ?? "");
    const durFound = Number(r.trackTimeMillis ?? 0);
    if (!coincideTitulo(titulo, nombre)) continue;
    if (artista && !coincideArtista(artista, artistaFound)) continue;
    if (!duracionCoincide(duracionMs, durFound)) continue;
    candidatos.push({ url: String(r.previewUrl), duracion: PREVIEW_SEGUNDOS, isrc: null });
  }
  return primerVivo(candidatos);
}

/** Primer adelanto que REALMENTE suena (los demás se descartan, no se devuelven). */
async function primerVivo(candidatos: Audio[]): Promise<Audio | null> {
  for (const c of candidatos) {
    if (await suenaDeVerdad(c.url)) return c;
  }
  return null;
}

export type PistaParaRescatar = {
  titulo: string;
  artista: string;
  album?: string | null;
  isrc?: string | null;
  duracionMs?: number | null;
};

/**
 * ISRC de una pista que NO lo traía, sacado del catálogo de respaldo.
 *
 * Es el puente que faltaba entre las 8 fuentes: Spotify, TIDAL, Amazon y
 * YouTube no publican el ISRC (o solo el de la fuente primaria), así que una
 * pista que llegó de ahí no tenía con qué identificarse en el catálogo FLAC.
 * Deezer sí es autoritativo y devuelve el ISRC en su búsqueda, de modo que se
 * busca la MISMA grabación por título+artista+álbum+duración con el matching
 * estricto del backend y de ahí sale un ISRC que sí se puede usar para pedir el
 * FLAC completo. Sin esto, esas fuentes caían al adelanto de 30 s.
 */
export async function isrcDeRespaldo(p: PistaParaRescatar): Promise<string | null> {
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  if (!titulo) return null;

  const consulta = `${titulo} ${artista}`.trim();
  let items: Item[];
  try {
    items = await buscarRespaldo(consulta, "track", 10);
  } catch {
    return null;
  }

  const cands: TrackResult[] = items
    .filter((i) => i.tipo === "track" && (i.isrc ?? "") !== "")
    .map((i) => ({
      id: i.id,
      title: i.titulo,
      artist: i.artista,
      album: i.album,
      coverUrl: i.caratula ?? "",
      durationMs: i.duracionMs,
      isrc: normalizarISRC(i.isrc),
      provider: "deezer",
    }));
  if (cands.length === 0) return null;

  const best = bestOriginalAlbumDuracion(
    titulo,
    artista,
    (p.album ?? "").trim(),
    Math.max(0, Math.round(p.duracionMs ?? 0)),
    cands,
  );
  const isrc = normalizarISRC(best?.isrc);
  return esISRCValido(isrc) ? isrc : null;
}

/**
 * Resuelve el adelanto de 30 s de una pista: primero por ISRC (identidad
 * exacta), después por nombre contra Deezer y, si no, contra iTunes. Devuelve
 * `null` si ningún catálogo publica un adelanto que coincida.
 */
export async function rescatarAudio(p: PistaParaRescatar): Promise<Audio | null> {
  const titulo = (p.titulo ?? "").trim();
  const artista = (p.artista ?? "").trim();
  const duracionMs = Math.max(0, Math.round(p.duracionMs ?? 0));
  if (!titulo) return null;
  if (p.isrc) {
    const porI = await porIsrc(p.isrc);
    if (porI) return porI;
  }
  if (artista) {
    const porD = await porDeezer(titulo, artista, duracionMs);
    if (porD) return porD;
  }
  const porI = await porItunes(titulo, artista, duracionMs);
  if (porI) return porI;

  // Último intento: el re-subido trae `ARTISTA - Canción` en el título y el
  // CANAL en el campo artista, así que la búsqueda por artista no acreditó a
  // nadie. Se prueba con lo que el título declara. Sin esto, las pistas de
  // YouTube/SoundCloud quedaban MUDAS en vez de sonar su adelanto.
  const partes = splitSearchQuery(titulo);
  const artistaTitulo = partes.artist.trim();
  const tituloTitulo = partes.title.trim();
  if (!artistaTitulo || !tituloTitulo) return null;
  if (artistaTitulo.toLowerCase() === artista.toLowerCase()) return null;

  const porDTitulo = await porDeezer(tituloTitulo, artistaTitulo, duracionMs);
  if (porDTitulo) return porDTitulo;
  return porItunes(tituloTitulo, artistaTitulo, duracionMs);
}
