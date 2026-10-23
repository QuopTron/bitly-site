"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { VISTAS, type VistaId } from "@/lib/navegacion";

type Props = {
  activa: VistaId;
  onNavegar: (id: VistaId) => void;
};

/**
 * Riel de vistas del sitio.
 *
 * Ya no observa el scroll: el shell es quien sabe qué pantalla está activa y
 * este riel sólo la refleja. En desktop entra completa; si el ancho no alcanza,
 * se arrastra sola hasta la pestaña activa.
 */
export default function SectionNav({ activa, onNavegar }: Props) {
  const t = useI18n();
  const fila = useRef<HTMLDivElement | null>(null);
  const marcas = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const caja = fila.current;
    const indice = VISTAS.findIndex((v) => v.id === activa);
    const el = marcas.current[indice];
    if (!caja || !el || caja.scrollWidth <= caja.clientWidth) return;
    const margen = 10;
    const izquierda = el.offsetLeft;
    const derecha = izquierda + el.offsetWidth;
    let destino: number | null = null;
    if (izquierda - margen < caja.scrollLeft) destino = izquierda - margen;
    else if (derecha + margen > caja.scrollLeft + caja.clientWidth) {
      destino = derecha - caja.clientWidth + margen;
    }
    if (destino === null) return;
    const suave = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    caja.scrollTo({ left: Math.max(0, destino), behavior: suave ? "smooth" : "auto" });
  }, [activa]);

  return (
    <nav aria-label={t("navSecciones")} className="hidden min-w-0 flex-1 lg:block">
      <div
        ref={fila}
        className="nav-scroll flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-background/35 px-1.5 py-1 xl:justify-center lg:gap-1.5 lg:px-2"
      >
        {VISTAS.map(({ id, clave }, i) => {
          const activo = activa === id;
          return (
            <button
              key={id}
              ref={(el) => {
                marcas.current[i] = el;
              }}
              type="button"
              onClick={() => onNavegar(id)}
              aria-current={activo ? "page" : undefined}
              className={`texto-tag inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.78rem] outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-1.5 sm:px-3 sm:text-[0.82rem] ${
                activo
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
            >
              {t(clave)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
