/**
 * Catálogo de respaldo de la demo.
 *
 * `buscarRespaldo` es lo que se usa cuando una extensión no puede responder: el
 * catálogo público de Deezer, con sus resultados marcados como "respaldo".
 *
 * `isrcDeRespaldo` es el puente que faltaba entre las 8 fuentes: esas fuentes no
 * publican el ISRC (o solo el de la fuente primaria), así que se busca la MISMA
 * grabación en Deezer —que sí es autoritativo— para pedir el FLAC completo.
 */

import {
  bestOriginalAlbumDuracion,
  esISRCValido,
  normalizarISRC,
  type TrackResult,
} from "@/server/matching";
import { categoriaDe } from "./normalizar";
import type { Item, TipoResultado } from "./tipos";

const DEEZER = "https://api.deezer.com";

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
 * FLAC completo.
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
