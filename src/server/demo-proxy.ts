/**
 * Proxy cifrado de la demo.
 *
 * Las server functions de acá son la ÚNICA puerta entre la landing y las
 * extensiones: el navegador nunca recibe el código de las extensiones ni
 * habla con los catálogos directamente. Tres reglas:
 *
 *  1. CIFRADO. La consulta viaja cifrada con ECDH P-256 + AES-256-GCM
 *     (ver `src/lib/demo-crypto.ts`): TLS sigue siendo la capa de transporte,
 *     esto evita que la búsqueda se lea en un registro o en un interceptor de
 *     aplicación. La respuesta vuelve cifrada con la misma clave.
 *  2. RESPALDO. Si la extensión no responde (fuente caída, sin credenciales,
 *     sin búsqueda — Pandora—, geo-bloqueo —Amazon—), el resultado viene del
 *     catálogo público de respaldo y se marca `origen: "respaldo"`. Y si el
 *     respaldo tampoco tiene la canción, la busca el backend local de yt-dlp
 *     en YouTube (habilitado con `YT_DLP_BACKEND_URL`): folklore de nicho y
 *     re-subidos siguen siendo encontrables, no "sin resultados".
 *  3. CUPO. Búsquedas por minuto por IP: la demo no puede ser un proxy
 *     abierto contra los catálogos de terceros.
 *
 * 4. AUDIO. `demoRescatar` resuelve la URL que suena: identifica la pista con
 *    el matching del backend (ISRC verificado o ranking por nombre) y le pide
 *    el FLAC al relay de stash; si ese canal no responde, pide el audio completo
 *    al backend local de yt-dlp (`YT_DLP_BACKEND_URL`); sin backend, la pista
 *    queda sin audio —nunca un adelanto de 30 s—. Los bytes FLAC bajan del CDN
 *    por HTTPS; los del canal YouTube pasan por el proxy del backend local.
 * 5. CONTENIDOS. `demoAbrir` abre un álbum, artista o lista y devuelve SUS
 *    canciones (y en un artista, también sus álbumes): la colección viaja
 *    cifrada igual que la búsqueda. Si la fuente no sabe recorrerla, la
 *    respuesta queda vacía y el cliente cae a buscar por nombre.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  buscarEnExtension,
  buscarRespaldo,
  llamarExtension,
  normalizarItems,
} from "@/server/extensions";
import { fieldScore, filtrarOriginales, splitSearchQuery } from "@/server/matching";
import { buscarYouTubeBackend, despertarCanalYouTube, resolverAudio, type PeticionAudio } from "@/server/rescate";
import { esCodigoPremiumActivo } from "@/lib/premium-check";
import { letrasImpl, type Letras, type PeticionLetras } from "@/server/letras";
import { obtenerIPCliente } from "@/server/ip";
import { EXTENSIONES, categoriaDeFiltro, type ExtensionId } from "@/lib/demo-extensiones";
import type { Item, TipoResultado } from "@/server/extensions";
import {
  cifrar,
  descifrar,
  derivarClave,
  generarPar,
  importarPublica,
  type Cifrado,
} from "@/lib/demo-crypto";

/* ── Clave efímera del servidor (una por proceso) ────────────────── */

type ParServidor = { privada: CryptoKey; publica: JsonWebKey };

let parGuardado: Promise<ParServidor> | null = null;

function parDelServidor(): Promise<ParServidor> {
  if (!parGuardado) parGuardado = generarPar().then((p) => ({ privada: p.privada, publica: p.jwk }));
  return parGuardado;
}

/** Clave pública del servidor: el cliente la pide una vez por sesión. */
export async function claveImpl(): Promise<JsonWebKey> {
  return (await parDelServidor()).publica;
}

export const demoClave = createServerFn({ method: "POST" }).handler(
  async (): Promise<JsonWebKey> => claveImpl(),
);

/* ── Cupo ────────────────────────────────────────────────────────── */

const VENTANA_MS = 60_000;

/**
 * Contador por ventana deslizante de un minuto, por IP y global. Se usan dos
 * instancias: la búsqueda y el rescate de audio (el relay de stash es
 * infraestructura de un tercero con cupos diarios, así que la landing no puede
 * ser un consumidor ilimitado).
 */
function crearCupo(maxPorIp: number, maxGlobal: number) {
  const porIp = new Map<string, { n: number; t: number }>();
  const global = { n: 0, t: 0 };
  return function dentroDe(clave: string): boolean {
    const ahora = Date.now();
    if (ahora - global.t > VENTANA_MS) {
      global.t = ahora;
      global.n = 0;
    }
    if (++global.n > maxGlobal) return false;

    const previo = porIp.get(clave);
    if (!previo || ahora - previo.t > VENTANA_MS) {
      porIp.set(clave, { n: 1, t: ahora });
      return true;
    }
    previo.n++;
    if (previo.n > maxPorIp) return false;
    if (porIp.size > 500) porIp.clear();
    return true;
  };
}

const dentroDeCupo = crearCupo(12, 150);
/** El rescate es más caro (mint firmado) y tiene caché, así que su techo es menor. */
const dentroDeCupoRescate = crearCupo(20, 240);
/** Letras: una consulta por pista a LRCLIB; sin cupo era un proxy abierto. */
const dentroDeCupoLetras = crearCupo(30, 200);

async function quienSolicita(): Promise<string> {
  return obtenerIPCliente();
}

/* ── Contrato cifrado ────────────────────────────────────────────── */

/** Lo que el cliente cifra antes de llamar. */
export type Carga = { sesion: string; publica: JsonWebKey; cifrado: Cifrado };

type PeticionBusqueda = {
  consulta: string;
  ext: string;
  filtro: string | null;
  limite: number;
};

/**
 * Filtro de relevancia del LISTADO, igual que el de la app
 * (`filtrarOriginales` con la consulta partida por `splitSearchQuery`): los
 * tracks que no se relacionan con lo pedido se van y las versiones no
 * originales quedan al final.
 *
 * Primera desviación deliberada de la app: si el filtro dejaría el marco SIN
 * ningún track habiendo tracks, se devuelve el orden de la fuente. La app no
 * necesita esta red porque ahí el usuario pide una CANCIÓN; esta caja también
 * busca "jazz" o "guitarra" (las sugerencias del marco), y quedarse sin
 * resultados no sería una mejora sino un buscador roto. La segunda desviación
 * está en `priorizarArtistaElegido`.
 */
function ordenarResultados(items: Item[], consulta: string): Item[] {
  const { title, artist } = splitSearchQuery(consulta);
  if (!title) return items;
  const filtrados = filtrarOriginales(items, title, artist);
  const tracksAntes = items.filter((i) => i.tipo === "track").length;
  const tracksDespues = filtrados.filter((i) => i.tipo === "track").length;
  if (tracksAntes > 0 && tracksDespues === 0) return items;
  return priorizarArtistaElegido(filtrados, consulta);
}

/**
 * Segunda desviación deliberada, y la que hace que el clic sirva.
 *
 * Cuando la consulta es un bloque sin separador ("get lucky daft punk"),
 * `splitSearchQuery` deja TODO el texto como título y el artista vacío. Con el
 * artista vacío, `fieldScorePre` no da evidencia de artista a nadie, y el título
 * largo de la grabación real PIERDE contra el de un tributo: la canción de Deezer
 * "Get Lucky (feat. Pharrell Williams and Nile Rodgers)" pliega a "get lucky
 * pharrell williams and nile rodgers" (0 de puntaje contra la consulta), mientras
 * que el cover "Get Lucky" de un grupo tributo es subcadena de la consulta y saca
 * 2 — así que el tributo queda PRIMERO y el clic reproduce el tributo. Verificado
 * contra el propio backend Go: su `filtrarOriginales` devuelve ese mismo orden.
 *
 * Acá se corrige SIN tocar el port (`matching.ts` sigue idéntico a la app): solo
 * se adelantan los tracks cuyo ARTISTA aparece literalmente en la consulta, que es
 * la señal que el usuario dio y que el filtro por título no pudo ver. El resto
 * conserva su orden relativo y los no-tracks siguen primero. Si nadie del listado
 * acredita al artista, no se toca nada ("jazz" o "guitarra" quedan igual).
 */
function priorizarArtistaElegido(items: Item[], consulta: string): Item[] {
  const tracks = items.filter((i) => i.tipo === "track");
  const conArtista = tracks
    .map((it, idx) => ({ it, idx, score: fieldScore(consulta, it.artista) }))
    .filter((c) => c.score >= 1);
  if (conArtista.length === 0) return items;

  // Mejor primero y, a igual puntaje, el artista MÁS CORTO: "Daft Punk" es la
  // grabación pedida y "Daft Punk Experience" un tributo que la contiene.
  conArtista.sort(
    (a, b) => b.score - a.score || a.it.artista.length - b.it.artista.length || a.idx - b.idx,
  );
  const elegidos = new Set(conArtista.map((c) => c.it));
  return [
    ...items.filter((i) => i.tipo !== "track"),
    ...conArtista.map((c) => c.it),
    ...tracks.filter((t) => !elegidos.has(t)),
  ];
}

/* ── Elección de fuente (failover) ───────────────────────────────── */

/**
 * Tope por fuente: una extensión colgada no puede frenar a las demás ni dejar
 * la búsqueda esperando. Es más corto que el techo interno del runtime (20 s)
 * porque acá hay varias corriendo a la vez.
 */
const TIMEOUT_FUENTE_MS = 11_000;

/**
 * Fuentes que se prueban cuando la elegida falla, en orden de confiabilidad
 * medida. Es corta a propósito: probar las 8 multiplicaría el costo por
 * búsqueda sin mejorar la tasa de acierto.
 */
const FUENTES_ALTERNATIVAS: ExtensionId[] = ["deezer", "spotify-web", "qobuz-web", "soundcloud"];

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, mal) => {
    const reloj = setTimeout(() => mal(new Error("la fuente tardó demasiado")), ms);
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

/**
 * Filtro EQUIVALENTE de [ext] para la categoría que pidió el usuario. El id del
 * filtro es vocabulario de cada manifest (Deezer declara "track", Spotify
 * "tracks"): reenviar el de la fuente original a otra devolvía vacío sin error.
 */
function filtroEquivalente(ext: string, filtro: string | null): string | null {
  const cat = filtro ? categoriaDeFiltro(filtro) : null;
  if (!cat) return null;
  const destino = EXTENSIONES.find((e) => e.id === ext);
  return destino?.filtros.find((f) => categoriaDeFiltro(f.id) === cat)?.id ?? null;
}

/** Busca en una fuente y deja el listado ya ordenado por relevancia. */
async function buscarFuente(
  sesion: string,
  ext: string,
  consulta: string,
  filtro: string | null,
  limite: number,
): Promise<Item[]> {
  const items = await conTimeout(
    buscarEnExtension({ sesion, ext, consulta, filtro, limite }),
    TIMEOUT_FUENTE_MS,
  );
  return ordenarResultados(items, consulta);
}

/**
 * Resuelve con el PRIMER resultado no vacío y `null` si todas fallan o vienen
 * vacías. Se esperan todas en paralelo: descartar una vacía no cuesta una ronda
 * de red extra (que es justo el tiempo que el failover tiene que ahorrar).
 */
function primeraConResultados(
  carreras: Array<{ ext: string; promesa: Promise<Item[]> }>,
): Promise<{ items: Item[]; ext: string } | null> {
  return new Promise((listo) => {
    if (carreras.length === 0) return listo(null);
    let faltan = carreras.length;
    let terminado = false;
    const fin = (v: { items: Item[]; ext: string } | null) => {
      faltan--;
      if (terminado) return;
      if (v && v.items.length > 0) {
        terminado = true;
        listo(v);
        return;
      }
      if (faltan === 0) {
        terminado = true;
        listo(null);
      }
    };
    for (const c of carreras) {
      c.promesa.then((items) => fin({ items, ext: c.ext }), () => fin(null));
    }
  });
}

/** Resultado de elegir fuente: los items, quién los trajo y si hubo que cambiar. */
type Hallazgo = { items: Item[]; fuente: string; cambio: boolean };

/**
 * Elige la fuente con criterio: primero la ELEGIDA y, si falla o no trae nada
 * (fuente caída, geo-bloqueada, sin credenciales o simplemente sin resultados),
 * las alternativas EN PARALELO — gana la primera que traiga algo. Así una fuente
 * rota no deja la búsqueda en blanco ni obliga a probar una por una.
 */
async function buscarConFailover(
  sesion: string,
  consulta: string,
  ext: string,
  filtro: string | null,
  limite: number,
): Promise<Hallazgo | null> {
  try {
    const items = await buscarFuente(sesion, ext, consulta, filtro, limite);
    if (items.length > 0) return { items, fuente: ext, cambio: false };
  } catch {
    // Cae a las alternativas: el motivo no le sirve al usuario, la fuente nueva sí.
  }

  const otras = FUENTES_ALTERNATIVAS.filter((e) => e !== ext);
  const ganadora = await primeraConResultados(
    otras.map((e) => ({
      ext: e,
      promesa: buscarFuente(sesion, e, consulta, filtroEquivalente(e, filtro), limite).catch(
        () => [] as Item[],
      ),
    })),
  );
  if (!ganadora) return null;

  // Se devuelve QUIÉN contestó: la interfaz lo dice en vez de fingir que la
  // fuente elegida funcionó.
  return { items: ganadora.items, fuente: ganadora.ext, cambio: true };
}

async function abrir(carga: Carga): Promise<{ sesion: string; texto: string }> {
  const par = await parDelServidor();
  const publicaAjena = await importarPublica(carga.publica);
  const clave = await derivarClave(par.privada, publicaAjena);
  const texto = await descifrar(clave, carga.cifrado);
  return { sesion: carga.sesion, texto };
}

/** Cifra una respuesta con la misma clave que descifró la petición. */
async function cerrar(carga: Carga, objeto: unknown): Promise<Cifrado> {
  const par = await parDelServidor();
  const publicaAjena = await importarPublica(carga.publica);
  const clave = await derivarClave(par.privada, publicaAjena);
  return cifrar(clave, JSON.stringify(objeto));
}

/* ── Búsqueda ────────────────────────────────────────────────────── */

export const demoBuscar = createServerFn({ method: "POST" })
  .validator((d: Carga) => d)
  .handler(async ({ data }): Promise<Cifrado> => buscarImpl(data));

/**
 * Núcleo de la búsqueda (exportado para `scripts/probar-proxy.mjs`, que corre
 * el contrato cifrado fuera del navegador; en producción lo cubre la server
 * function de arriba).
 */
export async function buscarImpl(carga: Carga): Promise<Cifrado> {
  let peticion: PeticionBusqueda;
  let data = carga;
  try {
    const abierta = await abrir(data);
    peticion = JSON.parse(abierta.texto) as PeticionBusqueda;
    data = { ...data, sesion: abierta.sesion };
  } catch {
    return cerrar(data, { origen: "respaldo", items: [], aviso: "clave" });
  }

  const cupo = dentroDeCupo(await quienSolicita());
  if (!cupo) {
    return cerrar(data, { origen: "respaldo", items: [], limitado: true });
  }

  const consulta = peticion.consulta.trim().slice(0, 120);
  const limite = Math.max(1, Math.min(24, peticion.limite || 12));
  if (!consulta) return cerrar(data, { origen: "respaldo", items: [] });

  let items: Item[] = [];
  let aviso: string | undefined;
  let fuente: string | undefined;

  try {
    const hallazgo = await buscarConFailover(
      data.sesion,
      consulta,
      peticion.ext,
      peticion.filtro,
      limite,
    );
    if (hallazgo) {
      items = hallazgo.items;
      fuente = hallazgo.fuente;
      // La elegida no respondió y contestó otra: la interfaz lo avisa en vez de
      // mostrar los resultados como si fueran de la fuente pedida.
      if (hallazgo.cambio) aviso = "fuente";
    }
  } catch (e) {
    aviso = String((e as Error)?.message ?? e).slice(0, 200);
  }

  if (items.length > 0) {
    return cerrar(data, { origen: "extension", items, aviso, fuente });
  }

  try {
    items = await buscarRespaldo(consulta, peticion.filtro, limite);
    items = ordenarResultados(items, consulta);
  } catch {
    items = [];
    aviso = aviso ?? "respaldo";
  }

  // Último respaldo: el backend local de yt-dlp busca en YouTube. Así una
  // canción que ningún catálogo indexa (folklore de nicho, re-subidos) sigue
  // siendo encontrable —y reproducible—, en vez de quedar "sin resultados".
  if (items.length === 0) {
    const yt = await buscarYouTubeBackend(consulta, limite);
    if (yt && yt.length > 0) return cerrar(data, { origen: "respaldo", items: yt, aviso, fuente });
  }
  // El catálogo de respaldo ES Deezer: decirlo hace dos cosas a la vez: la
  // interfaz etiqueta cada pista con `ext: "deezer"` —así su ISRC, que solo
  // Deezer publica, se usa como identidad autoritativa al rescatar— y al abrir
  // un álbum o artista de estos resultados la petición va a la fuente que
  // realmente los trajo.
  return cerrar(data, { origen: "respaldo", items, aviso, fuente: items.length > 0 ? "deezer" : fuente });
}

/* ── Apertura de contenidos (álbum, artista, lista) ──────────────── */

type PeticionApertura = {
  /** Fuente que trajo el item a abrir: sus ids sólo existen ahí. */
  ext: string;
  tipo: TipoResultado;
  id: string;
};

/** Método que cada extensión expone para recorrer su colección. */
const METODO_APERTURA: Partial<Record<TipoResultado, string>> = {
  album: "getAlbum",
  artist: "getArtist",
  playlist: "getPlaylist",
};

/**
 * Canciones que contiene lo que devolvió la extensión.
 *
 * Cada fuente devuelve su colección con un shape propio: `getAlbum` y
 * `getPlaylist` traen `tracks`; `getArtist` trae `top_tracks` + `albums`
 * (Spotify y Amazon, además, `releases`; Qobuz y TIDAL sólo `albums`).
 * Los álbumes que vienen DENTRO de un artista se marcan como `album` a mano:
 * varias fuentes no les ponen `item_type` y el normalizador los convertiría
 * en canciones —una fila que al tocarla intentaría sonar un álbum entero.
 */
function contenidoItemsDe(crudo: unknown, tipo: TipoResultado): Item[] {
  if (!crudo) return [];
  if (Array.isArray(crudo)) return normalizarItems(crudo);
  if (typeof crudo !== "object") return [];
  const o = crudo as Record<string, unknown>;

  if (tipo === "artist") {
    const pistas = normalizarItems(Array.isArray(o.top_tracks) ? o.top_tracks : [], "track");
    const discosCrudos =
      Array.isArray(o.albums) && o.albums.length > 0
        ? o.albums
        : Array.isArray(o.releases)
          ? o.releases
          : [];
    const discos = normalizarItems(discosCrudos).map((i) => ({ ...i, tipo: "album" as const }));
    return [...pistas, ...discos];
  }

  const filas = [o.tracks, o.track_list].find(Array.isArray);
  return filas ? normalizarItems(filas, "track") : [];
}

export const demoAbrir = createServerFn({ method: "POST" })
  .validator((d: Carga) => d)
  .handler(async ({ data }): Promise<Cifrado> => abrirContenidoImpl(data));

/**
 * Núcleo de la apertura de contenidos (exportado para los scripts de prueba,
 * igual que `buscarImpl`).
 *
 * Nunca lanza: si la fuente no expone el método o la colección viene vacía,
 * devuelve `items: []` y el cliente busca el nombre —el paso previo a esta
 * función, que sigue funcionando como red de seguridad.
 */
export async function abrirContenidoImpl(carga: Carga): Promise<Cifrado> {
  let peticion: PeticionApertura;
  let data = carga;
  try {
    const abierta = await abrir(data);
    peticion = JSON.parse(abierta.texto) as PeticionApertura;
    data = { ...data, sesion: abierta.sesion };
  } catch {
    return cerrar(data, { origen: "extension", items: [], aviso: "clave" });
  }

  if (!dentroDeCupo(await quienSolicita())) {
    return cerrar(data, { origen: "extension", items: [], limitado: true });
  }

  const metodo = METODO_APERTURA[peticion.tipo];
  const id = (peticion.id ?? "").trim().slice(0, 120);
  if (!metodo || !id) return cerrar(data, { origen: "extension", items: [] });

  try {
    const crudo = await conTimeout(
      llamarExtension({ sesion: data.sesion, ext: peticion.ext, metodo, args: [id] }),
      TIMEOUT_FUENTE_MS,
    );
    const items = contenidoItemsDe(crudo, peticion.tipo).slice(0, 30);
    return cerrar(data, { origen: "extension", items, fuente: peticion.ext });
  } catch (e) {
    return cerrar(data, {
      origen: "extension",
      items: [],
      aviso: String((e as Error)?.message ?? e).slice(0, 200),
    });
  }
}

/* ── Audio ───────────────────────────────────────────────────────── */

type RespuestaAudio = {
  url: string;
  duracion: number;
  canal: "monochrome" | "stash-relay" | "youtube";
  proveedor: string;
  id: string | null;
  isrc: string | null;
  bitDepth?: number;
  sampleRate?: number;
} | null;

/**
 * Núcleo del rescate (exportado para `scripts/probar-proxy.mjs`): abre la
 * petición cifrada y le pide el audio a `@/server/rescate`. Nunca lanza; un
 * fallo del canal es `null` y la interfaz lo muestra.
 */
export async function rescatarImpl(data: Carga): Promise<RespuestaAudio> {
  let peticion: PeticionAudio;
  try {
    const abierta = await abrir(data);
    peticion = JSON.parse(abierta.texto) as PeticionAudio;
  } catch {
    return null;
  }
  if (!peticion?.titulo) return null;
  if (!dentroDeCupoRescate(await quienSolicita())) return null;

  // La calidad la decide ACÁ, no el navegador: se verifica el código Premium
  // que mandó el cliente contra el registro (con caché corta). Sin código
  // activo —cuenta gratis, invitado o un código caducado— va calidad estándar;
  // así cambiar el JSON de la petición no sirve para llevarse el FLAC.
  const premium = await esCodigoPremiumActivo(peticion.codigo);

  // En YouTube Music el id del item ES el videoId de YouTube. Se marca acá para
  // que el rescate vaya derecho a ese video: en artistas de nicho (bandcamp,
  // huayño, re-subidos) buscar por nombre no siempre lo encuentra.
  const idFuente = typeof peticion.id === "string" ? peticion.id.trim() : "";
  const videoId =
    peticion.ext === "ytmusic-spotiflac" && /^[A-Za-z0-9_-]{11}$/.test(idFuente) ? idFuente : null;

  peticion = { ...peticion, calidad: premium ? "flac" : "estandar", videoId };

  try {
    return await resolverAudio(peticion);
  } catch {
    return null;
  }
}

export const demoRescatar = createServerFn({ method: "POST" })
  .validator((d: Carga) => d)
  .handler(async ({ data }): Promise<RespuestaAudio> => rescatarImpl(data));

/**
 * Despertador del backend propio.
 *
 * El modal de la demo lo llama al montar: si el backend vive en un host free
 * que se apaga por inactividad, el arranque (30 a 60 s) ocurre mientras el
 * visitante busca o elige una canción, no cuando ya tocó "play". Devuelve si
 * quedó despierto; el cliente no espera la respuesta para nada.
 *
 * Tiene cupo por IP: el ping es barato, pero un endpoint sin freno es un
 * endpoint para martillar un host ajeno.
 */
const calentadas = new Map<string, { n: number; t: number }>();
const CALENTAR_VENTANA_MS = 10 * 60 * 1000;
const CALENTAR_MAX = 5;

function puedeCalentar(ip: string): boolean {
  const ahora = Date.now();
  const previo = calentadas.get(ip);
  if (!previo || ahora - previo.t > CALENTAR_VENTANA_MS) {
    calentadas.set(ip, { n: 1, t: ahora });
    if (calentadas.size > 500) calentadas.clear();
    return true;
  }
  if (previo.n >= CALENTAR_MAX) return false;
  previo.n++;
  return true;
}

export const demoDespertar = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ despierto: boolean }> => {
    if (!puedeCalentar(await quienSolicita())) return { despierto: false };
    return { despierto: await despertarCanalYouTube() };
  },
);

/**
 * Letras para el karaoke. Es metadata, no audio: no hace falta cifrarla y la
 * llamada a LRCLIB la hace el servidor (la CSP del navegador no la permite).
 */
export const demoLetras = createServerFn({ method: "POST" })
  .validator((d: PeticionLetras) => d)
  .handler(async ({ data }): Promise<Letras | null> => {
    if (!dentroDeCupoLetras(await quienSolicita())) return null;
    return letrasImpl(data);
  });
