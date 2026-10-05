/**
 * Tipos compartidos por el runtime de extensiones de la demo.
 *
 * Replican el contrato del sandbox goja de la app
 * (`go_backend/internal/extensions`): mismo shape de respuestas, mismos
 * nombres de campo en los resultados, mismos convertidores.
 */

/** Shape de `http.get/post/put/head` (doHTTPCompat en http_helpers.go). */
export type RespuestaHttp = {
  status: number;
  statusCode: number;
  ok: boolean;
  body: string;
  /** Cabeceras como las exporta goja: nombre → arreglo de valores. */
  headers: Record<string, string[]>;
  url?: string;
  error?: string;
};

/** Shape de `fetch()` (registerFetch en http_fetch.go). */
export type RespuestaFetch = {
  ok: boolean;
  status: number;
  body: string;
  json: () => unknown;
  text: () => string;
  headers: { get: (nombre: string) => string | undefined } & Record<string, string>;
};

/** Petición registrada por el shim durante una corrida de la extensión. */
export type Pendiente = {
  clave: string;
  metodo: string;
  url: string;
  cuerpo: string;
  cabeceras: Record<string, string>;
};

export type TipoResultado = "track" | "album" | "artist" | "playlist";

/** Resultado ya normalizado, tal como lo consume la interfaz. */
export type Item = {
  id: string;
  tipo: TipoResultado;
  titulo: string;
  artista: string;
  album: string;
  caratula: string | null;
  /** Milisegundos (0 si la fuente no lo publica). */
  duracionMs: number;
  isrc: string | null;
};

export type ResultadoBusqueda = {
  /** "extension" = lo devolvió la extensión; "respaldo" = catálogo Deezer. */
  origen: "extension" | "respaldo";
  items: Item[];
  /** Motivo si la extensión no pudo responder (la interfaz lo puede mostrar). */
  aviso?: string;
};
