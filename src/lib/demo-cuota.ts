/**
 * Cuota del reproductor de prueba.
 *
 * 4 reproducciones cada 2 HORAS: la ventana es DESLIZANTE, así que apenas la
 * más vieja cumple las 2 horas vuelve a haber lugar sin recargar nada. No es un
 * "se acabó para siempre": la demo tiene que dejar probar, y quien quiera más
 * sigue escuchando con un código Premium (ilimitado) o se lleva la app.
 *
 * El estado vive en localStorage como los INSTANTES en que se gastó cada
 * reproducción, así que recargar no regenera nada y la ventana se calcula sola.
 * El canje de Premium sí se revalida contra el servidor antes de confiar en él:
 * si el código pasa a "usado" o "cancelado" después, el desbloqueo local deja
 * de servir y hay que volver a meter otro código.
 */

import { useCallback, useEffect, useState } from "react";

const CLAVE = "bitly_demo_cuota";
const CLAVE_PREMIUM = "bitly_demo_premium";

/** Reproducciones que entran en cada ventana. */
export const REPRODUCCIONES = 4;
/** Cuánto dura la ventana: pasado esto, la reproducción más vieja se libera. */
export const VENTANA_MS = 2 * 60 * 60 * 1000;

/** Lo que devuelve el servidor al canjear un código. */
export type EstadoCodigo = "ok" | "no_encontrado" | "usado" | "cancelado" | "liberado" | "desconocido";

export type Cuota = {
  gastadas: number;
  restantes: number;
  sinCuota: boolean;
  premium: boolean;
  /** Milisegundos hasta que la próxima reproducción se libere (0 si hay lugar). */
  reiniciaEnMs: number;
  /** True si hay un canje guardado que aún no se revalidó en esta sesión. */
  porRevalidar: boolean;
  gastar: () => boolean;
  activarPremium: (codigo: string) => void;
  limpiarPremium: () => void;
  /** Vacía las reproducciones (se usa al volver a la prueba desde cero). */
  reiniciar: () => void;
};

type Guardado = { veces: number[] };

function leerVeces(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Partial<Guardado> | null;
    if (!Array.isArray(v?.veces)) return [];
    return v.veces.filter((n) => typeof n === "number" && Number.isFinite(n));
  } catch {
    return [];
  }
}

/**
 * Solo las marcas que todavía caen dentro de la ventana deslizante. Exportada
 * (con `calcularCuota`) para poder verificar la regla de las 2 horas sin
 * montar React: ver `scripts/probar-cuota.mjs`.
 */
export function dentroDeVentana(veces: number[], ahora: number): number[] {
  return veces.filter((t) => ahora - t < VENTANA_MS);
}

/**
 * Estado derivado de las marcas guardadas: cuántas quedan y, si no queda
 * ninguna, en cuánto se libera la próxima. Es la ÚNICA regla de la cuota.
 */
export function calcularCuota(
  veces: number[],
  ahora: number,
): { gastadas: number; restantes: number; reiniciaEnMs: number } {
  const activas = dentroDeVentana(veces, ahora);
  const restantes = Math.max(0, REPRODUCCIONES - activas.length);
  return {
    gastadas: activas.length,
    restantes,
    // La que se libera antes es la MÁS VIEJA: su instante + la ventana.
    reiniciaEnMs: restantes === 0 ? Math.max(0, Math.min(...activas) + VENTANA_MS - ahora) : 0,
  };
}

function leerPremium(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CLAVE_PREMIUM);
}

function guardarVeces(veces: number[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ veces } satisfies Guardado));
  } catch {
    // Sin almacenamiento la cuota vive solo en memoria.
  }
}

export function useCuota(): Cuota {
  const [veces, setVeces] = useState(leerVeces);
  // Este reloj solo sirve para que el contador se refresque cuando la ventana
  // se corre estando la pestaña abierta (si no, "sin reproducciones" quedaría
  // pegado hasta el próximo render).
  const [ahora, setAhora] = useState(() => Date.now());

  // Se guarda el código, no un "sí": hace falta para revalidar contra el
  // registro al recargar, y así un código que pasa a "usado" deja de servir.
  const [codigo, setCodigo] = useState(leerPremium);
  const premium = codigo !== null;

  // El canje guardado se revalida al abrir la página: un código que después
  // pasa a "usado" o "cancelado" tiene que dejar de desbloquear.
  const [revalidado, setRevalidado] = useState(() => leerPremium() === null);

  useEffect(() => {
    if (!codigo || revalidado) return;
    let vivo = true;
    import("@/lib/premium-check")
      .then((m) => m.revalidarPremium({ data: { codigo } }))
      .then((r) => {
        if (!vivo) return;
        if (r.estado !== "ok") {
          try {
            localStorage.removeItem(CLAVE_PREMIUM);
          } catch {}
          setCodigo(null);
        }
        setRevalidado(true);
      })
      .catch(() => vivo && setRevalidado(true));
    return () => {
      vivo = false;
    };
  }, [codigo, revalidado]);

  const { gastadas, restantes, reiniciaEnMs } = calcularCuota(veces, ahora);
  const sinCuota = restantes === 0;

  // Con la cuota agotada, un reloj despierta justo cuando se libera la próxima.
  useEffect(() => {
    if (premium || !sinCuota) return;
    const reloj = setTimeout(() => setAhora(Date.now()), Math.max(500, reiniciaEnMs + 250));
    return () => clearTimeout(reloj);
  }, [premium, sinCuota, reiniciaEnMs]);

  const gastar = useCallback(() => {
    const momento = Date.now();
    // Se limpia lo vencido al gastar para que el arreglo no crezca sin fin.
    const vivas = dentroDeVentana(veces, momento);
    if (vivas.length >= REPRODUCCIONES || premium) return false;
    const siguiente = [...vivas, momento];
    guardarVeces(siguiente);
    setVeces(siguiente);
    setAhora(momento);
    return true;
  }, [veces, premium]);

  const activarPremium = useCallback((nuevo: string) => {
    try {
      localStorage.setItem(CLAVE_PREMIUM, nuevo);
    } catch {}
    setCodigo(nuevo);
    setRevalidado(true);
    // Con Premium el contador deja de mandar, pero se limpia para que si
    // alguien revierte el canje no aparezca sin reproducciones.
    guardarVeces([]);
    setVeces([]);
  }, []);

  const limpiarPremium = useCallback(() => {
    try {
      localStorage.removeItem(CLAVE_PREMIUM);
    } catch {}
    setCodigo(null);
    setRevalidado(false);
  }, []);

  const reiniciar = useCallback(() => {
    guardarVeces([]);
    setVeces([]);
  }, []);

  return {
    gastadas,
    restantes,
    sinCuota,
    premium,
    reiniciaEnMs,
    porRevalidar: premium && !revalidado,
    gastar,
    activarPremium,
    limpiarPremium,
    reiniciar,
  };
}
