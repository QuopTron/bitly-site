import { Download, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Estrellas, con } from "@/components/comentarios/carrusel-opiniones";

type Props = {
  total: number;
  vistas: number;
  promedio: number;
  opiniones: number;
};

const numero = (n: number) => new Intl.NumberFormat("es-ES").format(n);

/** Pie del hero: visitas, descargas y promedio de estrellas, sin adornos. */
export default function HeroPie({ total, vistas, promedio, opiniones }: Props) {
  const t = useI18n();
  const proporcion = vistas > 0 ? Math.min(999, Math.round((total / vistas) * 100)) : 0;

  return (
    <footer className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border/50 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-primary" aria-hidden />
          <strong className="tabular-nums text-foreground">{numero(vistas)}</strong>
          {t("opinionesVistas")}
        </span>

        <span aria-hidden className="h-4 w-px bg-border/70" />

        <span className="inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5 text-primary" aria-hidden />
          <strong className="tabular-nums text-foreground">{numero(total)}</strong>
          {t("comentariosDescargas")}
        </span>

        <span aria-hidden className="h-4 w-px bg-border/70" />

        <span className="inline-flex items-center gap-1.5">
          <Estrellas valor={promedio} etiqueta={con(t("opinionesEstrella"), { n: promedio.toFixed(1) })} />
          <strong className="tabular-nums text-foreground">{promedio.toFixed(1)}</strong>
          <span className="text-muted-foreground/80">
            {opiniones === 1 ? t("opinionesUna") : con(t("opinionesCuantas"), { n: opiniones })}
          </span>
        </span>
      </div>

      <span className="texto-marker rotate-[-2deg] text-[11px] text-muted-foreground sm:text-xs">
        {t("heroConversion").replace("{n}", String(proporcion))}
      </span>
    </footer>
  );
}
