/**
 * Cambio de pestaña deslizando, SOLO en celular.
 *
 * El sitio es un shell de pantalla completa: cada vista (inicio, instalar,
 * planes, demo) es un panel con su propio scroll y no hay página que scrollee
 * entre secciones. En una computadora la navegación está en la cabecera; en el
 * celular queda escondida en el menú, así que el gesto natural —seguir
 * deslizando hacia arriba— también pasa a la siguiente pestaña.
 *
 * Reglas, pensadas para no pelearse con el scroll normal ni con iOS/Android:
 *
 *  · Sólo se dispara al llegar al BORDE del panel: abajo para avanzar, arriba
 *    para volver. Si todavía queda contenido por ver, el gesto es scroll común.
 *  · Se decide en `touchend`, no en `touchmove`: no se llama a
 *    `preventDefault`, así el rebote elástico de iOS y el scroll de Android
 *    siguen funcionando igual. Nada de bloquear la página.
 *  · Hace falta un gesto vertical claro (más de 56 px y más vertical que
 *    horizontal) y rápido (< 1,2 s): un roce lateral de un carrusel o un toque
 *    largo no cambian de pestaña.
 *  · La vista `demo` NO participa: adentro hay listas, chips y karaoke con su
 *    propio scroll, y robarle el gesto rompería el reproductor. Se puede entrar
 *    a demo desde planes, pero no salir deslizando (se sale por el menú).
 *  · `[data-no-cambio-vista]` excluye cualquier zona interactiva que se agregue
 *    más adelante.
 *  · El ancho de corte es el mismo de la cabecera (1023 px): donde se ve el
 *    menú de escritorio, el gesto no existe.
 */

import { useEffect } from "react";
import { VISTAS, type VistaId } from "@/lib/navegacion";

const CONSULTA_MOVIL = "(max-width: 1023px)";
const UMBRAL_PX = 56;
const MAX_MS = 1_200;
const ESPERA_MS = 650;

export function useDeslizamientoVistas(vista: VistaId, onCambiar: (id: VistaId) => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const movil = window.matchMedia(CONSULTA_MOVIL);
    let arranque: { x: number; y: number; t: number } | null = null;
    let bloqueadoHasta = 0;

    const alEmpezar = (e: TouchEvent) => {
      arranque = null;
      if (!movil.matches || e.touches.length !== 1) return;
      const objetivo = e.target as HTMLElement | null;
      if (!objetivo || objetivo.closest("[data-no-cambio-vista]")) return;
      if (!objetivo.closest(`[data-vista="${vista}"]`)) return;
      const dedo = e.touches[0];
      arranque = { x: dedo.clientX, y: dedo.clientY, t: Date.now() };
    };

    const alTerminar = (e: TouchEvent) => {
      const inicio = arranque;
      arranque = null;
      if (!inicio || !movil.matches || Date.now() < bloqueadoHasta) return;
      if (vista === "demo") return;
      if (Date.now() - inicio.t > MAX_MS) return;

      const dedo = e.changedTouches[0];
      if (!dedo) return;
      const dx = dedo.clientX - inicio.x;
      const dy = dedo.clientY - inicio.y;
      if (Math.abs(dy) < UMBRAL_PX || Math.abs(dy) < Math.abs(dx) * 1.2) return;

      const panel = document.querySelector<HTMLElement>(`[data-vista="${vista}"]`);
      if (!panel) return;

      const indice = VISTAS.findIndex((v) => v.id === vista);
      if (indice < 0) return;

      const avanza = dy < 0;
      if (avanza) {
        const alFinal = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
        if (!alFinal || indice >= VISTAS.length - 1) return;
      } else {
        const alPrincipio = panel.scrollTop <= 4;
        if (!alPrincipio || indice <= 0) return;
      }

      const siguiente = VISTAS[indice + (avanza ? 1 : -1)].id;
      bloqueadoHasta = Date.now() + ESPERA_MS;
      onCambiar(siguiente);

      // La pestaña nueva arranca arriba: entrar a una sección por la mitad se
      // siente como caer dentro de algo que ya estaba abierto.
      requestAnimationFrame(() => {
        const nuevo = document.querySelector<HTMLElement>(`[data-vista="${siguiente}"]`);
        if (nuevo) nuevo.scrollTop = 0;
      });
    };

    const alCancelar = () => {
      arranque = null;
    };

    window.addEventListener("touchstart", alEmpezar, { passive: true });
    window.addEventListener("touchend", alTerminar, { passive: true });
    window.addEventListener("touchcancel", alCancelar, { passive: true });
    return () => {
      window.removeEventListener("touchstart", alEmpezar);
      window.removeEventListener("touchend", alTerminar);
      window.removeEventListener("touchcancel", alCancelar);
    };
  }, [vista, onCambiar]);
}
