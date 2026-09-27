import { useState, useEffect } from "react";
import { Download, Smartphone, Monitor, Tv, Cpu, CheckCircle2, Info, Apple, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";

type ReleaseAsset = { name: string; browser_download_url: string; size: number };

type Props = {
  open: boolean;
  onClose: () => void;
  platform: "windows" | "android" | "tv" | "ios" | "macos";
  assets: ReleaseAsset[];
  version: string;
  latestVersion: string;
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 px-2 py-1 text-[10px] font-mono text-foreground transition hover:border-primary/40 hover:bg-primary/5 sm:text-xs">
      {text}
      <Copy className="h-3 w-3 text-muted-foreground" />
      {copied && <span className="text-primary">Copiado</span>}
    </button>
  );
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary sm:h-7 sm:w-7 sm:text-xs">
        {num}
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold sm:text-sm">{title}</p>
        <div className="text-[10px] leading-relaxed text-muted-foreground sm:text-xs">{children}</div>
      </div>
    </div>
  );
}

function TVGuide({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
        <p><strong className="text-amber-400">{t("releaseTVGuideNote")}:</strong> {t("releaseTVGuideNoteDesc")}</p>
      </div>

      <div className="space-y-3">
        <Step num={1} title={t("releaseTVStep1Title")}>
          <p>{t("releaseTVStep1Desc")}</p>
        </Step>
        <Step num={2} title={t("releaseTVStep2Title")}>
          <p>{t("releaseTVStep2Desc")}</p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-foreground sm:text-xs">TVs modernos (Samsung, LG, Sony, TCL, etc.):</span>
              <CopyButton text="8134206" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-foreground sm:text-xs">TVs antiguos o gama baja:</span>
              <CopyButton text="3035631" />
            </div>
          </div>
        </Step>
        <Step num={3} title={t("releaseTVStep3Title")}>
          <p>{t("releaseTVStep3Desc")}</p>
        </Step>
        <Step num={4} title={t("releaseTVStep4Title")}>
          <p>{t("releaseTVStep4Desc")}</p>
        </Step>
      </div>
    </div>
  );
}

function AndroidGuide({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Step num={1} title={t("releaseAndroidStep1Title")}>
          <p>{t("releaseAndroidStep1Desc")}</p>
        </Step>
        <Step num={2} title={t("releaseAndroidStep2Title")}>
          <p>{t("releaseAndroidStep2Desc")}</p>
        </Step>
        <Step num={3} title={t("releaseAndroidStep3Title")}>
          <p>{t("releaseAndroidStep3Desc")}</p>
        </Step>
        <Step num={4} title={t("releaseAndroidStep4Title")}>
          <p>{t("releaseAndroidStep4Desc")}</p>
        </Step>
      </div>
    </div>
  );
}

function WindowsGuide({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Step num={1} title={t("releaseWinStep1Title")}>
          <p>{t("releaseWinStep1Desc")}</p>
        </Step>
        <Step num={2} title={t("releaseWinStep2Title")}>
          <p>{t("releaseWinStep2Desc")}</p>
        </Step>
        <Step num={3} title={t("releaseWinStep3Title")}>
          <p>{t("releaseWinStep3Desc")}</p>
        </Step>
      </div>
    </div>
  );
}

function MacosGuide({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Step num={1} title={t("releaseMacStep1Title")}>
          <p>{t("releaseMacStep1Desc")}</p>
        </Step>
        <Step num={2} title={t("releaseMacStep2Title")}>
          <p>{t("releaseMacStep2Desc")}</p>
        </Step>
        <Step num={3} title={t("releaseMacStep3Title")}>
          <p>{t("releaseMacStep3Desc")}</p>
        </Step>
        <Step num={4} title={t("releaseMacStep4Title")}>
          <p>{t("releaseMacStep4Desc")}</p>
        </Step>
      </div>
    </div>
  );
}

function IosGuide({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
        <p><strong className="text-blue-400">{t("releaseIOSGuideNote")}:</strong> {t("releaseIOSGuideNoteDesc")}</p>
      </div>
      <div className="space-y-3">
        <Step num={1} title={t("releaseIOSStep1Title")}>
          <p>{t("releaseIOSStep1Desc")}</p>
          <a href="https://github.com/opa334/TrollStore" target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline sm:text-xs">
            TrollStore en GitHub <ExternalLink className="h-3 w-3" />
          </a>
        </Step>
        <Step num={2} title={t("releaseIOSStep2Title")}>
          <p>{t("releaseIOSStep2Desc")}</p>
        </Step>
        <Step num={3} title={t("releaseIOSStep3Title")}>
          <p>{t("releaseIOSStep3Desc")}</p>
        </Step>
      </div>
    </div>
  );
}

function WinAssets({ assets, t }: { assets: ReleaseAsset[]; t: (k: string) => string }) {
  const exeAssets = assets.filter((a) => a.name.endsWith(".exe"));
  if (exeAssets.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground sm:text-xs">{t("releaseSelectArch")}</p>
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
              <div className="text-[10px] text-muted-foreground sm:text-xs">{asset.name} · {formatSize(asset.size)}</div>
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
      <p className="text-[10px] font-medium text-muted-foreground sm:text-xs">{t("releaseSelectArch")}</p>
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
                {recommended && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-bold text-background">Recomendado</span>}
              </div>
              <div className="text-[10px] text-muted-foreground sm:text-xs">{asset.name} · {formatSize(asset.size)}</div>
            </div>
            <Download className="h-4 w-4 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
}

export default function ReleaseModal({ open, onClose, platform, assets, version, latestVersion }: Props) {
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
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="flex w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-left text-xs transition hover:bg-primary/10 sm:text-sm"
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
          <div className="rounded-xl border border-border bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground sm:text-xs space-y-1.5">
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
            <p className="pt-1 text-muted-foreground/70">{t("releaseArchHint")}</p>
          </div>
        )}

        {isTv && <TVGuide t={t} />}
        {isAndroid && <AndroidGuide t={t} />}
        {isWindows && <WindowsGuide t={t} />}
        {isMacos && <MacosGuide t={t} />}
        {isIos && <IosGuide t={t} />}

        <div className="border-t border-border/40 pt-3">
          {version && latestVersion && version !== latestVersion && (
            <p className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
              {t("releasePlatformBehind").replace("{version}", version).replace("{latest}", latestVersion)}
            </p>
          )}
          {isWindows && <WinAssets assets={filteredAssets} t={t} />}
          {isAndroid && <AndroidAssets assets={filteredAssets} t={t} />}
          {(isTv || isIos || isMacos) && filteredAssets.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground sm:text-xs">{t("releaseDownloadFile")}</p>
              {filteredAssets.map((asset) => (
                <a
                  key={asset.name}
                  href={asset.browser_download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-2.5 transition hover:border-primary/40 hover:bg-primary/5 sm:p-3"
                >
                  <div>
                    <div className="text-xs font-semibold sm:text-sm">{asset.name}</div>
                    <div className="text-[10px] text-muted-foreground sm:text-xs">{formatSize(asset.size)}</div>
                  </div>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}
            </div>
          )}
          {filteredAssets.length === 0 && (
            <div className="rounded-xl border border-border bg-card/30 p-4 text-center text-xs text-muted-foreground sm:text-sm">
              {t("releaseNoAssets")}
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}
