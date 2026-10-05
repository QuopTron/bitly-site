/**
 * Fases de precio (en bolivianos), con la escalera que se pidió:
 *
 *   · hasta el 15        → 30 Bs
 *   · del 16 al 28       → 40 Bs
 *   · desde el 29        → 50 Bs (precio final, ya no baja más)
 *
 * A diferencia de la fase anterior (una sola oferta con fecha tope), acá cada
 * escalón tiene su propio `hasta` y el último es `null`: 50 Bs de por vida.
 * El cambio de precio solo depende del calendario, no de un contador en el
 * servidor, así que `getFaseActual` es determinístico y no necesita red.
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
    hasta: "2026-10-16T00:00:00",
    precio: 30,
    original: 50,
    etiqueta: "Hasta el 15",
    etiquetaEn: "Until the 15th",
  },
  {
    hasta: "2026-10-29T00:00:00",
    precio: 40,
    original: 50,
    etiqueta: "Del 16 al 28",
    etiquetaEn: "From the 16th to the 28th",
  },
  {
    hasta: null,
    precio: 50,
    original: 50,
    etiqueta: "Precio final",
    etiquetaEn: "Final price",
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