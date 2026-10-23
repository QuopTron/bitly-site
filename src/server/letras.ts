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
/** Presupuesto total entre todas las variantes de búsqueda. */
const PRESUPUESTO_MS = 10_000;
const TTL_MS = 6 * 60 * 60 * 1000;
/** Un fallo suele ser transitorio (LRCLIB lento o rate-limit): se recuerda
 *  muy poco para que el siguiente clic/reintento pueda encontrar la letra. */
const TTL_FALLO_MS = 20 * 1000;
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

  // Timeout POR consulta: con uno global, las variantes 3+ se abortaban antes
  // de intentarse y una canción con letra plana en la primera búsqueda podía
  // quedarse sin la versión sincronizada que sí estaba en LRCLIB.
  const pedir = async (params: URLSearchParams): Promise<Candidato[]> => {
    const restante = limite - Date.now();
    if (restante <= 0) return [];
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), Math.min(TIMEOUT_MS, restante));
    try {
      const res = await fetch(`${LRCLIB}?${params.toString()}`, {
        signal: control.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) return [];
      const datos = (await res.json()) as Candidato[] | Candidato;
      return Array.isArray(datos) ? datos : [datos];
    } catch {
      return [];
    } finally {
      clearTimeout(reloj);
    }
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
    for (const params of consultas) {
      if (Date.now() >= limite) break;
      const lista = await pedir(params);
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
      cache.set(clave, {
        valor,
        expira: Date.now() + (valor ? TTL_MS : TTL_FALLO_MS),
      });
      podar();
      return valor;
    })
    .finally(() => {
      if (enVuelo.get(clave) === tarea) enVuelo.delete(clave);
    });

  enVuelo.set(clave, tarea);
  return tarea;
}
