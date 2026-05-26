import { Sparkles, Smartphone, HelpCircle } from "lucide-react";
import logo from "@/assets/bitly-logo.png";
import { useI18n } from "@/lib/i18n";
import DownloadButtons from "./download-buttons";
import StatsBar from "./stats-bar";

type Props = {
  tagline: string; description: string; version: string | null;
  isBlocked: boolean; windowsUrl: string | null; androidUrl: string | null;
  totalDownloads: number; windowsDownloads: number; androidDownloads: number;
  onDownload: (p: "windows" | "android", u: string | null) => void;
  onOpenMobile: () => void; onOpenFaq: () => void;
};

const btnClass = "flex items-center gap-1.5 rounded-full border border-border/60 bg-card/30 px-3 py-1.5 text-[10px] font-medium text-muted-foreground backdrop-blur transition-all hover:border-primary/40 hover:text-primary hover:bg-primary/5 sm:px-4 sm:py-2 sm:text-xs";

export default function HeroSection(props: Props) {
  const t = useI18n();

  return (
    <section className="container mx-auto grid items-center gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12 md:py-16 lg:grid-cols-2 lg:py-20">
      <div className="space-y-5 sm:space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs">
          <Sparkles className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {props.version ? `${t("heroBadge")} — v${props.version}` : t("heroBadge")}
        </div>
        <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-8xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {props.tagline}
          </span>
        </h1>
        <p className="max-w-lg text-sm text-muted-foreground sm:text-base lg:text-lg">
          {props.description || t("heroDescription")}
        </p>
        <div id="descargar" className="flex flex-col gap-3 sm:flex-row">
          <DownloadButtons
            isBlocked={props.isBlocked}
            windowsUrl={props.windowsUrl}
            androidUrl={props.androidUrl}
            onDownload={props.onDownload}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 sm:gap-2.5">
          <button onClick={props.onOpenMobile} className={btnClass}>
            <Smartphone className="h-3 w-3" /> {t("mobileSubtitle")}
          </button>
          <button onClick={props.onOpenFaq} className={btnClass}>
            <HelpCircle className="h-3 w-3" /> {t("faqTitle")}
          </button>
        </div>
        <StatsBar total={props.totalDownloads} windows={props.windowsDownloads} android={props.androidDownloads} />
      </div>
      <div className="relative flex justify-center order-first sm:order-last">
        <div className="absolute inset-0 rounded-full blur-3xl" style={{ background: "var(--gradient-mint)", opacity: 0.3 }} />
        <img src={logo} alt="Logo" className="relative w-full max-w-[200px] drop-shadow-2xl sm:max-w-[260px] lg:max-w-[300px] logo-hero" />
      </div>
    </section>
  );
}
