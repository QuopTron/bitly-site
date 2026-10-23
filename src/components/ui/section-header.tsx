import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import BrushStroke from "./brush-stroke";

type Props = {
  numero?: string;
  icono: LucideIcon;
  badge: string;
  titulo: string;
  tituloId?: string;
  descripcion?: string;
  descripcionSoloEscritorio?: boolean;
  compacto?: boolean;
  extra?: ReactNode;
  className?: string;
};

/**
 * Encabezado editorial de sección: número de póster, etiqueta escrita a mano,
 * titular de spray y el texto de apoyo a la derecha. Reemplaza la pila de
 * "pill + h2 + rayita" que se repetía en todas las secciones.
 */
export default function SectionHeader({
  numero,
  icono: Icono,
  badge,
  titulo,
  tituloId,
  descripcion,
  descripcionSoloEscritorio = false,
  compacto = false,
  extra,
  className = "",
}: Props) {
  return (
    <header
      data-reveal
      suppressHydrationWarning
      className={`relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8 ${
        compacto ? "mb-5 sm:mb-8" : "mb-9 sm:mb-12"
      } ${className}`}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {numero && (
          <span aria-hidden className="flex h-12 w-12 shrink-0 -rotate-6 items-center justify-center rounded-full bg-primary text-2xl leading-none text-primary-foreground sombra-tag-suave sm:h-14 sm:w-14 sm:text-3xl">
            {numero}
          </span>
        )}
        <div className="min-w-0">
          <span className="etiqueta">
            <Icono className="h-3.5 w-3.5" aria-hidden />
            {badge}
          </span>
          <h2 id={tituloId} className="mt-3 max-w-2xl text-[2rem] leading-[0.94] sm:text-4xl md:text-5xl">
            {titulo}
          </h2>
          <BrushStroke className="mt-1 h-3 w-32 text-primary sm:w-44" />
        </div>
      </div>

      {(descripcion || extra) && (
        <div className="max-w-md shrink-0 sm:pb-1 sm:text-right">
          {descripcion && (
            <p className={`text-sm leading-relaxed text-muted-foreground sm:text-base ${descripcionSoloEscritorio ? "hidden sm:block" : ""}`}>
              {descripcion}
            </p>
          )}
          {extra}
        </div>
      )}
    </header>
  );
}
