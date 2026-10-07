import { useState, useEffect } from "react";
import { Download, Smartphone, Monitor, Tv, Cpu, Info, Apple, CircleHelp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";

type ReleaseAsset = { name: string; browser_download_url: string; size: number };

type Platform = "windows" | "android" | "tv" | "ios" | "macos";

type Props = {
  open: boolean;
  onClose: () => void;
  platform: Platform;
  assets: ReleaseAsset[];
  version: string;
  latestVersion: string;
  /** Lleva a la guía con capturas de la sección de instalación. */
  onOpenGuide?: () => void;
};

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function detectArch(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  const uaData = (navigator as any).userAgentData;
  if (uaData?.platform === "Android" || /Android/i.test(ua)) {
    if (/aarch64|arm64/i.test(ua)) return "arm64";
    if (/armv7|arm/i.test(ua)) return "arm";
    return "arm64";
  }
  if (uaData?.platform === "Windows" || /Win/i.test(ua)) {
    if (/arm64|aarch64/i.test(ua)) return "arm64-windows";
    return "x64-windows";
  }
  if (/x86_64|Win64|x64/i.test(ua)) return "x86_64";
  return null;
}

function WinAssets({ assets, t }: { assets: ReleaseAsset[]; t: (k: string) => string }) {
  const exeAssets = assets.filter((a) => a.name.endsWith(".exe"));
  if (exeAssets.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground sm:text-xs">{t("releaseSelectArch")}</p>
      {exeAssets.map((asset) => {
        const isArm = asset.name.toLowerCase().includes("arm64") || asset.name.toLowerCase().includes("aarch64");
        return (
          <a
            key={asset.name}
            href={asset.browser_download_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-2.5 transition hover:border-primary/40 hover:bg-primary/5 sm:p-3"
          >
            <div>
              <div className="text-xs font-semibold sm:text-sm">{isArm ? "Windows ARM64" : "Windows x64"}</div>
              <div className="text-xs text-muted-foreground sm:text-xs">{asset.name} · {formatSize(asset.size)}</div>
            </div>
            <Download className="h-4 w-4 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
}

function AndroidAssets({ assets, t }: { assets: ReleaseAsset[]; t: (k: string) => string }) {
  const apkAssets = assets.filter((a) => a.name.endsWith(".apk"));
  if (apkAssets.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground sm:text-xs">{t("releaseSelectArch")}</p>
      {apkAssets.map((asset) => {
        const isArm64 = asset.name.includes("arm64");
        const isArm32 = asset.name.includes("armeabi-v7a") || asset.name.includes("arm-v7a");
        const label = isArm64 ? "ARM64 — Celulares modernos (2016+)" : isArm32 ? "ARM32 — Celulares antiguos" : "x86_64 — Emuladores / Chromebooks";
        const arch = detectArch();
        const recommended = (isArm64 && arch === "arm64") || (isArm32 && arch === "arm") || (!isArm64 && !isArm32 && arch === "x86_64");
        return (
          <a
            key={asset.name}
            href={asset.browser_download_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-between rounded-xl border p-2.5 transition sm:p-3 ${
              recommended ? "border-primary/60 bg-primary/5 shadow-sm shadow-primary/10" : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-primary/5"
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold sm:text-sm">{label}</span>
                {recommended && <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-background">{t("releaseRecommended")}</span>}
              </div>
              <div className="text-xs text-muted-foreground sm:text-xs">{asset.name} · {formatSize(asset.size)}</div>
            </div>
            <Download className="h-4 w-4 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
}

export default function ReleaseModal({ open, onClose, platform, assets, version, latestVersion, onOpenGuide }: Props) {
  const t = useI18n();
  const [detected, setDetected] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (open) {
      setDetected(detectArch());
      setShowInfo(false);
    }
  }, [open]);

  const isTv = platform === "tv";
  const isAndroid = platform === "android";
  const isIos = platform === "ios";
  const isMacos = platform === "macos";
  const isWindows = platform === "windows";

  const filteredAssets = assets.filter((a) => {
    if (isTv || isAndroid) return a.name.endsWith(".apk");
    if (isIos) return a.name.endsWith(".ipa");
    if (isMacos) return a.name.endsWith(".dmg");
    return a.name.endsWith(".exe");
  });

  const Icon = isTv ? Tv : isAndroid ? Smartphone : isIos || isMacos ? Apple : Monitor;

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={isTv ? t("releaseTitleTV") : isIos ? t("releaseTitleIOS") : isMacos ? t("releaseTitleMacOS") : t("releaseTitle")}
      subtitle={version ? `${isTv ? t("releaseSubtitleTV") : isIos ? t("releaseSubtitleIOS") : isMacos ? t("releaseSubtitleMacOS") : t("releaseSubtitle")} — v${version}` : isTv ? t("releaseSubtitleTV") : isIos ? t("releaseSubtitleIOS") : isMacos ? t("releaseSubtitleMacOS") : t("releaseSubtitle")}
      icon={<Icon className="h-6 w-6 text-primary" />}
    >
      <div className="space-y-4">
        {/* 1. Los archivos, primero: quien ya sabe instalar no necesita nada más. */}
        <div className="space-y-2">
          {isWindows && <WinAssets assets={filteredAssets} t={t} />}
          {isAndroid && <AndroidAssets assets={filteredAssets} t={t} />}
          {(isTv || isIos || isMacos) && filteredAssets.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground sm:text-xs">{t("releaseDownloadFile")}</p>
              {filteredAssets.map((asset) => (
                <a
                  key={asset.name}
                  href={asset.browser_download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-2.5 transition hover:border-primary/40 hover:bg-primary/5 sm:p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold sm:text-sm">{asset.name}</div>
                    <div className="text-xs text-muted-foreground sm:text-xs">{formatSize(asset.size)}</div>
                  </div>
                  <Download className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          )}
          {filteredAssets.length === 0 && (
            <div className="rounded-xl border border-border bg-card/30 p-4 text-center text-xs text-muted-foreground sm:text-sm">
              {t("releaseNoAssets")}
            </div>
          )}
          {version && latestVersion && version !== latestVersion && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-muted-foreground sm:text-xs">
              {t("releasePlatformBehind").replace("{version}", version).replace("{latest}", latestVersion)}
            </p>
          )}
        </div>

        {/* 2. El botón que cierra el modal y baja a la guía con capturas. */}
        {onOpenGuide && (
          <button
            onClick={onOpenGuide}
            className="flex w-full items-center gap-3 rounded-2xl border border-primary/35 bg-primary/[0.08] px-4 py-3 text-left transition hover:bg-primary/15"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CircleHelp className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-primary sm:text-sm">{t("releaseNotSure")}</span>
              <span className="block text-xs text-muted-foreground sm:text-xs">{t("releaseNotSureDesc")}</span>
            </span>
          </button>
        )}

        {/* 3. Datos de arquitectura, para quien quiera verificar su equipo. */}
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card/30 px-3 py-2.5 text-left text-xs transition hover:bg-card/60 sm:text-sm"
        >
          <Cpu className="h-4 w-4 flex-shrink-0 text-primary" />
          <div className="flex-1">
            <span className="font-medium text-primary">{t("releaseIdentify")}</span>
            {detected && (
              <span className="ml-2 text-muted-foreground">
                {t("releaseDetected")} <strong className="text-foreground">
                  {detected === "arm64" ? "ARM64" : detected === "arm" ? "ARM32" : detected === "x64-windows" ? "Windows x64" : detected === "arm64-windows" ? "Windows ARM64" : "x86_64"}
                </strong>
              </span>
            )}
          </div>
          <Info className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        </button>

        {showInfo && (
          <div className="rounded-xl border border-border bg-card/30 p-3 text-xs leading-relaxed text-muted-foreground sm:text-xs space-y-1.5">
            {isAndroid || isTv ? (
              <>
                <p><strong className="text-foreground">ARM64:</strong> {t("releaseArchArm64")}</p>
                <p><strong className="text-foreground">ARM32:</strong> {t("releaseArchArm")}</p>
                <p><strong className="text-foreground">x86_64:</strong> {t("releaseArchX86")}</p>
              </>
            ) : isIos ? (
              <p><strong className="text-foreground">iOS:</strong> {t("releaseIOSInfo")}</p>
            ) : isMacos ? (
              <p><strong className="text-foreground">macOS:</strong> {t("releaseMacOSInfo")}</p>
            ) : (
              <>
                <p><strong className="text-foreground">x64:</strong> {t("releaseWinX64")}</p>
                <p><strong className="text-foreground">ARM64:</strong> {t("releaseWinArm64")}</p>
              </>
            )}
            <p className="pt-1 text-muted-foreground">{t("releaseArchHint")}</p>
          </div>
        )}
      </div>
    </ModalWrapper>
  );
}
