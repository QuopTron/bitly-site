/**
 * Catálogo de la demo: las 8 extensiones de la app, con respaldo.
 *
 *  · `buscar` llama al proxy cifrado (`src/lib/demo-api.ts`): el servidor
 *    ejecuta la extensión elegida y, si esa no puede responder, devuelve el
 *    catálogo de respaldo (Deezer) con `origen: "respaldo"`.
 *  · `audioDe` resuelve el AUDIO de una pista al momento de reproducirla. Las
 *    extensiones devuelven metadata, no audio: el servidor identifica la pista
 *    con el matching del backend (ISRC verificado por `qobuz-web`, o ranking
 *    por nombre) y le pide el FLAC al relay de stash. Si ese canal no responde,
 *    el último recurso es el adelanto público de 30 s. Ver `@/server/rescate`.
 */

import { buscarDemo, rescatarDemo, type AudioRescatado } from "@/lib/demo-api";
import { extensionDe, type ExtensionId } from "@/lib/demo-extensiones";
import type { Item, TipoResultado } from "@/server/extensions";

export type Pista = {
  /** Id único dentro de la lista (la fuente puede repetir ids entre tipos). */
  id: string;
  ext: ExtensionId;
  tipo: TipoResultado;
  titulo: string;
  artista: string;
  album: string;
  caratula: string | null;
  /** En segundos. 30 cuando el audio es el adelanto del catálogo. */
  duracion: number;
  isrc: string | null;
  /** URL del audio; vacía hasta que se pide reproducir. */
  preview: string | null;
  /**
   * De dónde salió el audio ya resuelto: "stash-relay" = FLAC completo;
   * "preview" = adelanto público de 30 s. Null hasta que se pide reproducir.
   */
  canal: "stash-relay" | "preview" | null;
  /** Vino del catálogo de respaldo (la extensión no pudo responder). */
  respaldada: boolean;
};

export type ResultadoDemo = {
  pistas: Pista[];
  /** "extension" = lo devolvió la extensión; "respaldo" = catálogo Deezer. */
  origen: "extension" | "respaldo";
  /**
   * Nombre legible de la fuente que contestó cuando NO fue la elegida (el
   * servidor cambia de fuente si la pedida falla). Null si contestó la pedida.
   */
  otraFuente?: string | null;
  aviso?: string;
  limitado?: boolean;
};

const PREVIEW_SEGUNDOS = 30;

function desdeItem(item: Item, ext: ExtensionId, respaldada: boolean): Pista {
  return {
    id: `${ext}:${item.tipo}:${item.id}`,
    ext,
    tipo: item.tipo,
    titulo: item.titulo,
    artista: item.artista,
    album: item.album,
    caratula: item.caratula,
    duracion: item.duracionMs > 0 ? Math.round(item.duracionMs / 1000) : 0,
    isrc: item.isrc,
    preview: null,
    canal: null,
    respaldada,
  };
}

/** Búsqueda contra el proxy cifrado. Nunca lanza: un fallo es "sin resultados". */
export async function buscar(
  termino: string,
  ext: ExtensionId,
  filtro: string | null,
  limite = 12,
): Promise<ResultadoDemo> {
  const consulta = termino.trim();
  if (!consulta) return { pistas: [], origen: "respaldo" };

  try {
    const r = await buscarDemo({ consulta, ext, filtro, limite });
    // El servidor puede haber contestado con OTRA fuente. Se etiqueta cada pista
    // con la fuente que REALMENTE contestó —no con la elegida— porque ese id es
    // el que después decide si su ISRC es autoritativo al rescatar el audio.
    const cambio = Boolean(r.fuente && r.fuente !== ext);
    const efectiva = (r.fuente ?? ext) as ExtensionId;
    return {
      pistas: r.items.map((i) => desdeItem(i, efectiva, r.origen === "respaldo")),
      origen: r.origen,
      otraFuente: cambio ? extensionDe(efectiva).nombre : null,
      aviso: r.aviso,
      limitado: r.limitado,
    };
  } catch {
    return { pistas: [], origen: "respaldo" };
  }
}

/**
 * URL del audio de una pista. Resuelta una vez, queda guardada en la propia
 * pista para no repetir la llamada al saltar de pista. Se envían título,
 * artista, álbum y duración porque el matching de la app desempata con ellos.
 */
export async function audioDe(p: Pista): Promise<AudioRescatado | null> {
  if (p.preview) {
    return { url: p.preview, duracion: p.duracion || PREVIEW_SEGUNDOS, canal: p.canal ?? undefined };
  }
  const audio = await rescatarDemo({
    titulo: p.titulo,
    artista: p.artista,
    album: p.album,
    duracionMs: p.duracion > 0 ? p.duracion * 1000 : 0,
    isrc: p.isrc,
    ext: p.ext,
  });
  if (!audio) return null;
  p.preview = audio.url;
  p.canal = audio.canal ?? null;
  if (audio.duracion > 0) p.duracion = audio.duracion;
  else if (!p.duracion) p.duracion = PREVIEW_SEGUNDOS;
  return audio;
}

/** Sugerencias de arranque: evite que el marco se vea vacío al abrirlo. */
export const SUGERIDAS = ["Daft Punk", "Rosalía", "Coldplay", "jazz", "blues", "guitarra"];
