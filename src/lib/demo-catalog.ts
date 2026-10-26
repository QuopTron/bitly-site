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
import { leerTokenCuenta } from "@/lib/cuentas-cliente";
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
  canal: "monochrome" | "stash-relay" | "bandcamp" | "youtube" | null;
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

/**
 * Últimas búsquedas, para no repetir el viaje al servidor.
 *
 * Con datos móviles cada búsqueda son dos o tres segundos de espera; volver a
 * la misma consulta (reenviar el formulario, cambiar de categoría y volver,
 * abrir un álbum y regresar) no tiene por qué pagarlos otra vez. Vive sólo en
 * memoria de la pestaña y vence a los 3 minutos, así el catálogo no queda viejo.
 * Los fallos y las respuestas limitadas NO se guardan: esos hay que reintentarlos.
 */
const CACHE_BUSQUEDAS = new Map<string, { cuando: number; resultado: ResultadoDemo }>();
const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX = 24;
/** Búsquedas idénticas en vuelo: la segunda espera la primera, no la repite. */
const BUSQUEDAS_EN_CURSO = new Map<string, Promise<ResultadoDemo>>();

/** Copia de las pistas: el reproductor les escribe `audioUrl` al sonar. */
function copiar(r: ResultadoDemo): ResultadoDemo {
  return { ...r, pistas: r.pistas.map((p) => ({ ...p, audioUrl: null, canal: null })) };
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

  const clave = `${ext}|${filtro ?? ""}|${limite}|${consulta.toLowerCase()}`;
  const guardada = CACHE_BUSQUEDAS.get(clave);
  if (guardada && Date.now() - guardada.cuando < CACHE_TTL_MS) return copiar(guardada.resultado);

  const enCurso = BUSQUEDAS_EN_CURSO.get(clave);
  if (enCurso) return copiar(await enCurso);

  const promesa = buscarRemoto(consulta, ext, filtro, limite);
  BUSQUEDAS_EN_CURSO.set(clave, promesa);
  try {
    const resultado = await promesa;
    // Sólo se guarda lo que sirve: resultados con pistas y sin tope de cuota.
    if (resultado.pistas.length > 0 && !resultado.limitado) {
      if (CACHE_BUSQUEDAS.size >= CACHE_MAX) {
        const masVieja = CACHE_BUSQUEDAS.keys().next().value;
        if (masVieja) CACHE_BUSQUEDAS.delete(masVieja);
      }
      CACHE_BUSQUEDAS.set(clave, { cuando: Date.now(), resultado });
    }
    return copiar(resultado);
  } finally {
    BUSQUEDAS_EN_CURSO.delete(clave);
  }
}

async function buscarRemoto(
  consulta: string,
  ext: ExtensionId,
  filtro: string | null,
  limite: number,
): Promise<ResultadoDemo> {
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

/**
 * Canales que acaban de fallar EN ESTE navegador, con su vencimiento.
 *
 * Un 429 del host de pistas no es de una sola canción: si el catálogo está
 * limitando, todas las pistas van a fallar con ese canal y cada una pagaría la
 * espera del fallo antes de caer al respaldo. Anotarlo por dos minutos hace
 * que las siguientes vayan derecho al canal que sí abre, sin sonar peor.
 */
const canalesCaidos = new Map<string, number>();
const CAIDO_MS = 2 * 60 * 1000;

/** Marca un canal como caído en este navegador por un par de minutos. */
export function anotarCanalCaido(canal: string | null | undefined): void {
  const limpio = String(canal ?? "").trim();
  if (!limpio) return;
  canalesCaidos.set(limpio, Date.now() + CAIDO_MS);
}

/** Canales que hoy no abren; se poda solo al consultarlo. */
function canalesCaidosAhora(): string[] {
  const ahora = Date.now();
  for (const [canal, hasta] of canalesCaidos) {
    if (hasta <= ahora) canalesCaidos.delete(canal);
  }
  return [...canalesCaidos.keys()];
}

async function resolverAudio(p: Pista, evitar: string[] = []): Promise<AudioRescatado | null> {
  const audio = await rescatarDemo({
    titulo: p.titulo,
    artista: p.artista,
    album: p.album,
    duracionMs: p.duracion > 0 ? p.duracion * 1000 : 0,
    isrc: p.isrc,
    ext: p.ext,
    codigo: codigoPremiumGuardado(),
    token: leerTokenCuenta(),
    evitar,
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
export function audioDe(p: Pista, evitar: string[] = []): Promise<AudioRescatado | null> {
  // Los canales que fallaron en otras pistas también se descartan acá.
  const descartados = [...new Set([...evitar, ...canalesCaidosAhora()])];
  if (p.audioUrl && descartados.length === 0) {
    return Promise.resolve({ url: p.audioUrl, duracion: p.duracion, canal: p.canal ?? undefined });
  }
  // La lista entra en la clave: dos pedidos del mismo tema con canales
  // descartados distintos no pueden compartir la misma resolución.
  const clave = descartados.length > 0 ? `${p.id}|${descartados.sort().join(",")}` : p.id;
  const pendiente = enCurso.get(clave);
  if (pendiente) return pendiente;
  const promesa = resolverAudio(p, descartados).finally(() => enCurso.delete(clave));
  enCurso.set(clave, promesa);
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
