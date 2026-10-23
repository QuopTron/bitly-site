import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { retraso } from "@/lib/reveal";
import BrushStroke from "@/components/ui/brush-stroke";

type Props = {
  tagline: string;
  description: string;
  version: string | null;
};

export default function HeroTexto({ tagline, description, version }: Props) {
  const t = useI18n();
  const corte = tagline.indexOf(",");
  const primera = corte >= 0 ? tagline.slice(0, corte + 1) : tagline;
  const segunda = corte >= 0 ? tagline.slice(corte + 1).trim() : "";

  return (
    <>
      <div data-reveal suppressHydrationWarning style={retraso(0)} className="etiqueta w-fit -rotate-1">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        {version ? `${t("heroBadge")} · ${version}` : t("heroBadge")}
      </div>

      <div data-reveal suppressHydrationWarning style={retraso(80)}>
        <h1 className="texto-tag titulo-aerosol text-[2.45rem] leading-[0.9] tracking-tight sm:text-6xl lg:text-[3.9rem] 2xl:text-[4.8rem]">
          <span className="block bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradiente-marca)" }}>
            {primera}
          </span>
          {segunda && (
            <span className="block bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradiente-marca)" }}>
              {segunda}
            </span>
          )}
        </h1>
        <BrushStroke className="-mt-1 h-4 w-[min(16rem,72%)] text-primary sm:h-5 sm:w-[20rem]" />
      </div>

      <p
        data-reveal
        suppressHydrationWarning
        style={retraso(150)}
        className="hero-descripcion max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base"
      >
        {description || t("heroDescription")}
      </p>
    </>
  );
}
