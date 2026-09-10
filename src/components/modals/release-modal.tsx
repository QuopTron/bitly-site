import { useState, useEffect } from "react";
import { Download, Smartphone, Monitor, Cpu, CheckCircle2, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";

type ReleaseAsset = { name: string; browser_download_url: string; size: number };

type Props = {
  open: boolean;
  onClose: () => void;
  platform: "windows" | "android";
  assets: ReleaseAsset[];
  version: string;
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
  if (/x86_64|Win64|x64/i.test(ua)) return "x86_64";
  return null;
}

function getApkLabel(name: string): { label: string; desc: string; recommended: boolean } {
  const arch = detectArch();
  if (name.includes("arm64")) {
    return {
      label: "ARM64 (arm64-v8a)",
      desc: "La mayoría de celulares modernos (2016+)",
      recommended: arch === "arm64",
    };
  }
  if (name.includes("armeabi-v7a") || name.includes("arm-v7a")) {
    return {
      label: "ARM32 (armeabi-v7a)",
      desc: "Celulares antiguos o de gama baja",
      recommended: arch === "arm",
    };
  }
  if (name.includes("x86_64")) {
    return {
      label: "x86_64",
      desc: "Emuladores, Chromebooks, tablets Intel",
      recommended: arch === "x86_64",
    };
  }
  return { label: name, desc: "", recommended: false };
}

export default function ReleaseModal({ open, onClose, platform, assets, version }: Props) {
  const t = useI18n();
  const [detected, setDetected] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (open) {
      setDetected(detectArch());
      setShowInfo(false);
    }
  }, [open]);

  const isAndroid = platform === "android";
  const filteredAssets = assets.filter((a) =>
    isAndroid ? a.name.endsWith(".apk") : a.name.endsWith(".exe")
  );

  const Icon = isAndroid ? Smartphone : Monitor;

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("releaseTitle")}
      subtitle={version ? `${t("releaseSubtitle")} — v${version}` : t("releaseSubtitle")}
      icon={<Icon className="h-6 w-6 text-primary" />}
    >
      <div className="space-y-3">
        {isAndroid && (
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="flex w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-left text-xs transition hover:bg-primary/10 sm:text-sm"
          >
            <Cpu className="h-4 w-4 flex-shrink-0 text-primary" />
            <div className="flex-1">
              <span className="font-medium text-primary">{t("releaseIdentify")}</span>
              {detected && (
                <span className="ml-2 text-muted-foreground">
                  {t("releaseDetected")} <strong className="text-foreground">{detected === "arm64" ? "ARM64" : detected === "arm" ? "ARM32" : "x86_64"}</strong>
                </span>
              )}
            </div>
            <Info className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          </button>
        )}

        {isAndroid && showInfo && (
          <div className="rounded-xl border border-border bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground sm:text-xs space-y-1.5">
            <p><strong className="text-foreground">ARM64:</strong> {t("releaseArchArm64")}</p>
            <p><strong className="text-foreground">ARM32:</strong> {t("releaseArchArm")}</p>
            <p><strong className="text-foreground">x86_64:</strong> {t("releaseArchX86")}</p>
            <p className="pt-1 text-muted-foreground/70">{t("releaseArchHint")}</p>
          </div>
        )}

        {filteredAssets.length === 0 && (
          <div className="rounded-xl border border-border bg-card/30 p-4 text-center text-xs text-muted-foreground sm:text-sm">
            {t("releaseNoAssets")}
          </div>
        )}

        {filteredAssets.map((asset) => {
          const info = isAndroid ? getApkLabel(asset.name) : null;
          const isRecommended = info?.recommended;
          return (
            <div
              key={asset.name}
              className={`relative rounded-xl border bg-gradient-to-b from-card/40 to-card/20 p-3 backdrop-blur transition-all sm:p-4 ${
                isRecommended ? "border-primary/60 shadow-lg shadow-primary/10" : "border-border"
              }`}
            >
              {isRecommended && (
                <div className="absolute -top-2.5 left-3 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-background sm:text-[10px]">
                  {t("releaseRecommended")}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border sm:h-11 sm:w-11 ${isRecommended ? "border-primary/40" : "border-border"}`} style={{ background: "var(--gradient-mint)", opacity: isRecommended ? 1 : 0.7 }}>
                  {isAndroid ? <Smartphone className="h-5 w-5 text-background" /> : <Monitor className="h-5 w-5 text-background" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold sm:text-sm">{info?.label || asset.name}</div>
                  {info?.desc && <div className="text-[10px] text-muted-foreground sm:text-xs">{info.desc}</div>}
                  <div className="mt-0.5 text-[10px] text-muted-foreground/70">{asset.name} · {formatSize(asset.size)}</div>
                </div>
                <a
                  href={asset.browser_download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold transition sm:px-4 sm:py-2 sm:text-xs ${
                    isRecommended
                      ? "bg-foreground text-background shadow-lg shadow-foreground/20 hover:scale-[1.03]"
                      : "border border-border/60 bg-card/40 text-foreground hover:border-primary/40 hover:bg-primary/5"
                  }`}
                >
                  <Download className="h-3 w-3" />
                  {t("releaseDownload")}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </ModalWrapper>
  );
}
