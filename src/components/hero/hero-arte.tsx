import splashBlanco192 from "@/assets/splash-blanco-192.webp";
import splashBlanco320 from "@/assets/splash-blanco-320.webp";
import splashBlanco480 from "@/assets/splash-blanco-480.webp";
import splashBlanco640 from "@/assets/splash-blanco-640.webp";
import splashNegro192 from "@/assets/splash-negro-192.webp";
import splashNegro320 from "@/assets/splash-negro-320.webp";
import splashNegro480 from "@/assets/splash-negro-480.webp";
import splashNegro640 from "@/assets/splash-negro-640.webp";
import { useI18n } from "@/lib/i18n";

const ETIQUETA = "texto-marker absolute rounded-full px-3 py-1.5 text-[11px] shadow-lg sm:text-xs";
const TAMANOS = "(min-width: 1536px) 390px, (min-width: 1024px) 330px, (min-width: 640px) 220px, 140px";
const SRCSET = (a: string, b: string, c: string, d: string) => `${a} 192w, ${b} 320w, ${c} 480w, ${d} 640w`;
const CLASE_LOGO = "relative h-auto w-[140px] max-w-full drop-shadow-md sm:w-[220px] lg:w-[330px] 2xl:w-[390px]";

export default function HeroArte() {
  const t = useI18n();

  return (
    <div
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
            src={splashBlanco640}
            srcSet={SRCSET(splashBlanco192, splashBlanco320, splashBlanco480, splashBlanco640)}
            sizes={TAMANOS}
            alt={t("heroArteAlt")}
            width={640}
            height={640}
            fetchPriority="high"
            decoding="async"
            className={`logo-tema-oscuro ${CLASE_LOGO}`}
          />
          <img
            src={splashNegro640}
            srcSet={SRCSET(splashNegro192, splashNegro320, splashNegro480, splashNegro640)}
            sizes={TAMANOS}
            alt={t("heroArteAlt")}
            width={640}
            height={640}
            fetchPriority="low"
            decoding="async"
            className={`logo-tema-claro ${CLASE_LOGO}`}
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
