/**
 * Pase de la demo: precio que sube con el tiempo.
 *
 * Cuando se acaban las 4 reproducciones gratis, el pase arranca en Bs 1 y sube
 * Bs 1 por cada hora que pasa, hasta congelarse en Bs 30 para siempre. La idea
 * es simple de explicar y de comprobar: cuanto antes lo tomes, más barato sale,
 * y nunca pasa de 30.
 *
 * El "desde cuándo" vive en localStorage (es un precio por visitante, no una
 * cuenta): si borra los datos del navegador vuelve a empezar, igual que la
 * cuota. La hora se mide en tiempo real, no en horas de reloj, para que no se
 * pueda "esperar al cambio de hora".
 */

const CLAVE = "bitly_demo_pase_desde";
/** Primer precio, en bolivianos. */
export const PASE_BASE_BS = 1;
/** Cada cuánto sube. */
export const PASE_PASO_MS = 60 * 60 * 1000;
/** Precio máximo: al llegar acá se queda para siempre. */
export const PASE_TOPE_BS = 30;

export type EstadoPase = {
  /** Precio actual, en bolivianos. */
  bs: number;
  /** Horas completas desde que se agotó el cupo. */
  horas: number;
  /** Milisegundos hasta el próximo aumento (0 si ya está congelado). */
  siguienteEnMs: number;
  /** ¿Llegó al tope y ya no sube? */
  congelado: boolean;
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
  const bs = Math.min(PASE_TOPE_BS, PASE_BASE_BS + horas);
  const congelado = bs >= PASE_TOPE_BS;
  const restante = PASE_PASO_MS - (transcurrido % PASE_PASO_MS);
  return { bs, horas, siguienteEnMs: congelado ? 0 : restante, congelado };
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
