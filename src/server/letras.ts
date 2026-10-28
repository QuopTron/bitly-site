/**
 * Letras para el karaoke de la demo.
 *
 * La consulta sale del servidor: el navegador nunca habla con LRCLIB (la CSP
 * sólo permite `connect-src 'self'`), y así la clave/identidad de la pista no
 * viaja en un fetch de terceros. Se cachea por pista y se deduplica igual que
 * el rescate de audio: dos clics seguidos comparten la misma búsqueda.
 */

export type PeticionLetras = {
  titulo: string;
  artista: string;
  album?: string;
  /** Segundos, para desempatar versiones de la misma canción. */
  duracion?: number;
};

export type Letras = {
  /** Texto LRC sincronizado, si LRCLIB lo tiene. */
  lrc: string | null;
  /** Letra sin tiempos, como respaldo legible. */
  plana: string | null;
  fuente: "lrclib";
};

const LRCLIB = "https://lrclib.net/api/search";
const USER_AGENT = "bitly-site-demo/1.0 (music demo)";
const TIMEOUT_MS = 4_000;
/**
 * La PRIMERA consulta paga DNS y TLS desde el edge: en Cloudflare, con 4 s
 * muchas veces se abortaba antes de que LRCLIB contestara y el karaoke se
 * quedaba en «♪» (medido en producción: una de cada dos veces). Las variantes
 * siguientes ya van sobre la conexión abierta y les alcanza con 4 s.
 */
const TIMEOUT_PRIMERA_MS = 9_000;
/** Presupuesto total entre todas las variantes de búsqueda. */
const PRESUPUESTO_MS = 18_000;
const TTL_MS = 6 * 60 * 60 * 1000;
/** Un acierto se guarda un rato largo (la letra de una canción no cambia). */
const MAX_CACHE = 200;

type Entrada = { valor: Letras | null; expira: number };

const cache = new Map<string, Entrada>();
const enVuelo = new Map<string, Promise<Letras | null>>();

function claveDe(p: PeticionLetras): string {
  return [p.titulo, p.artista, p.album ?? "", Math.round(p.duracion ?? 0)]
    .join("|")
    .trim()
    .toLowerCase();
}

function podar() {
  if (cache.size <= MAX_CACHE) return;
  const ahora = Date.now();
  for (const [k, v] of cache) if (v.expira <= ahora) cache.delete(k);
  while (cache.size > MAX_CACHE) {
    const primera = cache.keys().next().value;
    if (primera === undefined) break;
    cache.delete(primera);
  }
}

type Candidato = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  duration?: number;
  trackName?: string;
  artistName?: string;
};

function distanciaDuracion(c: Candidato, p: PeticionLetras): number {
  const a = Number(c.duration ?? 0);
  const b = Math.round(p.duracion ?? 0);
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.abs(a - b);
}

const conSync = (c: Candidato) =>
  typeof c.syncedLyrics === "string" && /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(c.syncedLyrics);

function elegir(candidatos: Candidato[], p: PeticionLetras, soloSync = false): Candidato | null {
  const grupo = soloSync ? candidatos.filter(conSync) : candidatos.filter(
    (c) => conSync(c) || (typeof c.plainLyrics === "string" && c.plainLyrics.trim()),
  );
  if (grupo.length === 0) return null;
  return grupo
    .slice()
    .sort((a, b) => distanciaDuracion(a, p) - distanciaDuracion(b, p))[0] ?? null;
}

/** "Get Lucky (Radio Edit) [feat. X]" -> "Get Lucky": mejora el recall. */
function limpiar(texto: string): string {
  return texto
    .replace(/\((?:feat|ft|with|radio edit|remaster|deluxe|live|version)[^)]*\)/gi, " ")
    .replace(/\[(?:feat|ft|with|radio edit|remaster|deluxe|live|version)[^\]]*\]/gi, " ")
    .replace(/\s*[-–—]\s*(?:feat|ft|with|radio edit|remaster(?:ed)?|deluxe|live).*$/gi, " ")
    .replace(/\s*[-–—]\s*topic$/gi, " ")
    .replace(/\s*vevo$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function consultar(p: PeticionLetras): Promise<Letras | null> {
  const limite = Date.now() + PRESUPUESTO_MS;
  const esperar = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms));

  // Timeout POR consulta: con uno global, las variantes 3+ se abortaban antes
  // de intentarse y una canción con letra plana en la primera búsqueda podía
  // quedarse sin la versión sincronizada que sí estaba en LRCLIB.
  //
  // Reintento: LRCLIB limita por IP y un Worker de Cloudflare comparte la IP de
  // salida con miles de sitios, así que un 429 suelto no significa «esta canción
  // no tiene letra» sino «en un segundo sí» (medido en producción: la misma
  // consulta devolvía la letra a la siguiente). Un 400/404, en cambio, es la
  // consulta sin resultados y reintentarlo no cambia nada.
  const pedir = async (params: URLSearchParams, topeMs = TIMEOUT_MS): Promise<Candidato[]> => {
    for (let intento = 0; intento < 2; intento++) {
      const restante = limite - Date.now();
      if (restante < 1_000) return [];
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), Math.min(topeMs, restante));
      let reintentar = false;
      try {
        const res = await fetch(`${LRCLIB}?${params.toString()}`, {
          signal: control.signal,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (res.ok) {
          const datos = (await res.json()) as Candidato[] | Candidato;
          return Array.isArray(datos) ? datos : [datos];
        }
        reintentar = res.status === 429 || res.status >= 500;
      } catch {
        // Red cortada o timeout: un segundo intento sólo tiene sentido si el
        // presupuesto aguanta otro arranque completo.
        reintentar = true;
      } finally {
        clearTimeout(reloj);
      }
      if (!reintentar) return [];
      if (limite - Date.now() < topeMs) return [];
      await esperar(600);
    }
    return [];
  };

  {
    const titulo = p.titulo.trim();
    const artista = p.artista.trim();
    const tituloLimpio = limpiar(titulo);
    const artistaLimpio = limpiar(artista);

    // Varias estrategias, de la más precisa a la más suelta. Nunca se manda
    // `album_name`: en LRCLIB suele llevar sufijos y vuelve cero la búsqueda.
    const consultas: URLSearchParams[] = [];
    const vistas = new Set<string>();
    const agregar = (params: URLSearchParams) => {
      const clave = params.toString();
      if (vistas.has(clave)) return;
      vistas.add(clave);
      consultas.push(params);
    };

    if (artista) {
      agregar(new URLSearchParams({ track_name: titulo, artist_name: artista }));
      agregar(new URLSearchParams({ q: `${artista} ${titulo}` }));
    }
    if (tituloLimpio && (tituloLimpio !== titulo || artistaLimpio !== artista)) {
      if (artistaLimpio) {
        agregar(new URLSearchParams({ track_name: tituloLimpio, artist_name: artistaLimpio }));
        agregar(new URLSearchParams({ q: `${artistaLimpio} ${tituloLimpio}` }));
      }
      agregar(new URLSearchParams({ track_name: tituloLimpio }));
      agregar(new URLSearchParams({ q: tituloLimpio }));
    }
    // Último intento sin artista: hay fuentes que lo devuelven vacío o con
    // variantes ("Daft Punk, Pharrell…") que no matchean el campo exacto.
    agregar(new URLSearchParams({ track_name: titulo }));
    agregar(new URLSearchParams({ q: titulo }));

    let plana: Candidato | null = null;
    for (const [i, params] of consultas.entries()) {
      if (Date.now() >= limite) break;
      const lista = await pedir(params, i === 0 ? TIMEOUT_PRIMERA_MS : TIMEOUT_MS);
      if (lista.length === 0) continue;

      // La primera búsqueda que devuelva letra SINCRONIZADA gana: es la que
      // permite el karaoke con tiempos. Si sólo hay letra plana, se sigue
      // probando y se guarda como último recurso.
      const sincronizada = elegir(lista, p, true);
      if (sincronizada) {
        return {
          lrc: sincronizada.syncedLyrics ?? null,
          plana: sincronizada.plainLyrics ?? null,
          fuente: "lrclib",
        };
      }
      if (!plana) plana = elegir(lista, p);
    }

    if (!plana) return null;
    return {
      lrc: null,
      plana: plana.plainLyrics ?? null,
      fuente: "lrclib",
    };
  }
}

/** Devuelve letras (sincronizadas o planas) o `null`; nunca lanza. */
export async function letrasImpl(p: PeticionLetras): Promise<Letras | null> {
  const titulo = (p?.titulo ?? "").trim();
  const artista = (p?.artista ?? "").trim();
  if (!titulo) return null;

  const peticion: PeticionLetras = {
    titulo,
    artista,
    album: (p.album ?? "").trim(),
    duracion: Math.max(0, Math.round(p.duracion ?? 0)),
  };
  const clave = claveDe(peticion);

  const cacheada = cache.get(clave);
  if (cacheada && cacheada.expira > Date.now()) return cacheada.valor;

  const enCurso = enVuelo.get(clave);
  if (enCurso) return enCurso;

  const tarea = consultar(peticion)
    .then((valor) => {
      // Un fallo NO se guarda: LRCLIB contesta 429 por IP compartida y el
      // karaoke reintenta tres veces en dos segundos. Con el fallo cacheado
      // esos reintentos contestaban al instante lo mismo y el «♪» se quedaba
      // toda la sesión; sin caché el reintento vuelve a preguntar de verdad.
      if (valor) cache.set(clave, { valor, expira: Date.now() + TTL_MS });
      podar();
      return valor;
    })
    .finally(() => {
      if (enVuelo.get(clave) === tarea) enVuelo.delete(clave);
    });

  enVuelo.set(clave, tarea);
  return tarea;
}
