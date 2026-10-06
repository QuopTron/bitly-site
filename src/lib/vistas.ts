/**
 * Contador de visitas: una por sesión.
 *
 * Se dispara al arrancar el sitio (ver `src/routes/__root.tsx`), no desde la
 * sección de opiniones, así cuenta al entrar a cualquier página y no depende de
 * que esa sección exista o se monte.
 *
 * Vive en el módulo, y no dentro de un componente, por dos motivos. Uno: en
 * desarrollo el marco monta los componentes dos veces, y la segunda no tiene que
 * pisar el resultado de la primera ni volver a contar. Dos: el total que
 * devuelve el servidor es el número bueno, así que quien lo muestre no depende
 * de un `resumen` que puede haber llegado antes de que la visita se guardara.
 *
 * La marca va en `sessionStorage`, no en `localStorage`: recargar no infla el
 * número, pero cerrar la pestaña y volver a entrar sí cuenta como visita nueva.
 */

import { supabase } from "@/integrations/supabase/client";

export const CLAVE_VISTA = "bitly_vista_contada";

let contando: Promise<number | null> | null = null;
let vistasContadas: number | null = null;

/**
 * Suma una visita y devuelve el total. Si ya se contó en esta sesión, devuelve
 * el valor que ya se había contado (o `null` si no se guardó en memoria, p. ej.
 * tras recargar la página).
 *
 * Es idempotente: llamarla varias veces no cuenta varias veces. Devuelve `null`
 * cuando no hay nada que mostrar (ya se contó o la base no contestó); en ese
 * caso conviene usar el valor del resumen.
 */
export function contarVista(): Promise<number | null> {
  if (vistasContadas !== null) return Promise.resolve(vistasContadas);
  if (contando) return contando;

  contando = (async () => {
    try {
      let yaContada = false;
      try {
        yaContada = sessionStorage.getItem(CLAVE_VISTA) === "1";
      } catch {
        yaContada = false;
      }
      if (yaContada) return null;
      try {
        sessionStorage.setItem(CLAVE_VISTA, "1");
      } catch {
        /* modo privado sin storage: se cuenta igual */
      }
      const { data, error } = await supabase.rpc("increment_vista");
      if (error) return null;
      // `Number` y no `typeof`: bigint llega como texto en algunas versiones.
      const total = Number(data);
      if (!Number.isFinite(total)) return null;
      vistasContadas = total;
      return total;
    } catch {
      return null;
    }
  })();

  // Si no se pudo, se suelta para poder reintentar en el próximo montaje.
  contando.then((total) => {
    if (total === null) contando = null;
  });
  return contando;
}
