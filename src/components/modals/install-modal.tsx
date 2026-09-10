import { useState, useEffect, useCallback, useRef } from "react";
import { Download, CheckCircle2, ChevronLeft, ChevronRight, Smartphone, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";
import step1Img from "@/assets/install-step1.svg";
import step2Img from "@/assets/install-step2.svg";
import step3Img from "@/assets/install-step3.svg";
import step4Img from "@/assets/install-step4.svg";

type Props = { open: boolean; onClose: () => void; url: string | null };

const slideImages = [step1Img, step2Img, step3Img, step4Img];

export default function InstallModal({ open, onClose, url }: Props) {
  const t = useI18n();
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % slideImages.length);
  }, []);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + slideImages.length) % slideImages.length);
  }, []);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setDownloading(false);
      setCompleted(false);
      setError(null);
      setCurrentSlide(0);
      setDownloadedBytes(0);
      setTotalBytes(0);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!downloading || completed) return;
    const timer = setInterval(nextSlide, 3500);
    return () => clearInterval(timer);
  }, [downloading, completed, nextSlide]);

  const handleStartDownload = async () => {
    if (!url) return;

    setDownloading(true);
    setCompleted(false);
    setError(null);
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      setTotalBytes(total);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No readable stream");
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if (total > 0) {
          setProgress((received / total) * 100);
        } else {
          setProgress((prev) => Math.min(prev + 5, 90));
        }
        setDownloadedBytes(received);
      }

      const blob = new Blob(chunks as unknown as BlobPart[]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "Bitly-arm64.apk";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setProgress(100);
      setCompleted(true);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[Bitly] Download failed:", err);
      setError(err.message || "Error al descargar");
      setDownloading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("installTitle")}
      subtitle={t("installSubtitle")}
      icon={<Smartphone className="h-6 w-6 text-primary" />}
    >
      <div className="space-y-4">
        {/* Progress bar area */}
        {downloading && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card/30 p-4 backdrop-blur sm:p-5">
              <div className="mb-3 flex items-center justify-between sm:mb-4">
                <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                  {completed ? t("installComplete") : t("installDownloading")}
                </span>
                <span className="text-xs font-bold text-primary sm:text-sm">
                  {Math.min(Math.round(progress), 100)}%
                </span>
              </div>

              <div className="relative h-2.5 overflow-hidden rounded-full bg-muted sm:h-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${Math.min(progress, 100)}%`,
                    background: completed
                      ? "linear-gradient(90deg, oklch(0.82 0.18 165), oklch(0.88 0.20 155))"
                      : "var(--gradient-mint)",
                  }}
                />
                {downloading && !completed && (
                  <div className="absolute inset-0 animate-pulse rounded-full" style={{ background: "linear-gradient(90deg, transparent, oklch(0.82 0.18 165 / 0.3), transparent)" }} />
                )}
              </div>

              {totalBytes > 0 && (
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground sm:text-xs">
                  <span>{formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}</span>
                  <span>{formatBytes(downloadedBytes)}/s</span>
                </div>
              )}

              {completed && (
                <div className="mt-3 flex items-center gap-2 text-primary sm:mt-4">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-xs font-medium sm:text-sm">{t("installSuccessMsg")}</span>
                </div>
              )}

              {error && (
                <div className="mt-3 flex items-center gap-2 text-destructive sm:mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-xs font-medium sm:text-sm">{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Carousel */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide sm:text-sm">
              {t("installHowTo")}
            </h4>
            <div className="flex items-center gap-1.5">
              <button
                onClick={prevSlide}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-card/60 text-muted-foreground transition hover:bg-card hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[2.5rem] text-center text-[10px] text-muted-foreground">
                {currentSlide + 1}/{slideImages.length}
              </span>
              <button
                onClick={nextSlide}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-card/60 text-muted-foreground transition hover:bg-card hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-border bg-card/20 backdrop-blur">
            <div
              className="flex transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${currentSlide * 100}%)` }}
            >
              {slideImages.map((img, i) => (
                <div key={i} className="w-full flex-shrink-0">
                  <img
                    src={img}
                    alt={`Paso ${i + 1}`}
                    className="mx-auto w-full max-w-[280px] rounded-lg sm:max-w-[320px]"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-1.5 pb-3 pt-2">
              {slideImages.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentSlide ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Action button */}
        {!downloading ? (
          <button
            onClick={handleStartDownload}
            disabled={!url}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-5 py-3.5 text-background transition hover:scale-[1.01] sm:rounded-3xl sm:py-4 shadow-lg shadow-foreground/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-5 w-5 transition-transform group-hover:-translate-y-0.5" />
            <span className="text-sm font-semibold sm:text-base">{t("installStartDownload")}</span>
          </button>
        ) : completed ? (
          <button
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-5 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/5 sm:rounded-3xl"
          >
            {t("installClose")}
          </button>
        ) : null}
      </div>
    </ModalWrapper>
  );
}
