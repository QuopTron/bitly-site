/**
 * Superficie pública del runtime de extensiones de la demo.
 *
 * La usan las server functions (`src/server/demo-proxy.ts`) y el harness de
 * Node (`scripts/probar-extensiones.mjs`).
 */

export {
  buscarEnExtension,
  llamarExtension,
  registrosDe,
  cacheDe,
  type BusquedaExtension,
  type LlamadaExtension,
} from "./runtime";
export {
  buscarRespaldo,
  isrcDeRespaldo,
  type PistaParaRescatar,
} from "./rescate";
export { normalizarItems } from "./normalizar";
export type { Item, ResultadoBusqueda, TipoResultado } from "./tipos";
