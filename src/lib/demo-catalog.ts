/**
 * Catálogo de la demo: las 8 extensiones de la app, con respaldo.
 *
 *  · `buscar` llama al proxy cifrado (`src/lib/demo-api.ts`): el servidor
 *    ejecuta la extensión elegida y, si esa no puede responder, devuelve el
 *    catálogo de respaldo (Deezer) con `origen: "respaldo"`. Si Deezer tampoco
 *    tiene la canción, el último respaldo es el backend local de yt-dlp
 *    (YouTube).
 *  · `audioDe` resuelve el AUDIO de una pista al momento de reproducirla. Las
 *    extensiones devuelven metadata, no audio: el servidor identifica la pista
 *    con el matching del backend (ISRC verificado por `qobuz-web`, o ranking
 *    por nombre) y le pide el FLAC al relay de stash; si ese canal no responde,
 *    pide el audio completo al backend local de yt-dlp. Sin ningún canal, la
 *    pista queda sin audio (nunca un adelanto de 30 s). Ver `@/server/rescate`.
 *  · `contenidoDe` abre un álbum, artista o lista y devuelve SUS canciones:
 *    la colección también viaja por el proxy cifrado.
 */

import { abrirDemo, buscarDemo, letrasDemo, rescatarDemo, type AudioRescatado } from "@/lib/demo-api";
import { codigoPremiumGuardado } from "@/lib/demo-cuota";
import type { Letras } from "@/server/letras";
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
  /** En segundos. 0 si la fuente no lo publica. */
  duracion: number;
  isrc: string | null;
  /** URL del audio ya resuelto; vacía hasta que se pide reproducir. */
  audioUrl: string | null;
  /**
   * De dónde salió el audio ya resuelto: "stash-relay" = FLAC completo;
   * "youtube" = audio completo vía el backend local de yt-dlp. Null hasta que
   * se pide reproducir.
   */
  canal: "monochrome" | "stash-relay" | "youtube" | null;
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
    audioUrl: null,
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
 * Resoluciones EN CURSO por pista. La precarga del primer resultado y el clic
 * del visitante piden el mismo audio con décimas de segundo de diferencia: sin
 * esto serían dos extracciones de 25 s en paralelo (y dos esperas) en vez de
 * una sola que los dos aprovechan.
 *
 * Sólo viven mientras la llamada está pendiente: al terminar se borran, así un
 * fallo no queda cacheado y el siguiente intento vuelve a pedir el audio.
 */
const enCurso = new Map<string, Promise<AudioRescatado | null>>();

async function resolverAudio(p: Pista): Promise<AudioRescatado | null> {
  const audio = await rescatarDemo({
    titulo: p.titulo,
    artista: p.artista,
    album: p.album,
    duracionMs: p.duracion > 0 ? p.duracion * 1000 : 0,
    isrc: p.isrc,
    ext: p.ext,
    codigo: codigoPremiumGuardado(),
  });
  if (!audio) return null;
  p.audioUrl = audio.url;
  p.canal = audio.canal ?? null;
  if (audio.duracion > 0) p.duracion = audio.duracion;
  return audio;
}

/**
 * URL del audio de una pista. Resuelta una vez, queda guardada en la propia
 * pista para no repetir la llamada al saltar de pista. Se envían título,
 * artista, álbum y duración porque el matching de la app desempata con ellos.
 *
 * Con `codigo` viaja el código Premium guardado: el servidor lo verifica y
 * decide si esta pista viene en FLAC o en calidad estándar (ver `demo-proxy`).
 */
export function audioDe(p: Pista): Promise<AudioRescatado | null> {
  if (p.audioUrl) {
    return Promise.resolve({ url: p.audioUrl, duracion: p.duracion, canal: p.canal ?? undefined });
  }
  const pendiente = enCurso.get(p.id);
  if (pendiente) return pendiente;
  const promesa = resolverAudio(p).finally(() => enCurso.delete(p.id));
  enCurso.set(p.id, promesa);
  return promesa;
}

/** Letras para el karaoke; `null` si no hay o la consulta falla. */
export function letrasDe(p: Pista): Promise<Letras | null> {
  return letrasDemo({
    titulo: p.titulo,
    artista: p.artista,
    album: p.album,
    duracion: p.duracion,
  });
}

/** Sugerencias de arranque: evite que el marco se vea vacío al abrirlo. */
export const SUGERIDAS = ["Daft Punk", "Rosalía", "Coldplay", "jazz", "blues", "guitarra"];

/**
 * Contenido de un álbum, artista o lista: SUS canciones —y en un artista,
 * también sus álbumes, para poder seguir recorriendo—.
 *
 * El id de la `Pista` es `ext:tipo:idCrudo` (ver `desdeItem`): para pedirlo a
 * la fuente hay que sacarle los dos primeros segmentos. Los items heredan la
 * fuente y el origen del item que los abrió: un álbum del catálogo de respaldo
 * contiene canciones del respaldo (Deezer), y eso decide después con qué
 * identidad se rescata el audio. `null` = la fuente no supo recorrer la
 * colección y hay que buscarla por nombre (el paso previo, que sigue
 * funcionando como red de seguridad).
 */
export async function contenidoDe(p: Pista): Promise<Pista[] | null> {
  if (p.tipo === "track") return null;
  const crudo = p.id.split(":").slice(2).join(":");
  if (!crudo) return null;
  try {
    const r = await abrirDemo({ ext: p.ext, tipo: p.tipo, id: crudo });
    if (!r.items.length) return null;
    return r.items.map((i) => desdeItem(i, p.ext, p.respaldada));
  } catch {
    return null;
  }
}
