import { Monitor, Smartphone, Apple, Lock } from "lucide-react";

type Props = {
  isBlocked: boolean;
  windowsUrl: string | null;
  androidUrl: string | null;
  onDownload: (platform: "windows" | "android", url: string | null) => void;
};

export default function DownloadButtons({ isBlocked, windowsUrl, androidUrl, onDownload }: Props) {
  if (isBlocked) {
    return (
      <>
        <div className="relative flex flex-1 items-center gap-3 rounded-2xl border border-border/40 bg-card/40 px-5 py-3 opacity-50 sm:rounded-3xl sm:px-6 sm:py-3.5 pointer-events-none select-none">
          <Lock className="absolute left-3 top-2 h-3 w-3 text-muted-foreground sm:left-4 sm:top-2.5 sm:h-3.5 sm:w-3.5" />
          <Monitor className="h-6 w-6 text-muted-foreground sm:h-7 sm:w-7" />
          <div className="text-left">
            <div className="text-[9px] uppercase opacity-70 sm:text-[10px]">Descargar para</div>
            <div className="text-sm font-semibold leading-tight text-muted-foreground sm:text-base">Windows</div>
          </div>
        </div>
        <div className="relative flex flex-1 items-center gap-3 rounded-2xl border border-border/40 bg-card/40 px-5 py-3 opacity-50 sm:rounded-3xl sm:px-6 sm:py-3.5 pointer-events-none select-none">
          <Lock className="absolute left-3 top-2 h-3 w-3 text-muted-foreground sm:left-4 sm:top-2.5 sm:h-3.5 sm:w-3.5" />
          <Smartphone className="h-6 w-6 text-muted-foreground sm:h-7 sm:w-7" />
          <div className="text-left">
            <div className="text-[9px] uppercase opacity-70 sm:text-[10px]">Descargar para</div>
            <div className="text-sm font-semibold leading-tight text-muted-foreground sm:text-base">Android</div>
          </div>
        </div>
        <div className="relative flex flex-1 items-center gap-3 rounded-2xl border border-border/40 bg-card/40 px-5 py-3 opacity-50 sm:rounded-3xl sm:px-6 sm:py-3.5 pointer-events-none select-none">
          <Lock className="absolute left-3 top-2 h-3 w-3 text-muted-foreground sm:left-4 sm:top-2.5 sm:h-3.5 sm:w-3.5" />
          <Apple className="h-6 w-6 text-muted-foreground sm:h-7 sm:w-7" />
          <div className="text-left">
            <div className="text-[9px] uppercase opacity-70 sm:text-[10px]">Descargar para</div>
            <div className="text-sm font-semibold leading-tight text-muted-foreground sm:text-base">iOS</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => onDownload("windows", windowsUrl)}
        className="group flex flex-1 items-center gap-3 rounded-2xl border border-border/40 bg-card/40 px-5 py-3 transition-all hover:border-primary/40 hover:bg-primary/5 sm:rounded-3xl sm:px-6 sm:py-3.5"
      >
        <Monitor className="h-6 w-6 text-muted-foreground group-hover:text-primary sm:h-7 sm:w-7" />
        <div className="text-left">
          <div className="text-[9px] uppercase opacity-70 group-hover:text-primary sm:text-[10px]">Descargar para</div>
          <div className="text-sm font-semibold leading-tight text-muted-foreground group-hover:text-foreground sm:text-base">Windows</div>
        </div>
      </button>
      <button
        onClick={() => onDownload("android", androidUrl)}
        className="group flex flex-1 items-center gap-3 rounded-2xl bg-foreground px-5 py-3 text-background transition hover:scale-[1.02] sm:rounded-3xl sm:px-6 sm:py-3.5 shadow-lg shadow-foreground/20"
      >
        <Smartphone className="h-6 w-6 sm:h-7 sm:w-7" />
        <div className="text-left">
          <div className="text-[9px] uppercase opacity-70 sm:text-[10px]">Descargar APK</div>
          <div className="text-sm font-semibold leading-tight sm:text-base">Android</div>
        </div>
      </button>
      <div className="group flex flex-1 items-center gap-3 rounded-2xl border border-border/40 bg-card/40 px-5 py-3 sm:rounded-3xl sm:px-6 sm:py-3.5 cursor-not-allowed opacity-60">
        <Apple className="h-6 w-6 text-muted-foreground sm:h-7 sm:w-7" />
        <div className="text-left">
          <div className="text-[9px] uppercase opacity-70 sm:text-[10px]">Próximamente</div>
          <div className="text-sm font-semibold leading-tight text-muted-foreground sm:text-base">iOS</div>
        </div>
      </div>
    </>
  );
}
