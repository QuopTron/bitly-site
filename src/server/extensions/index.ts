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
export { buscarRespaldo, rescatarAudio, type Audio, type PistaParaRescatar } from "./rescate";
export type { Item, ResultadoBusqueda, TipoResultado } from "./tipos";
