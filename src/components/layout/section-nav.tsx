"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, Home, MessageCircle, MessageSquare, Music, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Barra de secciones del sitio.
 *
 * Aparece pegada arriba apenas pasás el encabezado, así se salta a cualquier
 * sección sin tener que subir a buscarla. En el celular la fila se arrastra en
 * horizontal (se acompaña sola hasta la sección activa) y en pantallas grandes
 * entra completa y centrada.
 *
 * Todo el costo está pensado para gama baja: pegarse es CSS puro (`position:
 * sticky`) —no hay ningún escucha de scroll—, y la sección activa la resuelve un
 * único `IntersectionObserver` con una banda angosta en el medio de la pantalla.
 * El salto a las anclas lo hace el `scroll-behavior: smooth` del CSS, que ya se
 * apaga solo con "menos movimiento".
 */

/**
 * Las secciones del sitio, en el orden en que aparecen.
 *
 * `inicio` es el encabezado, arriba de todo: apunta a la portada completa
 * (título y botones de descarga), no a los botones sueltos —caer en el medio del
 * hero dejaba el título cortado arriba y se veía raro—.
 */
const SECCIONES = [
  { id: "inicio", clave: "navInicio", Icono: Home },
  { id: "demo", clave: "navDemo", Icono: Music },
  { id: "instalar", clave: "navInstalar", Icono: Smartphone },
  { id: "opiniones", clave: "navOpiniones", Icono: MessageSquare },
  { id: "planes", clave: "navPlanes", Icono: CreditCard },
  { id: "contacto", clave: "navContacto", Icono: MessageCircle },
] as const;

export default function SectionNav() {
  const t = useI18n();
  const [activa, setActiva] = useState<string>(SECCIONES[0].id);
  const fila = useRef<HTMLDivElement | null>(null);
  const marcas = useRef<Array<HTMLAnchorElement | null>>([]);

  // Dos observaciones, ninguna atada al scroll.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observadores: IntersectionObserver[] = [];

    // Las secciones de contenido: una banda angosta y centrada, así queda
    // activa la que está pasando por el medio y no la que apenas asoma.
    const contenido = SECCIONES.filter((s) => s.id !== "inicio")
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (contenido.length) {
      const observador = new IntersectionObserver(
        (entradas) => {
          for (const entrada of entradas) if (entrada.isIntersecting) setActiva(entrada.target.id);
        },
        { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
      );
      contenido.forEach((el) => observador.observe(el));
      observadores.push(observador);
    }

    // El encabezado está arriba de todo, fuera de esa banda: se mira aparte, con
    // una franja pegada al borde de arriba. Sin esto, al volver al principio
    // quedaba marcada la última sección en vez de "Inicio".
    const cabecera = document.getElementById("inicio");
    if (cabecera) {
      const observador = new IntersectionObserver(
        (entradas) => {
          for (const entrada of entradas) if (entrada.isIntersecting) setActiva("inicio");
        },
        { rootMargin: "0px 0px -80% 0px", threshold: 0 },
      );
      observador.observe(cabecera);
      observadores.push(observador);
    }

    return () => observadores.forEach((o) => o.disconnect());
  }, []);

  // En el celular la fila se arrastra: se acerca la sección activa, sin mover la
  // página ni animar de más (con "menos movimiento" el corrimiento es de una).
  useEffect(() => {
    const caja = fila.current;
    const indice = SECCIONES.findIndex((s) => s.id === activa);
    const el = marcas.current[indice];
    if (!caja || !el || caja.scrollWidth <= caja.clientWidth) return;
    const centro = el.offsetLeft + el.offsetWidth / 2 - caja.clientWidth / 2;
    const suave = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    caja.scrollTo({ left: Math.max(0, centro), behavior: suave ? "smooth" : "auto" });
  }, [activa]);

  return (
    <nav
      aria-label={t("navSecciones")}
      className="sticky top-0 z-40 border-b border-border/60 bg-background/95 sm:backdrop-blur"
    >
      {/* En el celular la fila entra más apretada (gap, padding y tipografía
          más chicos) para que se vean más pestañas sin arrastrar; de `sm` para
          arriba vuelve al tamaño cómodo y se centra. */}
      <div
        ref={fila}
        className="nav-scroll container mx-auto flex items-center gap-1 overflow-x-auto px-3 py-2 sm:justify-center sm:gap-2 sm:px-6"
      >
        {SECCIONES.map(({ id, clave, Icono }, i) => {
          const activo = activa === id;
          return (
            <a
              key={id}
              ref={(el) => {
                marcas.current[i] = el;
              }}
              href={`#${id}`}
              aria-current={activo ? "location" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-1.5 sm:px-3.5 sm:text-xs ${
                activo
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
            >
              <Icono className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
              {t(clave)}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
