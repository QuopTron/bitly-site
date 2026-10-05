/**
 * Matching de canciones: port fiel del backend Go de la app
 * (`go_backend/internal/provider/matching_*.go`).
 *
 * Por qué está acá: la app no reproduce "lo primero que devuelve la búsqueda".
 * Títulos como "La Bachata" existen decenas de veces (el original, el en vivo,
 * el cover, el karaoke, la toma de otro disco, el re-subido de un canal) y la
 * única forma de servir la grabación pedida es comparar campos con la MISMA
 * regla en todas las fuentes. Ese es este módulo: normalizar (plegar) títulos y
 * artistas, reconocer marcadores de versión no original, puntuar cada campo y
 * rankear candidatos, con desempate por álbum y duración y con la autoridad del
 * ISRC según el proveedor.
 *
 * Qué se usa para qué (igual que en el backend):
 *   · `filtrarOriginales`        → LISTADO de búsqueda (ordena y descarta ruido).
 *   · `bestOriginalAlbumDuracion`→ RESOLUCIÓN: elegir UNA canción (la que suena).
 *   · `esProveedorAutoritativoISRC` → ¿de este proveedor se puede creer el ISRC?
 *
 * Fidelidad: cada función dice a qué archivo Go corresponde. Las reglas —umbrales
 * 3/2/1, 0.85/0.6 de solapamiento, tolerancia de duración 25% o 20 s, el veto del
 * "artista de versión", los marcadores que solo cuentan si la consulta no los
 * trae— están copiadas tal cual, sin reinterpretarlas.
 */

/** Resultado de una fuente, con lo mínimo que necesita el matching. */
export type TrackResult = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  /** Milisegundos (0 = la fuente no lo publica). */
  durationMs: number;
  isrc: string;
  provider: string;
};

/* ── Plegado (matching_fold.go) ──────────────────────────────────── */

/** Palabras de ruido que se descartan al plegar (no identifican la grabación). */
const noiseWords = new Set([
  "official", "video", "audio", "lyrics", "lyric",
  "hd", "4k", "remaster", "remastered", "version",
  "feat", "featuring", "ft", "with", "album",
  "single", "ep",
]);

/** Acentos que rompen la comparación ("Puñaladas" == "Punaladas"). */
const acentos: Record<string, string> = {
  "á": "a", "à": "a", "ä": "a", "â": "a", "ã": "a", "å": "a",
  "é": "e", "è": "e", "ë": "e", "ê": "e",
  "í": "i", "ì": "i", "ï": "i", "î": "i",
  "ó": "o", "ò": "o", "ö": "o", "ô": "o", "õ": "o",
  "ú": "u", "ù": "u", "ü": "u", "û": "u",
  "ñ": "n", "ç": "c",
};

function soloASCII(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

/**
 * Pliega un texto para comparar: minúsculas, sin acentos, sin marcas
 * combinantes (NFC/NFD dan el mismo pliegue) y sin las palabras de ruido.
 * Deja letras y dígitos separados por un solo espacio.
 */
export function foldTrack(s: string): string {
  let s2 = s.toLowerCase();
  if (!soloASCII(s2)) {
    let out = "";
    for (const ch of s2) out += acentos[ch] ?? ch;
    s2 = out;
  }

  const partes: string[] = [];
  let actual = "";
  let saltado = false;
  for (const r of s2) {
    if (/\p{Mn}/u.test(r)) {
      if (actual !== "") saltado = true;
      continue;
    }
    if (/[\p{L}\p{Nd}]/u.test(r)) {
      actual += r;
      continue;
    }
    if (actual !== "") {
      partes.push(saltado ? actual.replace(/\p{Mn}/gu, "") : actual);
      actual = "";
      saltado = false;
    }
  }
  if (actual !== "") partes.push(saltado ? actual.replace(/\p{Mn}/gu, "") : actual);

  return partes.filter((p) => p !== "" && !noiseWords.has(p)).join(" ");
}

/**
 * Normaliza un título para buscar MARCADORES de versión: minúsculas, sin
 * acentos, separadores a espacio, pero SIN quitar palabras (a diferencia de
 * `foldTrack`: "version" es palabra de ruido y el marcador nunca aparecería).
 * Solo conserva a-z y 0-9.
 */
export function tituloParaMarcadores(s: string): string {
  let s2 = s.toLowerCase();
  if (!soloASCII(s2)) {
    let out = "";
    for (const ch of s2) out += acentos[ch] ?? ch;
    s2 = out;
  }
  let out = "";
  for (const r of s2) {
    if ((r >= "a" && r <= "z") || (r >= "0" && r <= "9")) out += r;
    else if (!out.endsWith(" ")) out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Marcadores de una versión que NO es el corte original de estudio. Los de una
 * palabra se comparan por palabra completa (con substring, "live" marcaba
 * "Alive" y "cover" marcaba "Discover"); los de varias, como subcadena.
 */
const nonOriginalMarkers = [
  // Inglés (base histórica)
  "remix", "live", "cover", "acoustic", "karaoke", "instrumental",
  "sped up", "spedup", "slowed", "acapella", "orchestral", "tribute",
  "orchestra", "piano", "string quartet", "choir",
  "extended", "rework", "remake", "nightcore", "dance edit", "radio edit",
  "club mix", "dub mix", "disco edit", "reprise",
  // Español / portugués (el repertorio que más se pide en LATAM)
  "en vivo", "ao vivo", "en directo", "en directo desde", "en concierto",
  "acustico", "acustica", "version", "vivo desde",
  // Ediciones y remezclas modernas (YouTube/TikTok)
  "edit", "flip", "bootleg", "mashup", "refix", "vip",
  // Efectos y derivados de re-subida
  "reverb", "8d audio", "bass boosted", "phonk", "demo", "alternate",
];

/** ¿El marcador [m] está en [titulo] (ya pasado por `tituloParaMarcadores`)? */
function marcadorPresente(titulo: string, m: string): boolean {
  if (m.includes(" ")) return titulo.includes(m);
  return contieneTokenPalabra(titulo, m);
}

/** ¿[m] aparece como palabra completa en [titulo] (tokens a un solo espacio)? */
function contieneTokenPalabra(titulo: string, m: string): boolean {
  if (m === "") return false;
  for (let i = 0; i + m.length <= titulo.length; ) {
    const j = titulo.indexOf(m, i);
    if (j < 0) return false;
    const fin = j + m.length;
    if ((j === 0 || titulo[j - 1] === " ") && (fin === titulo.length || titulo[fin] === " ")) {
      return true;
    }
    i = j + 1;
  }
  return false;
}

/** ¿[marc] (ya normalizado) lleva algún marcador de versión? */
export function esMarcadorNoOriginal(marc: string): boolean {
  for (const m of nonOriginalMarkers) {
    if (marcadorPresente(marc, m)) return true;
  }
  return false;
}

/** ¿El título crudo indica una versión que no es el original de estudio? */
export function isNonOriginalTitle(rawTitle: string): boolean {
  return esMarcadorNoOriginal(tituloParaMarcadores(rawTitle));
}

/**
 * ¿[texto] lleva un marcador de versión que la [consulta] NO lleva? Es la regla
 * por la que "MORNING DEW (DONK) REMIX" sigue siendo el original de Beyoncé: el
 * marcador solo cuenta si el pedido no lo trae.
 */
function marcadorNoOriginalFueraDeConsulta(texto: string, consultaMarc: string): boolean {
  return marcadorNoOriginalFolded(texto, consultaMarc);
}

function marcadorNoOriginalFolded(texto: string, consultaMarc: string): boolean {
  return marcadorNoOriginalPre(tituloParaMarcadores(texto), consultaMarc);
}

function marcadorNoOriginalPre(textoMarc: string, consultaMarc: string): boolean {
  if (textoMarc === "") return false;
  for (const m of nonOriginalMarkers) {
    if (!marcadorPresente(textoMarc, m)) continue;
    if (!marcadorPresente(consultaMarc, m)) return true;
  }
  return false;
}

/**
 * ¿El candidato es una versión NO original por CUALQUIERA de sus campos —
 * título, artista o álbum—? Cada catálogo pone el marcador donde lo tiene: un
 * disco de covers se llama "Piano Covers" o firma como "Slowed Sounds" con un
 * título pelado.
 */
export function isNonOriginalTrack(t: TrackResult, queryTitle: string, queryArtist: string): boolean {
  if (marcadorNoOriginalFueraDeConsulta(t.title, tituloParaMarcadores(queryTitle))) return true;
  if (marcadorNoOriginalFueraDeConsulta(t.artist, tituloParaMarcadores(queryArtist))) return true;
  if (t.album.trim() !== "" && isNonOriginalTitle(t.album)) return true;
  return false;
}

/* ── Puntaje de campos (matching_score.go + matching_query.go) ───── */

/**
 * Fracción de tokens compartidos entre dos cadenas ya plegadas.
 * Denominador = el mayor de los dos conjuntos.
 */
function solapamientoTokens(a: string, b: string): number {
  const ta = a.split(" ").filter(Boolean);
  if (ta.length === 0) return 0;
  const tb = b.split(" ").filter(Boolean);
  if (tb.length === 0) return 0;
  let hits = 0;
  for (const wb of tb) {
    if (ta.includes(wb)) hits++;
  }
  return hits / Math.max(ta.length, tb.length);
}

/** `fieldScorePre`: consulta y candidato YA plegados. */
function fieldScorePre(qFolded: string, rFolded: string): number {
  if (qFolded === "" || rFolded === "") return 0;
  if (qFolded === rFolded) return 3;
  if (rFolded.includes(qFolded) || qFolded.includes(rFolded)) return 2;
  // "suave (feat Tokischa) bonus track" vs "suave bonus track feat Tokischa":
  // mismo conjunto de tokens, distinto orden — coincidencia fuerte.
  const ov = solapamientoTokens(qFolded, rFolded);
  if (ov >= 0.85) return 2;
  if (ov >= 0.6) return 1;
  return 0;
}

/**
 * Cuánto se parece un campo de la consulta al del candidato:
 * 3 = igual, 2 = uno contiene al otro u orden distinto de tokens,
 * 1 = solapamiento débil, 0 = nada.
 */
export function fieldScore(q: string, r: string): number {
  return fieldScorePre(foldTrack(q), foldTrack(r));
}

/** `albumScorePre`: consulta y álbum YA plegados. */
function albumScorePre(qFolded: string, rFolded: string): number {
  if (qFolded === "" || rFolded === "") return 0;
  if (qFolded === rFolded) return 3;
  if (rFolded.includes(qFolded) || qFolded.includes(rFolded)) return 2;
  if (solapamientoTokens(qFolded, rFolded) >= 0.7) return 1;
  return 0;
}

/** 3 = mismo disco, 2 = una edición del mismo (deluxe, remaster), 1 = débil. */
export function albumScore(queryAlbum: string, candAlbum: string): number {
  return albumScorePre(foldTrack(queryAlbum), foldTrack(candAlbum));
}

/* ── Título sin créditos y evidencia de artista (matching_original.go) ── */

/** Quita los tramos entre paréntesis, corchetes o llaves. */
export function sinCreditosParenteticos(s: string): string {
  if (!/[({\[]/.test(s)) return s;
  let out = "";
  let prof = 0;
  for (const r of s) {
    if (r === "(" || r === "[" || r === "{") prof++;
    else if (r === ")" || r === "]" || r === "}") {
      if (prof > 0) prof--;
    } else if (prof === 0) out += r;
  }
  return out;
}

function artistaEnTituloTokens(tokens: string[], title: string): boolean {
  const tituloSinCred = foldTrack(sinCreditosParenteticos(title));
  if (tokens.length === 0 || tituloSinCred === "") return false;
  for (const tok of tokens) {
    if (tok.length >= 3 && tituloSinCred.includes(tok)) return true;
  }
  return false;
}

/** ¿El artista de la consulta aparece dentro del TÍTULO del candidato? */
export function artistaEnTitulo(queryArtist: string, title: string): boolean {
  return artistaEnTituloTokens(tokensFold(foldTrack(queryArtist)), title);
}

/**
 * Veto a la evidencia "artista dentro del título": quien firma como versión
 * (orquesta, ensamble, canal de "slowed", karaoke) no puede pasar por el
 * original aunque su título acredite al artista original.
 */
function artistaDeVersion(artist: string): boolean {
  const a = artist.trim();
  if (a === "") return false;
  return isNonOriginalTitle(a);
}

function artistaEnTituloDelCandidato(queryArtist: string, t: TrackResult): boolean {
  return artistaEnTituloDelCandidatoTokens(tokensFold(foldTrack(queryArtist)), t);
}

/** Igual que `artistaEnTituloDelCandidato` con los tokens del artista ya separados. */
function artistaEnTituloDelCandidatoTokens(tokens: string[], t: TrackResult): boolean {
  if (!artistaEnTituloTokens(tokens, t.title)) return false;
  return !artistaDeVersion(t.artist);
}

/** Palabras que delatan un canal de re-subida en vez de un artista real. */
const canalesResubida = [
  "vevo", "topic", "lyrics", "lyric", "hits", "records", "entertainment",
  "music", "songs", "uploads", "uploader", "channel", "official",
];

export function esCanalDeResubida(artist: string): boolean {
  const low = artist.trim().toLowerCase();
  if (low === "") return false;
  return canalesResubida.some((marca) => low.includes(marca));
}

/**
 * ¿El artista del candidato se puede relacionar con el pedido, aunque sea de
 * forma débil? Sin esto, un homónimo de otro artista o un cover sin marcador se
 * ve igual de bueno que el re-subido de la canción pedida.
 */
export function evidenciaArtista(queryArtist: string, t: TrackResult): boolean {
  if (queryArtist.trim() === "") return false;
  if (fieldScore(queryArtist, t.artist) >= 1) return true;
  return artistaEnTituloDelCandidato(queryArtist, t) || esCanalDeResubida(t.artist);
}

/* ── Duración (matching_duracion.go) ─────────────────────────────── */

/** "Peso" de un candidato sin duración: pierde contra cualquier conocida, pero sigue válido. */
const duracionDesconocida = 2 ** 31 - 1;

/** La ÚNICA definición de "dura lo mismo": tolera 25% o 20 s (el mayor). */
export function duracionCoincide(queryMs: number, gotMs: number): boolean {
  if (queryMs <= 0 || gotMs <= 0) return true;
  const tol = Math.max(queryMs / 4, 20_000);
  return Math.abs(queryMs - gotMs) <= tol;
}

function distanciaDuracionMs(queryMs: number, got: number): number {
  if (queryMs <= 0 || got <= 0) return duracionDesconocida;
  return Math.abs(queryMs - got);
}

/** Bonus por evidencia de artista: rompe empates, nunca alcanza para subir de grupo. */
const bonusEvidenciaArtista = 0.5;

/* ── Consulta pre-plegada (matching_query.go) ────────────────────── */

function tokensFold(s: string): string[] {
  return s === "" ? [] : s.split(" ").filter(Boolean);
}

/**
 * La consulta (título + artista + álbum) con todos sus pliegues precomputados,
 * para clasificar y rankear muchos candidatos sin re-normalizar la misma
 * consulta por candidato.
 */
export class QueryFiltro {
  readonly titleFold: string;
  readonly artistFold: string;
  readonly albumFold: string;
  readonly titleMarc: string;
  readonly artistMarc: string;
  readonly albumMarc: string;
  readonly artistTokens: string[];
  readonly artistVacio: boolean;

  constructor(title: string, artist: string, album = "") {
    this.artistFold = foldTrack(artist);
    this.titleFold = foldTrack(title);
    this.albumFold = foldTrack(album);
    this.titleMarc = tituloParaMarcadores(title);
    this.artistMarc = tituloParaMarcadores(artist);
    this.albumMarc = tituloParaMarcadores(album);
    this.artistTokens = tokensFold(this.artistFold);
    this.artistVacio = artist.trim() === "";
  }

  scoreTitulo(r: string): number {
    return fieldScorePre(this.titleFold, foldTrack(r));
  }

  scoreArtista(r: string): number {
    return fieldScorePre(this.artistFold, foldTrack(r));
  }

  scoreAlbum(r: string): number {
    return albumScorePre(this.albumFold, foldTrack(r));
  }

  artistaEnTitulo(title: string): boolean {
    return artistaEnTituloTokens(this.artistTokens, title);
  }

  evidenciaArtista(t: TrackResult): boolean {
    if (this.artistVacio) return false;
    if (fieldScorePre(this.artistFold, foldTrack(t.artist)) >= 1) return true;
    return artistaEnTituloDelCandidatoTokens(this.artistTokens, t) || esCanalDeResubida(t.artist);
  }

  /**
   * Puntaje con el que se decide quién está EMPATADO (para el desempate por
   * álbum/duración): título + artista, con el artista contando como fuerte si
   * aparece dentro del título y un bonus si hay evidencia de artista.
   */
  puntajeEfectivo(t: TrackResult): number {
    const tt = this.scoreTitulo(t.title);
    let aa = this.scoreArtista(t.artist);
    if (tt >= 2 && aa < 2 && artistaEnTituloDelCandidatoTokens(this.artistTokens, t)) {
      aa = 2;
    }
    let s = tt + aa;
    if (tt >= 2 && this.evidenciaArtista(t)) s += bonusEvidenciaArtista;
    return s;
  }

  /** Variante por consulta con el álbum también comparado contra su marcador. */
  isNonOriginalTrack(t: TrackResult): boolean {
    if (marcadorNoOriginalPre(tituloParaMarcadores(t.title), this.titleMarc)) return true;
    if (marcadorNoOriginalPre(tituloParaMarcadores(t.artist), this.artistMarc)) return true;
    if (t.album.trim() !== "" && marcadorNoOriginalPre(tituloParaMarcadores(t.album), this.albumMarc)) {
      return true;
    }
    return false;
  }

  /**
   * ¿El candidato es el ORIGINAL pedido y con qué fuerza? Se exige título fuerte
   * (>=2); el artista puede ser fuerte (>=2), o aparecer dentro del título
   * (re-subidos), o ser exacto con el título en otro orden.
   */
  originalStrength(t: TrackResult): { score: number; strong: boolean } {
    const tt = this.scoreTitulo(t.title);
    const aa = this.scoreArtista(t.artist);
    if (tt < 2) return { score: tt + aa, strong: false };
    if (this.isNonOriginalTrack(t)) return { score: tt + aa, strong: false };
    let strong = aa >= 2;
    if (!strong && artistaEnTituloDelCandidatoTokens(this.artistTokens, t)) strong = true;
    return { score: tt + aa, strong };
  }

  /** Clasifica para el listado: variante / original / puntaje del título. */
  clasificar(t: TrackResult): { variante: boolean; original: boolean; titleScore: number; artistScore: number } {
    const titleScore = this.scoreTitulo(t.title);
    const artistScore = this.scoreArtista(t.artist);
    const variante = this.isNonOriginalTrack(t);
    if (titleScore < 2 || variante) return { variante, original: false, titleScore, artistScore };
    let strong = artistScore >= 2;
    if (!strong && artistaEnTituloTokens(this.artistTokens, t.title)) strong = true;
    return { variante: false, original: strong, titleScore, artistScore };
  }
}

/* ── Ranking (matching_original.go + matching_album.go) ──────────── */

function rankOriginalCandidatesInterno(
  queryTitle: string,
  queryArtist: string,
  queryAlbum: string,
  estricto: boolean,
  results: TrackResult[],
): TrackResult[] {
  const q = new QueryFiltro(queryTitle, queryArtist, queryAlbum);
  const out: TrackResult[] = [];

  // Paso 1: originales estrictos, mejor primero.
  for (const t of results) {
    if (q.originalStrength(t).strong) out.push(t);
  }

  // Paso 2: último recurso — título fuerte y no variante respecto del pedido. Se
  // usa solo si NO hubo ningún original estricto (típico: el artista real va
  // dentro del título y el campo Artist es el canal). Mismo puntaje que el
  // desempate por duración, así que un homónimo queda detrás sin descartarse.
  if (out.length === 0) {
    const eff: { idx: number; score: number }[] = [];
    results.forEach((t, i) => {
      if (q.scoreTitulo(t.title) < 2 || q.isNonOriginalTrack(t)) return;
      eff.push({ idx: i, score: q.puntajeEfectivo(t) });
    });
    // Inserción estable, mejor primero.
    for (let x = 1; x < eff.length; x++) {
      for (let y = x; y > 0 && eff[y - 1].score < eff[y].score; y--) {
        [eff[y - 1], eff[y]] = [eff[y], eff[y - 1]];
      }
    }
    for (const e of eff) out.push(results[e.idx]);
  }

  if (!estricto || queryArtist.trim() === "") return out;

  // Resolución: se descartan los candidatos sin NINGUNA evidencia de artista.
  return out.filter((t) => q.evidenciaArtista(t));
}

/**
 * Rankea para LISTAR: originales primero y, si no hay, el mejor esfuerzo por
 * título. Nunca vacía la lista (los homónimos quedan al final, no se borran).
 */
export function rankOriginalCandidates(queryTitle: string, queryArtist: string, results: TrackResult[]): TrackResult[] {
  return rankOriginalCandidatesInterno(queryTitle, queryArtist, "", false, results);
}

/**
 * Rankea para RESOLVER: sin el último recurso ciego, descarta los candidatos sin
 * evidencia de artista. Preferible no resolver que servir el homónimo de OTRO
 * artista (el caso "Quenchoso").
 */
export function rankOriginalCandidatesEstricto(queryTitle: string, queryArtist: string, results: TrackResult[]): TrackResult[] {
  return rankOriginalCandidatesInterno(queryTitle, queryArtist, "", true, results);
}

type CandRank = { t: TrackResult; score: number; album: number; dur: number };

/** Desempate por (álbum, duración) DENTRO de cada grupo de puntaje. */
function reordenarPorAlbumDuracion(
  queryTitle: string,
  queryArtist: string,
  queryAlbum: string,
  queryDurationMs: number,
  ranked: TrackResult[],
): TrackResult[] {
  if (ranked.length < 2 || (queryAlbum === "" && queryDurationMs <= 0)) return ranked;
  const q = new QueryFiltro(queryTitle, queryArtist, queryAlbum);
  const items: CandRank[] = ranked.map((t) => ({
    t,
    score: q.puntajeEfectivo(t),
    album: q.scoreAlbum(t.album),
    dur: distanciaDuracionMs(queryDurationMs, t.durationMs),
  }));
  // Inserción estable por (álbum, duración) sin cruzar grupos de puntaje: un
  // candidato mejor nunca baja y uno sin álbum/duración nunca se descarta.
  for (let i = 1; i < items.length; i++) {
    for (let j = i; j > 0; j--) {
      const prev = items[j - 1];
      const cur = items[j];
      if (prev.score !== cur.score) break;
      if (cur.album > prev.album || (cur.album === prev.album && cur.dur < prev.dur)) {
        items[j - 1] = cur;
        items[j] = prev;
        continue;
      }
      break;
    }
  }
  return items.map((i) => i.t);
}

/** Listado con desempate por álbum y duración. */
export function rankOriginalCandidatesAlbum(
  queryTitle: string,
  queryArtist: string,
  queryAlbum: string,
  queryDurationMs: number,
  results: TrackResult[],
): TrackResult[] {
  return reordenarPorAlbumDuracion(
    queryTitle,
    queryArtist,
    queryAlbum,
    queryDurationMs,
    rankOriginalCandidatesInterno(queryTitle, queryArtist, queryAlbum, false, results),
  );
}

/** Resolución con desempate por álbum y duración (nunca sirve homónimos). */
export function rankOriginalCandidatesAlbumEstricto(
  queryTitle: string,
  queryArtist: string,
  queryAlbum: string,
  queryDurationMs: number,
  results: TrackResult[],
): TrackResult[] {
  return reordenarPorAlbumDuracion(
    queryTitle,
    queryArtist,
    queryAlbum,
    queryDurationMs,
    rankOriginalCandidatesInterno(queryTitle, queryArtist, queryAlbum, true, results),
  );
}

/** La mejor coincidencia para REPRODUCIR/BAJAR, o null si no hay original válido. */
export function bestOriginalAlbumDuracion(
  queryTitle: string,
  queryArtist: string,
  queryAlbum: string,
  queryDurationMs: number,
  results: TrackResult[],
): TrackResult | null {
  const ranked = rankOriginalCandidatesAlbumEstricto(queryTitle, queryArtist, queryAlbum, queryDurationMs, results);
  return ranked.length > 0 ? ranked[0] : null;
}

/** Sin álbum: equivalente a `bestOriginalAlbumDuracion(title, artist, "", dur, results)`. */
export function bestOriginalDuracion(
  queryTitle: string,
  queryArtist: string,
  queryDurationMs: number,
  results: TrackResult[],
): TrackResult | null {
  return bestOriginalAlbumDuracion(queryTitle, queryArtist, "", queryDurationMs, results);
}

/** El mejor original sin desempates, o null. */
export function bestOriginal(queryTitle: string, queryArtist: string, results: TrackResult[]): TrackResult | null {
  const ranked = rankOriginalCandidatesEstricto(queryTitle, queryArtist, results);
  return ranked.length > 0 ? ranked[0] : null;
}

/* ── Listado de búsqueda (gobackend/search_provider.go) ──────────── */

/** Mínimo que necesita el filtro de listado. */
export type ItemParaFiltrar = {
  tipo: string;
  titulo: string;
  artista: string;
  album: string;
  isrc: string | null;
};

const catNoTrack = 0;
const catEstricto = 1;
const catTitulo = 2;
const catArtistaAlbum = 3;
const catUltimo = 4;
const catDescartado = 5;

/**
 * `filtrarOriginales`: saca del LISTADO los tracks que no se relacionan con la
 * consulta y ordena por niveles. Los no-tracks (álbumes, artistas, playlists)
 * SIEMPRE se conservan y van primero: el usuario puede querer otro álbum con el
 * mismo nombre. Dos pasadas como en el backend: si hay originales estrictos, el
 * resto se descarta; si no, se aceptan los que coinciden por título o por
 * artista/álbum; si tampoco, los de coincidencia débil.
 */
export function filtrarOriginales<T extends ItemParaFiltrar>(
  items: T[],
  queryTitle: string,
  queryArtist: string,
): T[] {
  const q = new QueryFiltro(queryTitle, queryArtist, "");
  const cats: number[] = new Array(items.length).fill(catDescartado);
  let nNoTracks = 0;
  let nEstrictos = 0;
  let nTitulo = 0;
  let nArtistaAlbum = 0;
  let nUltimo = 0;

  items.forEach((item, i) => {
    if (item.tipo !== "track") {
      cats[i] = catNoTrack;
      nNoTracks++;
      return;
    }
    const tr: TrackResult = {
      id: "", title: item.titulo, artist: item.artista, album: item.album,
      coverUrl: "", durationMs: 0, isrc: item.isrc ?? "", provider: "",
    };
    const { variante, original, titleScore } = q.clasificar(tr);
    if (original) {
      cats[i] = catEstricto;
      nEstrictos++;
    } else if (!variante && titleScore >= 2) {
      cats[i] = catTitulo;
      nTitulo++;
    } else if (!variante && (q.scoreTitulo(item.artista) >= 2 || q.scoreTitulo(item.album) >= 2)) {
      cats[i] = catArtistaAlbum;
      nArtistaAlbum++;
    } else if (!variante && titleScore >= 1) {
      cats[i] = catUltimo;
      nUltimo++;
    }
  });

  const recolectar = (niveles: number[]): T[] => {
    const out: T[] = [];
    for (const nivel of niveles) {
      items.forEach((item, i) => {
        if (cats[i] === nivel) out.push(item);
      });
    }
    return out;
  };

  if (nEstrictos > 0) return recolectar([catNoTrack, catEstricto]);
  if (nTitulo > 0 || nArtistaAlbum > 0) return recolectar([catNoTrack, catTitulo, catArtistaAlbum]);
  return recolectar([catNoTrack, catUltimo]);
}

/**
 * `splitSearchQuery`: parte una consulta libre en (título, artista) para el
 * filtro de relevancia. "Artist - Title", "Title by Artist" y "Title feat X".
 * Sin separador devuelve la consulta entera como título y artista vacío.
 */
export function splitSearchQuery(q: string): { title: string; artist: string } {
  const low = q.toLowerCase();
  const guion = low.indexOf(" - ");
  if (guion > 0) return { title: q.slice(guion + 3).trim(), artist: q.slice(0, guion).trim() };

  const by = low.indexOf(" by ");
  if (by >= 0) return { title: q.slice(0, by).trim(), artist: q.slice(by + 4).trim() };

  for (const sep of [" ft ", " feat ", " featuring ", " ft. ", " feat. "]) {
    const idx = low.indexOf(sep);
    if (idx >= 0) return { title: q.slice(0, idx).trim(), artist: q.slice(idx + sep.length).trim() };
  }
  return { title: q, artist: "" };
}

/* ── Autoridad del ISRC (matching_isrc_autoridad.go) ─────────────── */

/**
 * Proveedores cuyo ISRC viene del sello (catálogo) o cuyo índice ES el ISRC. En
 * los demás (YouTube/YouTube Music/SoundCloud) el ISRC se INFIERE por parecido
 * de nombre, así que no prueba identidad.
 */
const proveedoresAutoritativosISRC = new Set([
  "deezer", "deezer-web", "qobuz", "qobuz-web", "tidal", "tidal-web",
  "amazon", "amazon-web", "apple-music", "apple", "flac-rescue", "musicbrainz", "itunes",
]);

export function esProveedorAutoritativoISRC(nombre: string): boolean {
  return proveedoresAutoritativosISRC.has(nombre.trim());
}

/** Adelanta los candidatos que declaran [isrc] sin descartar al resto. */
export function preferirISRC(isrc: string, cands: TrackResult[]): TrackResult[] {
  const pedido = isrc.trim().toUpperCase();
  if (pedido === "" || cands.length < 2) return cands;
  const coinciden: TrackResult[] = [];
  const resto: TrackResult[] = [];
  for (const c of cands) {
    if ((c.isrc ?? "").trim().toUpperCase() === pedido) coinciden.push(c);
    else resto.push(c);
  }
  if (coinciden.length === 0) return cands;
  return [...coinciden, ...resto];
}

/**
 * ¿Es una coincidencia EXACTA por ISRC aunque no traiga metadata de catálogo?
 * Los proveedores indexados por ISRC devuelven el propio ISRC como título.
 */
export function esCandidatoPorISRC(isrc: string, t: TrackResult | null | undefined): boolean {
  if (!t) return false;
  const pedido = isrc.trim().toUpperCase();
  const declarado = (t.isrc ?? "").trim().toUpperCase();
  if (pedido === "" || declarado === "" || pedido !== declarado) return false;
  const titulo = t.title.trim();
  return titulo === "" || titulo.toLowerCase() === isrc.trim().toLowerCase();
}
