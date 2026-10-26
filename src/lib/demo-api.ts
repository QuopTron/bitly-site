/**
 * Cliente del proxy cifrado de la demo.
 *
 * Toda búsqueda sale por las server functions de `@/server/demo-proxy`:
 * el navegador no habla con los catálogos ni recibe código de extensiones.
 * Antes de la primera llamada se pide la clave pública del servidor y se
 * deriva una clave de sesión (ECDH P-256 → HKDF → AES-256-GCM); la consulta
 * y los resultados viajan cifrados con ella.
 *
 * La clave efímera vive en memoria de la pestaña: al recargar se crea otra.
 * Si el servidor se reinicia con otra clave, el descifrado falla, el cliente
 * renueva la sesión y reintenta UNA vez.
 */

import { demoAbrir, demoBuscar, demoClave, demoLetras, demoRescatar } from "@/server/demo-proxy";
import type { Letras, PeticionLetras } from "@/server/letras";
import type { Item, TipoResultado } from "@/server/extensions";
import {
  cifrar,
  descifrar,
  derivarClave,
  generarPar,
  importarPublica,
  type Cifrado,
} from "@/lib/demo-crypto";
import type { ExtensionId } from "@/lib/demo-extensiones";

/**
 * Lo que el servidor necesita para identificar y resolver el audio: título,
 * artista, álbum y duración (el matching de la app usa los cuatro) más el ISRC y
 * la extensión de origen, que deciden si el ISRC es confiable.
 */
export type PistaParaAudio = {
  titulo: string;
  artista: string;
  album?: string;
  /** Milisegundos (0 si la fuente no lo publica). */
  duracionMs?: number;
  isrc?: string | null;
  ext?: string | null;
  /**
   * Código Premium guardado en este navegador. NO decide nada por sí solo: el
   * servidor lo verifica contra el registro y con eso elige FLAC o calidad
   * estándar. Si falta o no acredita, suena estándar.
   */
  codigo?: string | null;
  /**
   * Token de la cuenta, si hay sesión. El servidor lo verifica y, con cuenta
   * válida, no gasta el cupo de rescates por IP: la cuenta gratis promete
   * escuchar sin límite, así que la red no puede cortarle la música.
   */
  token?: string | null;
  /**
   * Canales que ya fallaron en este navegador para esta pista. El servidor
   * devuelve otro enlace en vez de repetir el que no abrió.
   */
  evitar?: string[];
};

export type AudioRescatado = {
  url: string;
  /** Segundos. */
  duracion: number;
  /** "stash-relay" = FLAC completo; "youtube" = audio completo vía backend local. */
  canal?: "monochrome" | "stash-relay" | "bandcamp" | "youtube";
  proveedor?: string;
  isrc?: string | null;
};

export type RespuestaBusqueda = {
  origen: "extension" | "respaldo";
  items: Item[];
  aviso?: string;
  limitado?: boolean;
  /**
   * Fuente que EFECTIVAMENTE contestó. Puede no ser la elegida: el servidor
   * elige otra cuando la pedida falla o no trae nada (ver `buscarConFailover`).
   */
  fuente?: string;
};

type Sesion = { id: string; privada: CryptoKey; publica: JsonWebKey; servidor: JsonWebKey | null; clave: CryptoKey | null };

type CargaSesion = { sesion: string; publica: JsonWebKey; cifrado: Cifrado };

let sesion: Sesion | null = null;

async function prepararSesion(): Promise<Sesion> {
  if (sesion) return sesion;
  const par = await generarPar();
  sesion = { id: crypto.randomUUID(), privada: par.privada, publica: par.jwk, servidor: null, clave: null };
  return sesion;
}

async function claveDeSesion(s: Sesion): Promise<CryptoKey> {
  if (s.clave) return s.clave;
  if (!s.servidor) s.servidor = (await demoClave()) as JsonWebKey;
  s.clave = await derivarClave(s.privada, await importarPublica(s.servidor));
  return s.clave;
}

function renovarSesion() {
  sesion = null;
}

async function sellar(objeto: unknown): Promise<{ carga: CargaSesion; clave: CryptoKey }> {
  const s = await prepararSesion();
  const clave = await claveDeSesion(s);
  return { carga: { sesion: s.id, publica: s.publica, cifrado: await cifrar(clave, JSON.stringify(objeto)) }, clave };
}

async function abrirRespuesta<T>(clave: CryptoKey, respuesta: Cifrado): Promise<T> {
  return JSON.parse(await descifrar(clave, respuesta)) as T;
}

/** Busca en una extensión; si no puede responder, trae el catálogo de respaldo. */
export async function buscarDemo(opts: {
  consulta: string;
  ext: ExtensionId;
  filtro: string | null;
  limite?: number;
}): Promise<RespuestaBusqueda> {
  const peticion = {
    consulta: opts.consulta,
    ext: opts.ext,
    filtro: opts.filtro,
    limite: opts.limite ?? 12,
  };

  let intento = 0;
  for (;;) {
    try {
      const { carga, clave } = await sellar(peticion);
      const respuesta = (await demoBuscar({ data: carga })) as Cifrado;
      return await abrirRespuesta<RespuestaBusqueda>(clave, respuesta);
    } catch (e) {
      intento++;
      if (intento > 1) throw e;
      renovarSesion();
    }
  }
}

/**
 * Techo de espera del rescate.
 *
 * El servidor puede tardar 30-50 s en el nicho (host de YouTube dormido +
 * extracción en frío). Pasado este techo se responde `null` en vez de dejar el
 * `await` colgado para siempre: sin esto, un worker que no contesta dejaba el
 * cargando infinito y el botón parecía muerto.
 */
const ESPERA_MAXIMA_RESCATE_MS = 90_000;

/** Resuelve la URL que suena para una pista, o `null` si ningún canal responde. */
export async function rescatarDemo(pista: PistaParaAudio): Promise<AudioRescatado | null> {
  try {
    const { carga } = await sellar(pista);
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const techo = new Promise<null>((listo) => {
      reloj = setTimeout(() => listo(null), ESPERA_MAXIMA_RESCATE_MS);
    });
    try {
      return (await Promise.race([
        demoRescatar({ data: carga }) as Promise<AudioRescatado | null>,
        techo,
      ])) as AudioRescatado | null;
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  } catch {
    return null;
  }
}

/** Letras del karaoke: metadata pública, resuelta por el servidor. */
export async function letrasDemo(peticion: PeticionLetras): Promise<Letras | null> {
  try {
    return (await demoLetras({ data: peticion })) as Letras | null;
  } catch {
    return null;
  }
}

/**
 * Abre un álbum, artista o lista y trae SUS contenidos: las canciones que
 * tiene adentro y, en un artista, también sus álbumes para seguir recorriendo.
 *
 * Los ids de cada fuente sólo existen en esa fuente, así que la petición va a
 * `opts.ext` (la que trajo el item). Si esa fuente no expone el método o la
 * colección viene vacía, el servidor contesta `items: []` y el cliente busca
 * el nombre: el comportamiento de siempre, como red de seguridad.
 */
export async function abrirDemo(opts: {
  ext: ExtensionId;
  tipo: TipoResultado;
  id: string;
}): Promise<RespuestaBusqueda> {
  const peticion = { ext: opts.ext, tipo: opts.tipo, id: opts.id };

  let intento = 0;
  for (;;) {
    try {
      const { carga, clave } = await sellar(peticion);
      const respuesta = (await demoAbrir({ data: carga })) as Cifrado;
      return await abrirRespuesta<RespuestaBusqueda>(clave, respuesta);
    } catch (e) {
      intento++;
      if (intento > 1) throw e;
      renovarSesion();
    }
  }
}
