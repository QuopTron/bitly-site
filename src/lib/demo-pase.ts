/**
 * Pase de la demo: el mismo precio que Premium, que sube con el reloj.
 *
 * No es un precio por visitante: es la oferta de lanzamiento del sitio, así que
 * sale del MISMO reloj que `@/lib/pricing`. Arranca el 26 a las 16:00 en Bs 10,
 * suma Bs 1 por hora hasta las 23:00 (Bs 17), se detiene de medianoche a 7 de la
 * mañana —ahí vuelve a mostrarse en Bs 10— y el 27 a las 07:00 retoma donde se
 * quedó (Bs 18) hasta congelarse en Bs 30 a las 19:00.
 *
 * Antes esto vivía en localStorage y arrancaba cuando el visitante agotaba sus
 * 4 reproducciones: dos personas veían precios distintos y un reloj viejo podía
 * dejar a alguien pagando el tope sin haber esperado nada. Con un solo reloj,
 * lo que dice la pared es lo mismo que dice la sección de planes.
 */

import {
  INICIO_OFERTA,
  PASO_MS,
  PRECIO_NORMAL,
  PRECIO_OFERTA,
  PASOS_HASTA_TOPE,
  precioAhora,
  siguienteAumento,
} from "@/lib/pricing";

/** Primer precio, en bolivianos. */
export const PASE_BASE_BS = PRECIO_OFERTA;
/** Cada cuánto sube. */
export const PASE_PASO_MS = PASO_MS;
/** Precio máximo (Bs 30). */
export const PASE_TOPE_BS = PRECIO_NORMAL;
/** Escalones desde el arranque hasta el tope (Bs 10 → Bs 30 = 20). */
export const PASE_HORA_TOPE = PASOS_HASTA_TOPE;
/** Sin horas de gracia: la subida es cada hora desde el arranque. */
export const PASE_GRACIA_HORAS = 0;

export type EstadoPase = {
  /** Precio actual, en bolivianos. */
  bs: number;
  /** Horas de reloj desde que arrancó la oferta. */
  horas: number;
  /** Milisegundos hasta el próximo aumento (0 si ya está en el tope). */
  siguienteEnMs: number;
  /** ¿Llegó al tope y ya no sube? */
  congelado: boolean;
  /** Horas de gracia restantes (siempre 0: la escalera sube desde ya). */
  graciaRestante: number;
};

/**
 * Compatibilidad: la pared muestra el precio del momento. Se mantiene la
 * función porque el componente la llama al montar; ya no guarda nada.
 */
export function marcarInicioPase(ahora = Date.now()): number {
  return ahora;
}

/** Cuándo arrancó la escalera, o `null` si todavía no empezó. */
export function inicioPase(): number | null {
  const inicio = INICIO_OFERTA.getTime();
  return inicio <= Date.now() ? inicio : null;
}

/** Precio del pase para un instante dado. */
export function estadoPase(ahora = Date.now()): EstadoPase {
  const fecha = new Date(ahora);
  const bs = precioAhora(fecha);
  const congelado = bs >= PASE_TOPE_BS;
  const proximo = congelado ? null : siguienteAumento(fecha);
  const transcurrido = Math.max(0, ahora - INICIO_OFERTA.getTime());
  return {
    bs,
    horas: Math.floor(transcurrido / PASE_PASO_MS),
    siguienteEnMs: proximo ? Math.max(0, proximo.getTime() - ahora) : 0,
    congelado,
    graciaRestante: 0,
  };
}

/** Texto corto para el contador: `42:13` (o `3 h 07 min` si falta más). */
export function cuentaRegresiva(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
