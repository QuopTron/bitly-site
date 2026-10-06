import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
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

function bloquearFondo() {
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

function soltarFondo() {
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
export default function ModalWrapper({ open, onClose, title, subtitle, icon, children }: Props) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-gradient-to-b from-card to-card/90 p-5 shadow-2xl shadow-primary/[0.04] ring-1 ring-border/50 outline-none animate-in zoom-in-95 duration-200 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("installClose")}
          className="sticky top-0 z-20 float-right mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-card/80 text-muted-foreground shadow-lg transition-all duration-200 hover:bg-card hover:text-foreground hover:shadow-primary/10 active:scale-90 sm:h-8 sm:w-8"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="mb-4 text-center sm:mb-5">
          {icon && <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/20 sm:h-12 sm:w-12">{icon}</div>}
          <h2 id={tituloId} className="text-lg font-bold text-foreground sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
