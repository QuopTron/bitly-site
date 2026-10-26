/**
 * Pase de la demo: precio que sube con el tiempo.
 *
 * Cuando se acaban las 4 reproducciones gratis, el pase arranca en Bs 10 y se
 * queda ahí durante las primeras 3 horas. A la 4.ª hora pasa a Bs 11, a la 5.ª
 * a Bs 12, y así suma Bs 1 por cada hora que pasa, sin techo: cada hora que se
 * deja pasar cuesta un boliviano más. Tomarlo temprano siempre sale más barato.
 *
 * El "desde cuándo" vive en localStorage (es un precio por visitante, no una
 * cuenta): si borra los datos del navegador vuelve a empezar, igual que la
 * cuota. La hora se mide en tiempo real, no en horas de reloj, para que no se
 * pueda "esperar al cambio de hora".
 */

const CLAVE = "bitly_demo_pase_desde";
/** Primer precio, en bolivianos. */
export const PASE_BASE_BS = 10;
/** Cada cuánto sube. */
export const PASE_PASO_MS = 60 * 60 * 1000;
/**
 * Horas de gracia: mientras el pase lleve menos de esta cantidad de horas
 * completas, el precio sigue en `PASE_BASE_BS`. Con 3, la primera subida cae
 * al empezar la 4.ª hora (Bs 11), la siguiente en la 5.ª (Bs 12) y así.
 */
export const PASE_GRACIA_HORAS = 3;
/** Precio máximo: se alcanza a la hora 23 y de ahí no sube más. */
export const PASE_TOPE_BS = 30;
/** Hora en la que el precio toca el techo (Bs 30). */
export const PASE_HORA_TOPE = PASE_GRACIA_HORAS + (PASE_TOPE_BS - PASE_BASE_BS);

export type EstadoPase = {
  /** Precio actual, en bolivianos. */
  bs: number;
  /** Horas completas desde que se agotó el cupo. */
  horas: number;
  /** Milisegundos hasta el próximo aumento (0 si ya está en el techo). */
  siguienteEnMs: number;
  /** ¿Llegó al techo y ya no sube? */
  congelado: boolean;
  /** Cuántas horas de gracia quedan antes de la primera subida (0 si ya subió). */
  graciaRestante: number;
};

function seguro(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Cuándo se agotó el cupo por primera vez, o `null` si todavía no pasó. */
export function inicioPase(): number | null {
  const crudo = seguro()?.getItem(CLAVE) ?? null;
  const n = Number(crudo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Marca el arranque del reloj (idempotente: no reinicia si ya estaba). */
export function marcarInicioPase(ahora = Date.now()): number {
  const previo = inicioPase();
  if (previo) return previo;
  seguro()?.setItem(CLAVE, String(ahora));
  return ahora;
}

/** Precio del pase para un instante dado. */
export function estadoPase(ahora = Date.now()): EstadoPase {
  const inicio = inicioPase();
  // Sin marca (nadie agotó el cupo todavía) se muestra el precio base.
  const desde = inicio ?? ahora;
  const transcurrido = Math.max(0, ahora - desde);
  const horas = Math.floor(transcurrido / PASE_PASO_MS);
  const subidas = Math.max(0, horas - PASE_GRACIA_HORAS);
  const bs = Math.min(PASE_TOPE_BS, PASE_BASE_BS + subidas);
  // El techo llega a la hora `PASE_HORA_TOPE` (Bs 30 a las 23 h): de ahí en
  // adelante el precio ya no sube.
  const congelado = bs >= PASE_TOPE_BS;

  // La primera subida cae al empezar la hora `PASE_GRACIA_HORAS + 1`; después,
  // una por hora. Se calcula sobre el reloj completo, no sobre el tramo actual,
  // para que el contador durante la gracia diga "3 h 12 min" y no "12 min".
  const proximaHora = Math.max(horas + 1, PASE_GRACIA_HORAS + 1);
  const siguienteEnMs = congelado ? 0 : Math.max(0, proximaHora * PASE_PASO_MS - transcurrido);

  return {
    bs,
    horas,
    siguienteEnMs,
    congelado,
    graciaRestante: Math.max(0, PASE_GRACIA_HORAS - horas),
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
