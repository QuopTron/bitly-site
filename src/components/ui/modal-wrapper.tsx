import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import BrushStroke from "@/components/ui/brush-stroke";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  ancho?: "normal" | "amplio";
  children: React.ReactNode;
};

/**
 * Cuántos diálogos tienen la página bloqueada, contado en el módulo.
 *
 * Con el estado dentro de cada componente, abrir A y después B guardaba
 * "bloqueado" como valor previo de B: al cerrar A se soltaba el fondo con B
 * todavía abierto y, peor, al cerrar B se volvía a bloquear —y quedaba así para
 * siempre, sin scroll—. Con el contador, la página se bloquea con el primero y
 * se suelta recién con el último.
 */
let bloqueados = 0;
let overflowPrevio = "";
let paddingPrevio = "";

export function bloquearFondo() {
  if (bloqueados === 0) {
    // Se compensa el ancho de la barra de scroll: sin esto, el contenido salta
    // a la derecha al desaparecer.
    const compensacion = window.innerWidth - document.documentElement.clientWidth;
    overflowPrevio = document.body.style.overflow;
    paddingPrevio = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (compensacion > 0) document.body.style.paddingRight = `${compensacion}px`;
  }
  bloqueados++;
}

export function soltarFondo() {
  bloqueados = Math.max(0, bloqueados - 1);
  if (bloqueados === 0) {
    document.body.style.overflow = overflowPrevio;
    document.body.style.paddingRight = paddingPrevio;
  }
}

/**
 * Chasis de los diálogos del sitio (código Premium, preguntas, celular,
 * descargas).
 *
 * Además del marco visual, se encarga de lo que no se ve:
 *
 *  - `Escape` cierra: quien navega con teclado no queda atrapado.
 *  - `role="dialog"` + `aria-modal` + el título enlazado: el lector de pantalla
 *    anuncia QUÉ se abrió y avisa que el resto quedó fuera.
 *  - El foco entra al diálogo al abrir y vuelve al botón de donde salió al
 *    cerrar.
 *  - La página de atrás no se arrastra mientras está abierto, y se compensa el
 *    ancho de la barra de scroll para que nada salte al bloquearla.
 */
export default function ModalWrapper({ open, onClose, title, subtitle, icon, ancho = "normal", children }: Props) {
  const t = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const tituloId = useId();

  useEffect(() => {
    if (!open) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const antes = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      // Sólo se devuelve el foco si sigue estando en el documento.
      if (antes && document.contains(antes)) antes.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    bloquearFondo();
    return soltarFondo;
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={`animate-in zoom-in-95 relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-foreground/25 bg-card sombra-tag outline-none duration-200 [border-radius:26px_6px_26px_6px] sm:max-h-[88dvh] ${
          ancho === "amplio" ? "max-w-2xl" : "max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/[0.07] to-transparent"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("installClose")}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/85 text-muted-foreground backdrop-blur transition-all duration-200 hover:border-foreground hover:text-foreground active:scale-90"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-width:none] sm:p-6 [&::-webkit-scrollbar]:hidden">
          <div className="mb-4 pr-8 sm:mb-5">
            {icon && (
              <div className="mancha mb-3 flex h-11 w-11 -rotate-3 items-center justify-center border border-primary/30 bg-primary/10 sm:h-12 sm:w-12">
                {icon}
              </div>
            )}
            <h2 id={tituloId} className="texto-tag text-2xl leading-tight text-foreground sm:text-3xl">
              {title}
            </h2>
            <BrushStroke className="mt-1 h-3 w-24 text-primary/70" />
            {subtitle && <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
