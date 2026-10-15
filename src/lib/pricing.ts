/**
 * Precio de Premium (en bolivianos): fijo en 30 Bs, sin ofertas ni escalera.
 *
 * Antes había una escalera por fecha (30 → 40 → 50 con precio tachado); se
 * quitó el 15/10/2026 a pedido: un solo precio, de por vida. Las monedas
 * distintas de BOB siguen saliendo de la conversión con su margen
 * (`MARKUP` de `@/lib/currency`), así que el precio convertido hereda el
 * mismo 30 Bs.
 */

export type Fase = {
  /** Siguiente escalón; `null` cuando ya se llegó al precio final. */
  hasta: string | null;
  precio: number;
  /** Precio tachado al lado del vigente. */
  original: number;
  etiqueta: string;
  etiquetaEn: string;
};

const FASES: Fase[] = [
  {
    hasta: null,
    precio: 30,
    original: 30,
    etiqueta: "Precio fijo",
    etiquetaEn: "Fixed price",
  },
];

export type EstadoFase = {
  precio: number;
  original: number;
  etiqueta: string;
  etiquetaEn: string;
  /** El precio vigente es una oferta: hay precio tachado que mostrar. */
  enOferta: boolean;
  /** Escalón siguiente, para el indicador de progreso. */
  siguiente: Fase | null;
  /** Días que faltan para el próximo cambio de precio. */
  diasParaSiguiente: number;
};

/** Días calendario completos entre hoy y el cambio de precio. */
function diasHasta(iso: string) {
  const ahora = new Date();
  const limite = new Date(iso);
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Math.max(0, Math.ceil((limite.getTime() - inicio.getTime()) / 86_400_000));
}

export function getFaseActual(): EstadoFase {
  const ahora = new Date();
  const i = FASES.findIndex((f) => !f.hasta || ahora < new Date(f.hasta));
  const idx = i === -1 ? FASES.length - 1 : i;
  const f = FASES[idx];
  const siguiente = FASES[idx + 1] ?? null;
  return {
    precio: f.precio,
    original: f.original,
    etiqueta: f.etiqueta,
    etiquetaEn: f.etiquetaEn,
    enOferta: f.precio < f.original,
    siguiente,
    diasParaSiguiente: siguiente?.hasta ? diasHasta(siguiente.hasta) : 0,
  };
}