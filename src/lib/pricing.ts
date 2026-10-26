/**
 * Precio de Premium (en bolivianos): una escalera por reloj, con pausa de noche.
 *
 * Del 26 de octubre a las 16:00 al 27, el precio arranca en Bs 10 y suma Bs 1
 * por cada hora que pasa: a las 17:00 vale Bs 11, a las 18:00 Bs 12… Hasta las
 * 23:00, que vale Bs 17.
 *
 * A la medianoche la escalera SE DETIENE y, mientras está detenida (de las
 * 00:00 a las 07:00), la oferta vuelve a mostrarse en Bs 10. El escalón ganado
 * no se pierde: a las 07:00 del 27 el precio retoma donde se quedó (Bs 18) y
 * sigue subiendo Bs 1 por hora hasta tocar los Bs 30 a las 19:00, donde se
 * congela para siempre.
 *
 * Se calcula sobre la hora de Bolivia (UTC-4 todo el año, sin horario de
 * verano), igual en el servidor y en el navegador: las fechas están en UTC para
 * que un visitante con el reloj mal no vea otro precio.
 *
 * Las monedas distintas de BOB siguen saliendo de la conversión con su margen
 * (`MARKUP` de `@/lib/currency`), así que heredan el precio del momento.
 */

/** Precio tope por código, en Bs. */
export const PRECIO_NORMAL = 30;
/** Precio inicial de la escalera (y de la pausa), en Bs. */
export const PRECIO_OFERTA = 10;
/** Cada cuánto sube: una hora. */
export const PASO_MS = 60 * 60 * 1000;
/** Escalones entre el precio inicial y el tope. */
export const PASOS_HASTA_TOPE = PRECIO_NORMAL - PRECIO_OFERTA;

/** 26/10/2026 16:00 en Bolivia (UTC-4) = 20:00 UTC. */
export const INICIO_OFERTA = new Date("2026-10-26T20:00:00.000Z");

/** La pausa va de las 00:00 a las 07:00 de Bolivia, todos los días. */
const PAUSA_DESDE_HORA = 0;
const PAUSA_HASTA_HORA = 7;

/** Hora del día en Bolivia (0-23) para un instante cualquiera. */
function horaBolivia(ahora: Date): number {
  return (ahora.getUTCHours() + 20) % 24;
}

/**
 * ¿La escalera está detenida? De medianoche a 7 de la mañana la oferta vuelve a
 * Bs 10 y no se gana ningún escalón: el precio que había queda guardado.
 */
export function enPausa(ahora: Date): boolean {
  const hora = horaBolivia(ahora);
  return hora >= PAUSA_DESDE_HORA && hora < PAUSA_HASTA_HORA;
}

/**
 * Escalones ganados hasta `ahora`: los aumentos que ya pasaron y que no cayeron
 * dentro de la pausa.
 */
function escalones(ahora: Date): number {
  const total = Math.floor((ahora.getTime() - INICIO_OFERTA.getTime()) / PASO_MS);
  let contados = 0;
  for (let k = 1; k <= total; k++) {
    if (contados >= PASOS_HASTA_TOPE) break;
    const instante = new Date(INICIO_OFERTA.getTime() + k * PASO_MS);
    if (enPausa(instante)) continue;
    contados++;
  }
  return contados;
}

/**
 * Precio vigente para un instante: Bs 10 al arrancar, +1 por cada hora que no
 * sea de pausa, y Bs 10 otra vez mientras la escalera está detenida.
 */
export function precioAhora(ahora: Date = new Date()): number {
  if (ahora.getTime() < INICIO_OFERTA.getTime()) return PRECIO_OFERTA;
  if (enPausa(ahora)) return PRECIO_OFERTA;
  return Math.min(PRECIO_NORMAL, PRECIO_OFERTA + escalones(ahora));
}

/** Primer instante en que el precio llega al tope (y ya no sube más). */
function instanteDelTope(): Date {
  for (let k = 1; k <= PASOS_HASTA_TOPE * 3; k++) {
    const instante = new Date(INICIO_OFERTA.getTime() + k * PASO_MS);
    if (precioAhora(instante) >= PRECIO_NORMAL) return instante;
  }
  return new Date(INICIO_OFERTA.getTime() + PASOS_HASTA_TOPE * PASO_MS);
}

/** Cuando la escalera toca el tope: 27/10/2026 19:00 en Bolivia. */
export const FIN_OFERTA = instanteDelTope();

/** Progreso de la escalera (0 al empezar, 1 al llegar al tope). */
export function progresoOferta(ahora: Date): number {
  const precio = precioAhora(ahora);
  if (precio >= PRECIO_NORMAL) return 1;
  if (ahora.getTime() < INICIO_OFERTA.getTime()) return 0;
  // En la pausa el precio se muestra en Bs 10, pero la escalera no retrocede:
  // la barra sigue donde la dejó el último escalón ganado.
  return Math.min(1, escalones(ahora) / PASOS_HASTA_TOPE);
}

/**
 * Momento del próximo aumento, o `null` si ya está en el tope. Durante la pausa
 * devuelve las 07:00, cuando la escalera retoma donde se quedó.
 */
export function siguienteAumento(ahora: Date = new Date()): Date | null {
  const precio = precioAhora(ahora);
  if (precio >= PRECIO_NORMAL) return null;
  for (let k = 1; k <= PASOS_HASTA_TOPE * 3; k++) {
    const instante = new Date(INICIO_OFERTA.getTime() + k * PASO_MS);
    if (instante.getTime() <= ahora.getTime()) continue;
    if (precioAhora(instante) > precio) return instante;
  }
  return null;
}

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

export function getFaseActual(ahora: Date = new Date()): EstadoFase {
  const precio = precioAhora(ahora);
  const enOferta = precio < PRECIO_NORMAL;
  const proximo = siguienteAumento(ahora);
  return {
    precio,
    original: PRECIO_NORMAL,
    etiqueta: "Oferta de lanzamiento",
    etiquetaEn: "Launch offer",
    enOferta,
    finOferta: enOferta && proximo ? proximo.toISOString() : null,
    msParaFin: enOferta && proximo ? Math.max(0, proximo.getTime() - ahora.getTime()) : 0,
  };
}
