import { useEffect } from "react";
import { aplicarIdiomaGuardado } from "./i18n";
import { arrancarMoneda } from "./currency";

/**
 * Aplica el idioma y la moneda guardados, pero sólo DESPUÉS de hidratar.
 *
 * El servidor pinta siempre en español y BOB, y ese HTML es con el que React
 * compara el primer render del cliente: si el localStorage se leyera antes
 * (al cargar un módulo o desde un efecto fuera del contenido de la ruta),
 * un visitante con "en"/USD hidrataría texto distinto al del servidor y
 * React regeneraría el árbol (#418).
 *
 * Por eso este hook vive en los componentes que son el CONTENIDO de la ruta
 * (índice, 404, error): sus efectos corren recién cuando ese contenido
 * hidrató, y los suscriptores (useI18n, useCurrency, useLanguage) repintan
 * con lo guardado apenas se aplica.
 */
export function usePreferenciasGuardadas(): void {
  useEffect(() => {
    aplicarIdiomaGuardado();
    arrancarMoneda();
  }, []);
}
