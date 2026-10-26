"use client";

import { useEffect, useState } from "react";
import { getFaseActual, type EstadoFase } from "@/lib/pricing";

/**
 * Precio vigente que se refresca cada segundo.
 *
 * En el primer render (servidor y cliente) devuelve el precio calculado sin
 * reloj: así el HTML coincide. `vivo` pasa a true recién en el efecto, cuando
 * ya se puede mostrar la cuenta atrás sin romper la hidratación.
 */
export function useFaseActual(): { fase: EstadoFase; vivo: boolean } {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setAhora(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return { fase: getFaseActual(ahora ?? undefined), vivo: ahora !== null };
}
