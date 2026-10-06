/**
 * Reglas de las opiniones: qué cuenta como nombre/estrellas/texto válido y
 * cuántos envíos se aguantan por IP.
 *
 * Vive aparte de `src/server/opiniones.ts` a propósito: así la regla se puede
 * probar sola, sin base de datos y sin arrastrar el runtime del servidor
 * (`scripts/probar-opiniones.mjs` la corre contra este mismo módulo, no contra
 * una copia). No tiene secretos ni toca la red, así que también puede
 * importarla el cliente.
 */

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 24;
export const TEXTO_MIN = 2;
export const TEXTO_MAX = 400;

/** Topes del cupo de envíos. */
export const VENTANA_MS = 10 * 60 * 1000;
export const MAX_POR_IP = 3;
export const MAX_GLOBAL = 60;

/**
 * Normaliza y valida un texto: colapsa los espacios repetidos, recorta los
 * extremos y comprueba el largo.
 *
 * Devuelve `null` si no sirve. No escapa nada porque React escapa al
 * renderizar; lo que se descarta acá es basura de formato, no HTML.
 */
export function limpiarTexto(valor: unknown, min: number, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (limpio.length < min || limpio.length > max) return null;
  return limpio;
}

/** Valida las estrellas: entero de 1 a 5. */
export function limpiarEstrellas(valor: unknown): number | null {
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * Cuántas opiniones tiene cada nota, de 1 a 5 estrellas.
 *
 * Siempre devuelve cinco casillas: lo que llega de la base puede faltar (si la
 * migración es vieja y no devuelve `reparto`), venir como texto, o traer un
 * negativo. Acá se deja en enteros no negativos para que el dibujo no tenga que
 * defenderse.
 */
export function normalizarReparto(valor: unknown): number[] {
  const casillas = [0, 0, 0, 0, 0];
  if (!Array.isArray(valor)) return casillas;
  for (let i = 0; i < 5; i++) {
    const n = Number(valor[i]);
    casillas[i] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return casillas;
}

/**
 * Cupo por ventana deslizante, por clave (la IP) y global.
 *
 * Es una fábrica para poder crear instancias aisladas en las pruebas; el sitio
 * usa una sola, la de abajo.
 *
 * Es una red floja —vive en la memoria de cada instancia del worker, así que un
 * despliegue la reinicia y varias instancias no se ven entre sí— pero frena el
 * caso normal: alguien apretando "enviar" o un script simple.
 */
export function crearCupo(maxPorClave = MAX_POR_IP, maxGlobal = MAX_GLOBAL, ventanaMs = VENTANA_MS) {
  const porClave = new Map<string, { n: number; t: number }>();
  const global = { n: 0, t: 0 };

  return function hayCupo(clave: string, ahora = Date.now()): boolean {
    if (ahora - global.t > ventanaMs) {
      global.t = ahora;
      global.n = 0;
    }
    if (++global.n > maxGlobal) return false;

    const previo = porClave.get(clave);
    if (!previo || ahora - previo.t > ventanaMs) {
      porClave.set(clave, { n: 1, t: ahora });
      // Techo de memoria: si entró muchísima gente distinta, se empieza de cero
      // en vez de crecer sin límite.
      if (porClave.size > 500) porClave.clear();
      return true;
    }
    previo.n++;
    return previo.n <= maxPorClave;
  };
}

/** La instancia que usa el sitio. */
export const hayCupo = crearCupo();
