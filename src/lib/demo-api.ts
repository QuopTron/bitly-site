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

import { demoBuscar, demoClave, demoRescatar } from "@/server/demo-proxy";
import type { Item } from "@/server/extensions";
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
};

export type AudioRescatado = {
  url: string;
  /** Segundos. */
  duracion: number;
  /** "stash-relay" = FLAC completo; "preview" = adelanto público de 30 s. */
  canal?: "stash-relay" | "preview";
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

/** Resuelve la URL que suena para una pista, o `null` si ningún canal responde. */
export async function rescatarDemo(pista: PistaParaAudio): Promise<AudioRescatado | null> {
  try {
    const { carga } = await sellar(pista);
    return (await demoRescatar({ data: carga })) as AudioRescatado | null;
  } catch {
    return null;
  }
}
