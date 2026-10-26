/**
 * Precio de Premium (en bolivianos): sube Bs 1 por hora desde las 16:00 del 26.
 *
 * La oferta de lanzamiento no es un precio fijo hasta una hora de corte, sino
 * una escalera por reloj: a las 4 de la tarde del 26 vale Bs 10, a las 5 vale
 * Bs 11, a las 6 Bs 12… y sigue sumando Bs 1 por hora hasta llegar a Bs 30 al
 * mediodía del 27, donde se queda.
 *
 * Se calcula sobre la hora de Bolivia (UTC-4 todo el año, sin horario de
 * verano), igual en el servidor y en el navegador: el corte en UTC evita que un
 * visitante con el reloj mal vea otro precio.
 *
 * Las monedas distintas de BOB siguen saliendo de la conversión con su margen
 * (`MARKUP` de `@/lib/currency`), así que heredan el precio del momento.
 */

/** Precio tope por código, en Bs (se alcanza el 27 al mediodía). */
export const PRECIO_NORMAL = 30;
/** Precio inicial de la escalera, en Bs. */
export const PRECIO_OFERTA = 10;
/** Cada cuánto sube: una hora. */
export const PASO_MS = 60 * 60 * 1000;

/** 26/10/2026 16:00 en Bolivia (UTC-4) = 20:00 UTC. */
export const INICIO_OFERTA = new Date("2026-10-26T20:00:00.000Z");
/** Cuando la escalera toca el tope: 27/10/2026 12:00 en Bolivia. */
export const FIN_OFERTA = new Date(
  INICIO_OFERTA.getTime() + (PRECIO_NORMAL - PRECIO_OFERTA) * PASO_MS,
);

const DURACION_OFERTA_MS = FIN_OFERTA.getTime() - INICIO_OFERTA.getTime();

export type EstadoFase = {
  /** Precio vigente ahora mismo, en Bs. */
  precio: number;
  /** Precio tope, para tacharlo mientras el vigente sea menor. */
  original: number;
  etiqueta: string;
  etiquetaEn: string;
  /** ¿Todavía no llegó al tope? (hay precio tachado que mostrar) */
  enOferta: boolean;
  /** ISO del próximo aumento; `null` cuando ya está en el tope. */
  finOferta: string | null;
  /** Milisegundos hasta el próximo aumento (0 si ya está en el tope). */
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

/** ¿Cuántas horas completas lleva andando la escalera? (puede ser negativo antes) */
function horasDeEscalera(ahora: Date): number {
  return Math.floor((ahora.getTime() - INICIO_OFERTA.getTime()) / PASO_MS);
}

/**
 * Precio vigente para un instante: Bs 10 desde las 16:00 del 26, +1 por hora,
 * congelado en Bs 30.
 */
export function precioAhora(ahora: Date = new Date()): number {
  const horas = horasDeEscalera(ahora);
  if (horas <= 0) return PRECIO_OFERTA;
  return Math.min(PRECIO_NORMAL, PRECIO_OFERTA + horas);
}

/** Progreso de la escalera (0 al empezar, 1 al llegar al tope). */
export function progresoOferta(ahora: Date): number {
  if (DURACION_OFERTA_MS <= 0) return 1;
  const avance = (ahora.getTime() - INICIO_OFERTA.getTime()) / DURACION_OFERTA_MS;
  return Math.min(1, Math.max(0, avance));
}

export function getFaseActual(ahora: Date = new Date()): EstadoFase {
  const precio = precioAhora(ahora);
  const enOferta = precio < PRECIO_NORMAL;
  const horas = Math.max(0, horasDeEscalera(ahora));
  const proximoAumento = new Date(INICIO_OFERTA.getTime() + (horas + 1) * PASO_MS);
  const msParaFin = enOferta
    ? Math.max(0, proximoAumento.getTime() - ahora.getTime())
    : 0;
  return {
    precio,
    original: PRECIO_NORMAL,
    etiqueta: "Oferta de lanzamiento",
    etiquetaEn: "Launch offer",
    enOferta,
    finOferta: enOferta ? proximoAumento.toISOString() : null,
    msParaFin,
  };
}
