import { TrendingUp, Monitor, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Props = { total: number; windows: number; android: number };

function fmt(n: number) {
  return new Intl.NumberFormat("es-ES").format(n);
}

export default function StatsBar({ total, windows, android }: Props) {
  const t = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 sm:gap-4">
      <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <TrendingUp className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
        <span className="font-semibold tabular-nums">{fmt(total)}</span>
        <span className="hidden text-muted-foreground sm:inline">{t("heroDownloadsTotal")}</span>
        <span className="text-muted-foreground sm:hidden">{t("heroDownloads")}</span>
      </div>
      <div className="flex gap-2 text-[10px] text-muted-foreground sm:text-xs">
        <span className="rounded-full border border-border bg-card/40 px-2 py-1 backdrop-blur sm:px-3">
          <Monitor className="mr-1 inline h-2.5 w-2.5 sm:h-3 sm:w-3" /> {fmt(windows)}
        </span>
        <span className="rounded-full border border-border bg-card/40 px-2 py-1 backdrop-blur sm:px-3">
          <Smartphone className="mr-1 inline h-2.5 w-2.5 sm:h-3 sm:w-3" /> {fmt(android)}
        </span>
      </div>
    </div>
  );
}
