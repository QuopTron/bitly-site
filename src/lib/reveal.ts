import type { CSSProperties } from "react";

/**
 * Aparición al entrar en pantalla.
 *
 * Un único `IntersectionObserver` para todo el sitio: los bloques se marcan con
 * `data-reveal` y reciben la clase `dentro` la primera vez que asoman a la
 * ventana. Se deja de observar cada uno en cuanto aparece (el efecto no se
 * repite al subir y bajar) y la animación es CSS puro sobre `transform` y
 * `opacity`, que el compositor resuelve sin repintar.
 *
 * El estado "oculto" lo pone `src/styles.css` sólo bajo `html.anim`, una clase
 * que el shell escribe desde el primer byte. Si no hay JS —o el sistema pide
 * menos movimiento— nada se esconde: se ve todo, quieto.
 *
 * Ojo con el orden: la home primero dibuja un spinner y recién después el
 * contenido, y las pestañas de instalación se remontan al cambiar. Por eso no
 * alcanza con mirar el DOM una sola vez — hace falta volver a mirar cuando
 * cambia. El `MutationObserver` sólo escucha cambios de estructura (no los
 * atributos ni el texto que React actualiza en cada frame del reproductor) y
 * coalesce todas las mutaciones de un mismo tick en una sola revisión.
 */

const SELECTOR = "[data-reveal]";

let observador: IntersectionObserver | null = null;
let mutaciones: MutationObserver | null = null;
let revision = 0;

/**
 * Retraso de la aparición, para escalonar bloques hermanos.
 *
 * Se pasa como variable CSS (no como `animation-delay`) para que el propio
 * `styles.css` decida cuánto dura: con movimiento reducido la animación no
 * existe y el retraso se ignora solo.
 */
export function retraso(ms: number): CSSProperties {
  return { "--reveal-delay": `${ms}ms` } as CSSProperties;
}

/**
 * Pone a mirar todo lo que quedó pendiente.
 *
 * Una revisión por tick: aunque el DOM cambie en varios lugares a la vez, se
 * recorre una sola vez.
 */
export function refrescarReveals(): void {
  if (typeof window === "undefined") return;
  if (revision) return;
  revision = window.requestAnimationFrame(() => {
    revision = 0;
    if (!observador) return;
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (!el.classList.contains("dentro")) observador!.observe(el);
    });
  });
}

/** Muestra de una el contenido (sin observador o sin ganas de animar). */
function mostrarTodo() {
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => el.classList.add("dentro"));
  document.documentElement.classList.remove("anim");
}

/**
 * Empieza a observar los bloques `data-reveal`. Devuelve una función para
 * desengancharse (la usa el `useEffect` que lo instala).
 */
export function instalarReveals(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // Navegadores sin IntersectionObserver, o quien pidió menos movimiento:
  // se muestra todo de una y se suelta la clase que ocultaba.
  if (reducido || typeof IntersectionObserver === "undefined") {
    mostrarTodo();
    return () => {};
  }

  observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add("dentro");
        observador?.unobserve(entrada.target);
      }
    },
    // El margen de abajo es un pelín negativo: cuando el bloque está por asomar
    // ya viene animándose, así no se ve "aparecer tarde" al bajar rápido.
    //
    // El de arriba es enorme A PROPÓSITO: así también cuenta como "a la vista"
    // todo lo que quedó por encima. Sin eso, un arrastre muy rápido (o entrar
    // directo a un `#ancla` que está al medio) podía dejar un bloque saltado y
    // en gris para siempre. Con esto, si el bloque llegó a pasar de largo,
    // igual se marca y se ve.
    { rootMargin: "9999px 0px -6% 0px", threshold: 0.06 },
  );

  refrescarReveals();

  mutaciones = new MutationObserver(refrescarReveals);
  mutaciones.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (revision) window.cancelAnimationFrame(revision);
    revision = 0;
    observador?.disconnect();
    observador = null;
    mutaciones?.disconnect();
    mutaciones = null;
  };
}
