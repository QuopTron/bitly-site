/**
 * Catálogo de fuentes de la demo: las 8 extensiones que trae la app.
 *
 * Los datos duros (nombre, filtros, placeholder) vienen de los manifests,
 * volcados a `@/lib/extensiones-meta` por `scripts/sync-extensiones.mjs`: si la
 * app cambia un manifest, regenerar el volcado basta. Acá se agregan solo las
 * cosas que la app resuelve en Dart y el sitio necesita a su manera: el orden
 * del selector (la fuente primaria primero, como hace la config de búsqueda),
 * el color de marca y si la extensión expone búsqueda.
 */

import { MANIFESTS, type FiltroBusqueda } from "@/lib/extensiones-meta";

/** Las 8 extensiones con carpeta `*-extracted` en bitly-extensions. */
export const IDS = [
  "deezer",
  "spotify-web",
  "soundcloud",
  "ytmusic-spotiflac",
  "qobuz-web",
  "tidal-web",
  "amazon",
  "pandora",
] as const;

export type ExtensionId = (typeof IDS)[number];

export type ExtensionDemo = {
  id: ExtensionId;
  /** Etiqueta corta del selector, como la de la app. */
  nombre: string;
  /** Color de marca (se usa con transparencia: nunca pinta bloques sólidos). */
  color: string;
  /** ¿Expone búsqueda? Pandora solo resuelve URLs y deja `searchBehavior` nulo. */
  busca: boolean;
  /** Chips de categoría del manifest (vacío si no busca). */
  filtros: FiltroBusqueda[];
  /** Placeholder del manifest, si trae uno. */
  placeholder: string | null;
};

const COLORES: Record<ExtensionId, string> = {
  deezer: "#A238FF",
  "spotify-web": "#1DB954",
  soundcloud: "#FF5500",
  "ytmusic-spotiflac": "#FF3B30",
  "qobuz-web": "#00B0E7",
  "tidal-web": "#FFFFFF",
  amazon: "#FF9900",
  pandora: "#3FA9F5",
};

const ETIQUETAS: Record<ExtensionId, string> = {
  deezer: "Deezer",
  "spotify-web": "Spotify",
  soundcloud: "SoundCloud",
  "ytmusic-spotiflac": "YouTube",
  "qobuz-web": "Qobuz",
  "tidal-web": "TIDAL",
  amazon: "Amazon",
  pandora: "Pandora",
};

export const EXTENSIONES: ExtensionDemo[] = IDS.map((id) => {
  const manifest = MANIFESTS[id];
  const comportamiento = manifest?.searchBehavior ?? null;
  return {
    id,
    nombre: ETIQUETAS[id],
    color: COLORES[id],
    busca: Boolean(comportamiento?.enabled),
    filtros: comportamiento?.filters ?? [],
    placeholder: comportamiento?.placeholder ?? null,
  };
});

export function extensionDe(id: string): ExtensionDemo {
  return EXTENSIONES.find((e) => e.id === id) ?? EXTENSIONES[0];
}

/** Categoría canónica de un id de filtro del manifest ("songs" → "tracks"). */
export type Categoria = "tracks" | "albums" | "artists" | "playlists";

export function categoriaDeFiltro(filterId: string): Categoria | null {
  switch (filterId.toLowerCase()) {
    case "track":
    case "tracks":
    case "song":
    case "songs":
      return "tracks";
    case "album":
    case "albums":
      return "albums";
    case "artist":
    case "artists":
      return "artists";
    case "playlist":
    case "playlists":
      return "playlists";
    default:
      return null;
  }
}
