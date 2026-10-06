import { useEffect, useRef } from "react";

/**
 * Barra de progreso de lectura, pegada al borde de arriba.
 *
 * Mide con `transform: scaleX()` —compositor, sin layout— y sólo escribe en el
 * DOM dentro de un `requestAnimationFrame`: por más que el dedo arrastre rápido,
 * hay como mucho una escritura por frame. El estado inicial va en el atributo
 * `style` (no con una clase de escala de Tailwind) para no pelearse con el
 * `transform` que se escribe a mano.
 */
export default function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pendiente = 0;

    const pintar = () => {
      pendiente = 0;
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      const avance = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
      el.style.transform = `scaleX(${avance})`;
    };

    // `scroll` dispara decenas de veces por segundo: se coalesce a un frame.
    const alScrollear = () => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(pintar);
    };

    pintar();
    window.addEventListener("scroll", alScrollear, { passive: true });
    window.addEventListener("resize", alScrollear, { passive: true });
    return () => {
      if (pendiente) cancelAnimationFrame(pendiente);
      window.removeEventListener("scroll", alScrollear);
      window.removeEventListener("resize", alScrollear);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div
        ref={ref}
        style={{ transform: "scaleX(0)" }}
        className="h-full w-full origin-left bg-gradient-to-r from-primary via-accent to-primary"
      />
    </div>
  );
}
