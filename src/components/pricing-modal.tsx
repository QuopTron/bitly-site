import { useState, useEffect, useCallback } from "react";
import { X, Clock, Gift, Send, AlertCircle, Sparkles } from "lucide-react";

// ── Cookie helpers ──────────────────────────────────────────
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days?: number) {
  if (typeof document === "undefined") return;
  const expires = days
    ? `; expires=${new Date(Date.now() + days * 864e5).toUTCString()}`
    : "";
  document.cookie = `${name}=${value}${expires}; path=/`;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; expires=${new Date(0).toUTCString()}; path=/`;
}

// ── Offer timer (America/La_Paz UTC‑4) ──────────────────────
const OFFER_START = new Date("2026-05-14T20:00:00-04:00");
const OFFER_END = new Date("2026-05-16T12:00:00-04:00");
const BASE_PRICE = 60;
const FREE_TRIAL_DAYS = 1;
const MAX_ATTEMPTS = 3;

const PRICE_BUCKETS = [
  { label: "Gratis", min: 0, max: 0, weight: 2 },
  { label: "1–25 Bs", min: 1, max: 25, weight: 20 },
  { label: "25–40 Bs", min: 25, max: 40, weight: 80 },
  { label: "40–60 Bs", min: 40, max: 60, weight: 200 },
];

function getWeightedRandomPrice(): number {
  const totalWeight = PRICE_BUCKETS.reduce((sum, bucket) => sum + bucket.weight, 0);
  let random = Math.random() * totalWeight;

  for (const bucket of PRICE_BUCKETS) {
    random -= bucket.weight;
    if (random <= 0) {
      if (bucket.min === bucket.max) {
        return bucket.min;
      }
      return Math.floor(Math.random() * (bucket.max - bucket.min + 1)) + bucket.min;
    }
  }

  const last = PRICE_BUCKETS[PRICE_BUCKETS.length - 1];
  return last.min === last.max
    ? last.min
    : Math.floor(Math.random() * (last.max - last.min + 1)) + last.min;
}

function getBucketLabel(price: number): string {
  const bucket = PRICE_BUCKETS.find((item) => price >= item.min && price <= item.max);
  return bucket ? bucket.label : `${price} Bs`;
}

type TimerState =
  | { type: "before"; seconds: number }
  | { type: "during"; seconds: number }
  | { type: "after" };

function computeTimer(): TimerState {
  const now = new Date();
  if (now < OFFER_START) {
    return {
      type: "before",
      seconds: Math.floor((OFFER_START.getTime() - now.getTime()) / 1000),
    };
  }
  if (now < OFFER_END) {
    return {
      type: "during",
      seconds: Math.floor((OFFER_END.getTime() - now.getTime()) / 1000),
    };
  }
  return { type: "after" };
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Component ───────────────────────────────────────────────
export default function PricingModal({ onClose }: { onClose: () => void }) {
  const [timer, setTimer] = useState<TimerState>(computeTimer);

  const [attempts, setAttempts] = useState<number>(() => {
    const c = getCookie("pricing_attempts");
    const n = c ? Number(c) : MAX_ATTEMPTS;
    return Number.isFinite(n) && n >= 0 ? n : MAX_ATTEMPTS;
  });

  const [offeredPrice, setOfferedPrice] = useState<number | null>(() => {
    const c = getCookie("pricing_offered");
    return c ? Number(c) : null;
  });

  const [locked, setLocked] = useState(() => getCookie("pricing_locked") === "true");
  const [showMessage, setShowMessage] = useState(false);

  /* persist attempts + auto-lock when it reaches 0 */
  useEffect(() => {
    setCookie("pricing_attempts", String(attempts), 30);
    if (attempts <= 0) {
      setCookie("pricing_locked", "true", 30);
      setLocked(true);
    } else {
      deleteCookie("pricing_locked");
      setLocked(false);
    }
  }, [attempts]);

  useEffect(() => {
    if (offeredPrice !== null) setCookie("pricing_offered", String(offeredPrice), 30);
  }, [offeredPrice]);

  /* tick every second while timer is active */
  useEffect(() => {
    if (timer.type === "after") return;
    const id = setInterval(() => setTimer(computeTimer()), 1_000);
    return () => clearInterval(id);
  }, [timer.type]);

  const isOfferActive = timer.type === "during";
  const remaining = Math.max(0, attempts);
  const canTry = isOfferActive && !locked && attempts > 0;

  const handleGetOffer = useCallback(() => {
    if (!canTry) return;
    const price = getWeightedRandomPrice();
    setOfferedPrice(price);
    setShowMessage(true);
    setAttempts((p) => Math.max(p - 1, 0));
  }, [canTry]);

  const handleResetAttempts = useCallback(() => {
    setAttempts(MAX_ATTEMPTS);
    deleteCookie("pricing_locked");
    setLocked(false);
    setShowMessage(false);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto py-4">
      <div className="relative w-full max-w-sm sm:max-w-lg rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="mb-4 sm:mb-6 text-center">
          <div className="mx-auto mb-2 sm:mb-3 flex h-12 sm:h-14 w-12 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-primary/20">
            <Gift className="h-6 sm:h-7 w-6 sm:w-7 text-primary" />
          </div>
          <h2 className="text-lg sm:text-2xl font-bold text-foreground">bitly Premium</h2>
          <div className="mt-2 text-center text-xs uppercase tracking-[0.2em] text-slate-500">
            <span className="font-semibold text-slate-900 dark:text-white">
              powered by <span className="text-white">Flo</span><span className="text-emerald-400">X</span>
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Oferta exclusiva para Cloudflare Pages: suerte limitada, cookies guardan tus intentos.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <a className="underline text-primary" href="https://github.com/btflox" target="_blank" rel="noreferrer">GitHub</a> · Contacto por WhatsApp
          </p>
        </div>

        {/* Timer banner */}
        {timer.type !== "after" && (
          <div className="mb-3 sm:mb-5 flex items-center justify-center gap-2 rounded-lg sm:rounded-xl border border-primary/30 bg-primary/10 px-2 sm:px-4 py-2 sm:py-3">
            <Clock className="h-3.5 sm:h-4 w-3.5 sm:w-4 text-primary flex-shrink-0" />
            {timer.type === "before" ? (
              <span className="text-xs sm:text-sm font-medium text-foreground">
                Inicia <span className="font-mono text-primary">{fmt(timer.seconds)}</span> (Cloudflare Pages)
              </span>
            ) : (
              <span className="text-xs sm:text-sm font-medium text-foreground">
                Termina <span className="font-mono text-primary">{fmt(timer.seconds)}</span> a las 12:00 de hoy
              </span>
            )}
          </div>
        )}

        {/* Premium features list */}
        <div className="mb-4 sm:mb-6 space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
          {[
            "Streaming y descarga en un solo lugar",
            "Soporta canciones de Spotify, Tidal, Qobuz y Deezer",
            "Descarga FLAC sin pérdida hasta 24-bit/192kHz",
            "Tu propia app estilo Spotify en celular o PC",
            "Descargas ilimitadas de por vida después de comprar",
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3 sm:h-3.5 w-3 sm:w-3.5 flex-shrink-0 text-primary" />
              <span className="text-muted-foreground text-xs sm:text-sm">{text}</span>
            </div>
          ))}
        </div>

        <div className="mb-3 sm:mb-5 rounded-2xl sm:rounded-3xl border border-border/70 bg-background/80 p-3 sm:p-4 text-xs sm:text-sm text-foreground">
          <p className="font-semibold">Versión gratuita</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Busca música, descárgala y quédate con lo descargado durante {FREE_TRIAL_DAYS} día.
          </p>
        </div>



        {/* Price display */}
        {offeredPrice !== null ? (
          <div className="mb-3 sm:mb-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Tu oferta (ruleta de 3 intentos)
            </p>
            <p className="mt-1 text-2xl sm:text-4xl font-bold text-primary">
              {offeredPrice === 0 ? "¡GRATIS!" : `${offeredPrice} Bs`}
            </p>
            <p className="text-xs text-muted-foreground line-through opacity-70">En lugar de {BASE_PRICE} Bs</p>
          </div>
        ) : (
          <div className="mb-3 sm:mb-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Precio normal</p>
            <p className="mt-1 text-2xl sm:text-4xl font-bold text-foreground">{BASE_PRICE} Bs</p>
            <p className="text-xs text-muted-foreground">De por vida</p>
            <p className="mt-2 text-xs text-primary font-medium">¡Gira la ruleta para obtener tu precio!</p>
          </div>
        )}

        {/* Action area */}
        {!showMessage ? (
          <button
            onClick={handleGetOffer}
            disabled={!canTry}
            className="w-full rounded-lg sm:rounded-xl bg-primary py-2 sm:py-3 text-xs sm:text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!isOfferActive
              ? timer.type === "before"
                ? "Espera a que inicie la oferta"
                : "Oferta finalizada"
              : locked || attempts <= 0
                ? "Sin intentos disponibles"
                : `Obtener oferta inteligente (${remaining} intento${remaining !== 1 ? "s" : ""})`}
          </button>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            <div className="rounded-lg sm:rounded-xl border border-primary/30 bg-primary/10 p-3 sm:p-4 text-center">
              <Send className="mx-auto mb-2 h-5 sm:h-6 w-5 sm:w-6 text-primary" />
              <div className="font-medium text-foreground">
                ¡Oferta generada!
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {offeredPrice} Bs de por vida
              </p>
            </div>

            <button
              onClick={() =>
                window.open(
                  "https://wa.me/59100000000?text=" +
                  encodeURIComponent(
                    `Hola! Quiero bitly Premium por ${offeredPrice} Bs 🎉`
                  ),
                  "_blank",
                  "noopener,noreferrer"
                )
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg sm:rounded-xl bg-primary py-2 sm:py-3 text-xs sm:text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Send className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
              Adquirir esta oferta
            </button>

            {remaining > 0 && (
              <button
                onClick={() => setShowMessage(false)}
                className="w-full rounded-lg sm:rounded-xl border border-border bg-background py-1.5 sm:py-2 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Intentar ({remaining})
              </button>
            )}
          </div>
        )}

        {/* Footer info */}
        {!showMessage && remaining > 0 && (
          <p className="mt-2 sm:mt-3 text-center text-xs text-muted-foreground">
            {remaining} intento{remaining !== 1 ? "s" : ""}
          </p>
        )}
        {locked && (
          <div className="mt-2 sm:mt-3 space-y-2 sm:space-y-3 text-center">
            <div className="rounded-lg sm:rounded-2xl border border-destructive/30 bg-destructive/10 p-2 sm:p-3 text-xs text-destructive">
              <div className="flex items-center justify-center gap-1.5">
                <AlertCircle className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                <span>Intentos agotados</span>
              </div>
            </div>
            <button
              onClick={handleResetAttempts}
              className="w-full rounded-lg sm:rounded-xl border border-primary/30 bg-primary/10 py-1.5 sm:py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
            >
              Reiniciar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}