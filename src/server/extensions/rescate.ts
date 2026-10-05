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
      isrc: null,
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

export type Audio = { url: string; duracion: number };

function conPreview(r: any): Audio | null {
  return r?.preview ? { url: String(r.preview), duracion: PREVIEW_SEGUNDOS } : null;
}

async function porIsrc(isrc: string): Promise<Audio | null> {
  const datos = await pedir(`${DEEZER}/track/isrc:${encodeURIComponent(isrc)}`);
  return conPreview(datos);
}

async function porDeezer(titulo: string, artista: string, duracionMs = 0): Promise<Audio | null> {
  const q = `artist:"${artista}" track:"${titulo}"`;
  const datos = await pedir(`${DEEZER}/search?q=${encodeURIComponent(q)}&limit=8`);
  const filas: any[] = Array.isArray(datos?.data) ? datos.data : [];
  for (const r of filas) {
    if (!r?.preview) continue;
    const nombre = String(r?.title ?? "");
    const artistaFound = String(r?.artist?.name ?? "");
    const durFound = Number(r?.duration ?? 0) * 1000;
    if (!coincideTitulo(titulo, nombre)) continue;
    if (artista && !coincideArtista(artista, artistaFound)) continue;
    if (!duracionCoincide(duracionMs, durFound)) continue;
    return conPreview(r);
  }
  return null;
}

async function porItunes(titulo: string, artista: string, duracionMs = 0): Promise<Audio | null> {
  const term = `${artista} ${titulo}`.trim();
  const url = `${ITUNES}?${new URLSearchParams({ term, entity: "song", limit: "8", media: "music" })}`;
  const datos = await pedir(url);
  const filas: any[] = Array.isArray(datos?.results) ? datos.results : [];
  for (const r of filas) {
    if (!r?.previewUrl) continue;
    const nombre = String(r.trackName ?? "");
    const artistaFound = String(r.artistName ?? "");
    const durFound = Number(r.trackTimeMillis ?? 0);
    if (!coincideTitulo(titulo, nombre)) continue;
    if (artista && !coincideArtista(artista, artistaFound)) continue;
    if (!duracionCoincide(duracionMs, durFound)) continue;
    return { url: String(r.previewUrl), duracion: PREVIEW_SEGUNDOS };
  }
  return null;
}

export type PistaParaRescatar = {
  titulo: string;
  artista: string;
  isrc?: string | null;
  duracionMs?: number | null;
};

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
  return porItunes(titulo, artista, duracionMs);
}
