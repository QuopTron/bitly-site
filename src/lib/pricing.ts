/**
 * Precio de Premium (en bolivianos).
 *
 * Oferta de lanzamiento: 10 Bs hasta las 14:00 de Bolivia del 26/10/2026 y
 * 30 Bs desde ese momento. El corte está en UTC para que sea idéntico en el
 * servidor y en el navegador (Bolivia es UTC-4 todo el año, sin horario de
 * verano).
 *
 * Las monedas distintas de BOB siguen saliendo de la conversión con su margen
 * (`MARKUP` de `@/lib/currency`), así que el precio convertido hereda la
 * oferta o el precio normal.
 */

/** Precio normal por código, en Bs. */
export const PRECIO_NORMAL = 30;
/** Precio de la oferta de lanzamiento, en Bs. */
export const PRECIO_OFERTA = 10;

/** 26/10/2026 14:00 en Bolivia (UTC-4) = 18:00 UTC. */
export const FIN_OFERTA = new Date("2026-10-26T18:00:00.000Z");
/** 26/10/2026 00:00 en Bolivia, para el progreso del contador. */
const INICIO_OFERTA = new Date("2026-10-26T04:00:00.000Z");

const DURACION_OFERTA_MS = FIN_OFERTA.getTime() - INICIO_OFERTA.getTime();

export type EstadoFase = {
  precio: number;
  /** Precio normal, para tacharlo mientras la oferta está vigente. */
  original: number;
  etiqueta: string;
  etiquetaEn: string;
  /** El precio vigente es la oferta: hay precio tachado que mostrar. */
  enOferta: boolean;
  /** ISO del fin de la oferta; `null` cuando ya terminó. */
  finOferta: string | null;
  /** Milisegundos que faltan para el fin de la oferta (0 si ya terminó). */
  msParaFin: number;
};

/** Cuenta atrás con horas, minutos y segundos (`H:MM:SS`). */
export function formatoCuenta(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  return `${horas}:${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

/** Progreso de la oferta (0 al empezar, 1 a las 14:00 de Bolivia). */
export function progresoOferta(ahora: Date): number {
  if (DURACION_OFERTA_MS <= 0) return 1;
  const avance = (ahora.getTime() - INICIO_OFERTA.getTime()) / DURACION_OFERTA_MS;
  return Math.min(1, Math.max(0, avance));
}

export function getFaseActual(ahora: Date = new Date()): EstadoFase {
  const msParaFin = Math.max(0, FIN_OFERTA.getTime() - ahora.getTime());
  const enOferta = msParaFin > 0;
  return {
    precio: enOferta ? PRECIO_OFERTA : PRECIO_NORMAL,
    original: PRECIO_NORMAL,
    etiqueta: "Oferta de lanzamiento",
    etiquetaEn: "Launch offer",
    enOferta,
    finOferta: enOferta ? FIN_OFERTA.toISOString() : null,
    msParaFin,
  };
}
