/**
 * Normalizador de resultados de las extensiones.
 *
 * Port fiel (a mano) de `go_backend/internal/provider/extension_convert_*`:
 * cada extensión escribe lo mismo de formas distintas — `artists` puede ser
 * string, arreglo de strings o arreglo de objetos; `album` string u objeto;
 * la duración llega como `duration_ms`, como segundos o como "3:45"; el ISRC
 * como `isrc`, `isrc_code` o `isrcCode`; la carátula como `cover_url`,
 * `images` o `picture_xl`. Leer solo con `getString` hacía que artista,
 * álbum o ISRC se perdieran sin aviso.
 */

import type { Item, TipoResultado } from "./tipos";

function textoFlexible(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .map((e) => textoFlexible(e))
      .filter((s) => s !== "")
      .join(", ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return textoDeCampo(o, "name", "title", "text", "label", "artist", "artists");
  }
  return "";
}

function textoDeCampo(m: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = m[k];
    if (v !== null && v !== undefined) {
      const s = textoFlexible(v);
      if (s !== "") return s;
    }
  }
  return "";
}

function enteroFlexible(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

/** "3:45" → 225000; 225 → 225000; 225000 → 225000 (milisegundos). */
function duracionFlexible(v: unknown): number {
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return 0;
    if (s.includes(":")) {
      const partes = s.split(":");
      if (partes.length < 2 || partes.length > 3) return 0;
      let total = 0;
      for (const p of partes) {
        const n = Number(p.trim());
        if (!Number.isInteger(n) || n < 0) return 0;
        total = total * 60 + n;
      }
      return total * 1000;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return segundosOMs(Math.trunc(n));
  }
  if (typeof v === "number" && Number.isFinite(v)) return segundosOMs(Math.trunc(v));
  return 0;
}

function segundosOMs(n: number): number {
  if (n <= 0) return 0;
  return n < 6000 ? n * 1000 : n;
}

function duracionDeCampo(m: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = m[k];
    if (v === null || v === undefined) continue;
    const ms = duracionFlexible(v);
    if (ms > 0) return ms;
  }
  return 0;
}

function isrcDeCampo(m: Record<string, unknown>): string | null {
  const s = textoDeCampo(m, "isrc", "isrc_code", "isrcCode", "ISRC").toUpperCase();
  return s === "" ? null : s;
}

function urlDeImagenes(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    for (const e of v) {
      const s = urlDeImagenes(e);
      if (s) return s;
    }
    return "";
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const s = textoDeCampo(o, "url", "href", "src", "cover_url", "coverUrl", "image_url");
    return s;
  }
  return "";
}

function portadaDeCampo(m: Record<string, unknown>): string | null {
  const directa = textoDeCampo(
    m,
    "cover_url",
    "coverUrl",
    "cover",
    "image_url",
    "imageUrl",
    "picture_xl",
    "picture_big",
    "picture_medium",
    "picture",
    "thumbnail",
  );
  if (directa) return directa;
  for (const k of ["images", "image"]) {
    if (m[k] !== null && m[k] !== undefined) {
      const s = urlDeImagenes(m[k]);
      if (s) return s;
    }
  }
  return null;
}

/** "deezer:123" → "123". */
function quitarPrefijo(id: string): string {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}

/** Categoría canónica de un `item_type` o de un id de filtro del manifest. */
export function categoriaDe(valor: string): TipoResultado | null {
  switch (valor.toLowerCase()) {
    case "track":
    case "tracks":
    case "song":
    case "songs":
      return "track";
    case "album":
    case "albums":
      return "album";
    case "artist":
    case "artists":
      return "artist";
    case "playlist":
    case "playlists":
      return "playlist";
    default:
      return null;
  }
}

/**
 * Convierte el arreglo que devolvió la extensión en `Item[]`.
 *
 * `tipoFijo` se usa cuando el llamador filtró por categoría (canciones,
 * álbumes…); si no está, el tipo sale de `item_type`/`type` de cada fila.
 */
export function normalizarItems(resultado: unknown, tipoFijo?: TipoResultado): Item[] {
  if (!Array.isArray(resultado)) return [];
  const items: Item[] = [];

  for (const crudo of resultado) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) continue;
    const m = crudo as Record<string, unknown>;

    const idBruto = textoDeCampo(m, "id");
    if (!idBruto) continue;
    const id = quitarPrefijo(idBruto);

    const tipo =
      tipoFijo ?? categoriaDe(textoDeCampo(m, "item_type", "type")) ?? "track";

    items.push({
      id,
      tipo,
      titulo: textoDeCampo(m, "name", "title"),
      artista: textoDeCampo(m, "artists", "artist", "album_artist", "artist_name", "owner", "creator"),
      album:
        tipo === "track"
          ? textoDeCampo(m, "album_name", "album_title", "albumName", "album")
          : "",
      caratula: portadaDeCampo(m),
      duracionMs: duracionDeCampo(m, "duration_ms", "durationMs", "duration"),
      isrc: isrcDeCampo(m),
    });
  }

  return items;
}
