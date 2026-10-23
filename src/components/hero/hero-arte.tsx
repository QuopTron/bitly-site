import splashBlanco from "@/assets/splash-blanco-640.webp";
import splashNegro from "@/assets/splash-negro-640.webp";
import { useI18n } from "@/lib/i18n";
import { retraso } from "@/lib/reveal";

const ETIQUETA = "texto-marker absolute rounded-full px-3 py-1.5 text-[11px] shadow-lg sm:text-xs";

export default function HeroArte() {
  const t = useI18n();

  return (
    <div
      data-reveal
      suppressHydrationWarning
      style={retraso(120)}
      className="hero-arte relative flex items-center justify-center lg:justify-end"
    >
      <div className="relative flex h-[165px] w-full max-w-[430px] 2xl:max-w-[540px] items-center justify-center sm:h-[290px] lg:h-[480px]">
        <span
          aria-hidden
          className="texto-tag pointer-events-none absolute right-0 top-1/2 hidden select-none text-[7rem] leading-none text-transparent opacity-20 sm:block lg:text-[8rem] 2xl:text-[9rem]"
          style={{ WebkitTextStroke: "2px currentColor", color: "var(--menta)", transform: "translateY(-50%) rotate(-8deg)" }}
        >
          BITLY
        </span>

        <div className="relative">
          <img
            src={splashBlanco}
            alt={t("heroArteAlt")}
            width={640}
            height={640}
            fetchPriority="high"
            decoding="async"
            className="logo-tema-oscuro relative h-auto w-[140px] max-w-full drop-shadow-md sm:w-[220px] lg:w-[330px] 2xl:w-[390px]"
          />
          <img
            src={splashNegro}
            alt={t("heroArteAlt")}
            width={640}
            height={640}
            fetchPriority="high"
            decoding="async"
            className="logo-tema-claro relative h-auto w-[140px] max-w-full drop-shadow-md sm:w-[220px] lg:w-[330px] 2xl:w-[390px]"
          />

          <span className={`${ETIQUETA} -left-8 top-2 -rotate-6 bg-primary text-primary-foreground sm:-left-12 sm:top-4`}>
            {t("heroFlac")}
          </span>
          <span
            className={`${ETIQUETA} -right-6 top-1/3 rotate-6 border border-border bg-card/95 text-foreground backdrop-blur-sm sm:-right-10`}
          >
            {t("heroSinAnuncios")}
          </span>
          <span
            className={`${ETIQUETA} -left-5 bottom-0 rotate-3 bg-foreground text-background sm:-left-8 sm:bottom-6`}
          >
            {t("heroGratis")}
          </span>
        </div>
      </div>
    </div>
  );
}
