import { Sparkles, Smartphone, HelpCircle } from "lucide-react";
import logo640 from "@/assets/bitly-logo-640.webp";
import logo320 from "@/assets/bitly-logo-320.webp";
import { useI18n } from "@/lib/i18n";
import { retraso } from "@/lib/reveal";
import DownloadButtons from "./download-buttons";
import StatsBar from "./stats-bar";

type Props = {
  tagline: string; description: string; version: string | null;
  isBlocked: boolean; windowsUrl: string | null; androidUrl: string | null; iosUrl: string | null; macosUrl: string | null;
  totalDownloads: number; windowsDownloads: number; androidDownloads: number;
  onDownload: (p: "windows" | "android" | "tv" | "ios" | "macos", u: string | null) => void;
  onOpenMobile: () => void;
};

const btnClass = "flex items-center gap-1.5 rounded-full border border-border/60 bg-card/30 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur transition-all duration-200 hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-95 sm:px-4 sm:py-2 sm:text-xs";

export default function HeroSection(props: Props) {
  const t = useI18n();

  return (
    <section className="container mx-auto grid items-center gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12 md:py-16 lg:grid-cols-2 lg:py-20">
      <div className="space-y-5 sm:space-y-6">
        <div
          data-reveal suppressHydrationWarning
          style={retraso(0)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs"
        >
          <Sparkles className="anim-late h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {props.version ? `${t("heroBadge")} — ${props.version}` : t("heroBadge")}
        </div>

        <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-8xl">
          {/* El título lleva encima una franja luminosa que se pasea: es una
              capa aparte, así que el texto no se repinta nunca. */}
          <span className="relative inline-block" data-reveal suppressHydrationWarning style={retraso(80)}>
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
              {props.tagline}
            </span>
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <span className="anim-brillo absolute inset-y-0 left-0 w-1/3" />
            </span>
          </span>
        </h1>

        <p data-reveal suppressHydrationWarning style={retraso(160)} className="max-w-lg text-sm text-muted-foreground sm:text-base lg:text-lg">
          {props.description || t("heroDescription")}
        </p>

        {/* Los 5 botones se reparten en filas: sin `flex-wrap` + un mínimo por botón,
            la fila se desborda en pantallas de 640 a 1100 px. */}
        <div
          id="descargar"
          data-reveal suppressHydrationWarning
          style={retraso(240)}
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>*]:min-w-[9rem]"
        >
          <DownloadButtons
            isBlocked={props.isBlocked}
            windowsUrl={props.windowsUrl}
            androidUrl={props.androidUrl}
            iosUrl={props.iosUrl}
            macosUrl={props.macosUrl}
            onDownload={props.onDownload}
          />
        </div>

        <div data-reveal suppressHydrationWarning style={retraso(320)} className="flex flex-wrap items-center gap-2 pt-1 sm:gap-2.5">
          <button onClick={props.onOpenMobile} className={btnClass}>
            <Smartphone className="h-3 w-3" /> {t("mobileSubtitle")}
          </button>
          <a href="#faq" className={btnClass}>
            <HelpCircle className="h-3 w-3" /> {t("faqTitle")}
          </a>
        </div>

        <StatsBar total={props.totalDownloads} windows={props.windowsDownloads} android={props.androidDownloads} />
      </div>

      <div className="relative flex justify-center order-first sm:order-last" data-reveal suppressHydrationWarning style={retraso(120)}>
        {/* El halo va pegado al logo, no a toda la columna: se ve mejor y la
            capa que se anima es mucho más chica. */}
        <div className="relative">
          <div
            aria-hidden
            className="anim-halo pointer-events-none absolute -inset-8 rounded-full opacity-30 blur-2xl sm:blur-3xl"
            style={{ background: "var(--gradient-mint)" }}
          />
          <img
            src={logo640}
            srcSet={`${logo320} 320w, ${logo640} 640w`}
            sizes="(min-width: 1024px) 300px, (min-width: 640px) 260px, 200px"
            alt="Bitly — Tu música, sin límites"
            width={640}
            height={640}
            fetchPriority="high"
            decoding="async"
            className="anim-flota relative w-[200px] max-w-full drop-shadow-2xl sm:w-[260px] lg:w-[300px] logo-hero"
          />
        </div>
      </div>
    </section>
  );
}
