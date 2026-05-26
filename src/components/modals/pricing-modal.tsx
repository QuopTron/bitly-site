import { useState, useEffect } from "react";
import { X, Clock, Gem, Send, Check, Timer, Zap } from "lucide-react";
import { useI18n, getLanguage } from "@/lib/i18n";
import { useCurrency, convert, format, INFO } from "@/lib/currency";

const NORMAL_PRICE = 50;

type Offer = {
  price: number;
  pct: number;
  label: string;
  tag: "flash" | "last" | "special" | "permanent";
  icon: typeof Zap | typeof Clock | typeof Gem | typeof Timer;
  end: Date | null;
};

function getOffer(): Offer {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const at = (hour: number, day = 0): Date => {
    const e = new Date(now);
    e.setDate(e.getDate() + day);
    e.setHours(hour, 0, 0, 0);
    return e;
  };

  if (y === 2026 && m === 4 && d === 26) {
    if (h >= 14 && h < 18) return { price: 25, pct: 50, label: "50% OFF", tag: "flash", icon: Zap, end: at(18) };
    if (h >= 18 && h < 20) return { price: 30, pct: 40, label: "40% OFF", tag: "flash", icon: Zap, end: at(20) };
    if (h < 14) return { price: 50, pct: 0, label: "50 Bs", tag: "special", icon: Clock, end: at(14) };
    return { price: 50, pct: 0, label: "50 Bs", tag: "special", icon: Clock, end: at(14, 1) };
  }
  if (y === 2026 && m === 4 && d === 27) {
    if (h >= 14 && h < 18) return { price: 35, pct: 30, label: "30% OFF", tag: "flash", icon: Zap, end: at(18) };
    if (h >= 18 && h < 20) return { price: 40, pct: 20, label: "20% OFF", tag: "flash", icon: Zap, end: at(20) };
    if (h >= 20 && h < 21) return { price: 45, pct: 10, label: "10% OFF", tag: "last", icon: Timer, end: at(21) };
    if (h < 14) return { price: 50, pct: 0, label: "50 Bs", tag: "special", icon: Clock, end: at(14) };
    return { price: 50, pct: 0, label: "50 Bs", tag: "special", icon: Clock, end: null };
  }
  return { price: 50, pct: 0, label: "50 Bs", tag: "permanent", icon: Gem, end: null };
}

function formatCountdown(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const TAG_META: Record<string, { label: [string, string]; grad: string }> = {
  flash:     { label: ["¡Oferta relámpago!", "Flash offer!"],         grad: "from-green-400 to-emerald-500" },
  last:      { label: ["Última oportunidad", "Last chance!"],         grad: "from-emerald-500 to-green-600" },
  special:   { label: ["Precio especial", "Special price"],           grad: "from-primary to-accent" },
  permanent: { label: ["Precio especial", "Special price"],           grad: "from-primary to-accent" },
};

export default function PricingModal({ onClose, onPreReserve }: { onClose: () => void; onPreReserve: () => void }) {
  const t = useI18n();
  const [currency] = useCurrency();
  const [offer, setOffer] = useState(getOffer);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    function tick() {
      const o = getOffer();
      setOffer(o);
      if (o.end) setCountdown(Math.max(0, Math.floor((o.end.getTime() - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const sym = INFO[currency].sym;
  const freeKeys = ["pricingFree1", "pricingFree2", "pricingFree3"];
  const premKeys = ["pricingPremium1", "pricingPremium2", "pricingPremium4", "pricingPremium5", "pricingPremium8"];
  const showCount = offer.end !== null && countdown > 0;
  const lang = getLanguage();
  const meta = TAG_META[offer.tag];
  const tagLabel = meta.label[lang === "es" ? 0 : 1];
  const urgent = showCount && countdown <= 60;
  const isPct = offer.tag === "flash" || offer.tag === "last";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-3 sm:p-4">
      <div
        className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="sticky top-2 z-20 float-right flex h-7 w-7 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-all duration-200 hover:bg-card hover:text-foreground hover:shadow-primary/10 sm:h-8 sm:w-8"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 shadow-lg shadow-primary/15 ring-1 ring-primary/25">
            <Gem className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">{t("pricingTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("pricingSubtitle")}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <div className="rounded-2xl bg-gradient-to-b from-card to-card/80 p-4 shadow-lg shadow-black/5 ring-1 ring-border/60 transition-all duration-300 hover:shadow-xl hover:ring-primary/20 hover:-translate-y-0.5 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("pricingFree")}
            </h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground sm:text-4xl">0</span>
              <span className="text-sm text-muted-foreground">{sym}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("pricingFreeDesc")}</p>
            <ul className="mt-4 space-y-2.5">
              {freeKeys.map((k, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>

          <div className={`relative rounded-2xl bg-gradient-to-b p-4 shadow-xl ring-1 transition-all duration-300 hover:shadow-2xl hover:-translate-y-0.5 sm:p-6 ${
            isPct
              ? "from-green-500/[0.12] to-emerald-500/[0.03] shadow-green-500/20 ring-green-500/30 hover:shadow-green-500/30"
              : "from-primary/[0.10] to-primary/[0.02] shadow-primary/15 ring-primary/25 hover:shadow-primary/25"
          }`} style={{ boxShadow: isPct ? "0 0 40px oklch(0.82 0.18 165 / 0.25), 0 20px 60px -20px oklch(0 0 0 / 0.3)" : "var(--glow-card), 0 20px 60px -20px oklch(0 0 0 / 0.3)" }}>
            <div className={`absolute inset-0 rounded-2xl bg-gradient-to-b via-transparent to-transparent pointer-events-none ${
              isPct ? "from-green-400/15" : "from-primary/10"
            }`} />
            <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg sm:px-4 sm:text-[10px] ${
              isPct
                ? "bg-gradient-to-r from-green-500 to-emerald-600 shadow-green-500/40"
                : "bg-gradient-to-r from-primary to-accent shadow-primary/30"
            }`}>
              {t("pricingRecommended")}
            </span>
            <h3 className="relative text-xs font-semibold uppercase tracking-widest text-primary">
              {t("pricingPremium")}
            </h3>
            <div className="relative mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground sm:text-4xl">
                {convert(offer.price, currency)}
              </span>
              <span className="text-sm text-muted-foreground">{sym}</span>
            </div>
            <p className="relative mt-1 text-xs text-muted-foreground">{t("pricingLifetime")}</p>
            {offer.price < NORMAL_PRICE && (
              <p className="relative text-xs text-muted-foreground/60">
                <span className="line-through">{convert(NORMAL_PRICE, currency)} {sym}</span>
                <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm ${
                  isPct
                    ? "bg-gradient-to-r from-green-400/30 to-emerald-400/10 text-green-400 shadow-green-500/20"
                    : "bg-gradient-to-r from-primary/20 to-primary/10 text-primary"
                }`}>
                  {isPct ? `-${offer.pct}%` : offer.label}
                </span>
              </p>
            )}
            <ul className="relative mt-4 space-y-2.5">
              {premKeys.map((k, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20">
                    <Check className="h-2.5 w-2.5 text-primary" />
                  </div>
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-gradient-to-b from-card/90 to-card/70 p-5 shadow-lg shadow-black/5 ring-1 ring-border/50 backdrop-blur sm:p-6">
          <div className="space-y-4 text-center">
            <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg ring-1 ${
              offer.tag === "flash"
                ? "from-green-400/30 to-emerald-400/10 shadow-green-500/25 ring-green-500/30"
                : offer.tag === "last"
                  ? "from-emerald-400/30 to-green-400/10 shadow-emerald-500/25 ring-emerald-500/30"
                  : "from-primary/25 to-primary/5 shadow-primary/15 ring-primary/25"
            }`}>
              <offer.icon className={`h-6 w-6 ${
                offer.tag === "flash" ? "text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]" :
                offer.tag === "last" ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" :
                "text-primary"
              }`} />
            </div>
            <div>
              <p className={`text-sm font-bold ${
                offer.tag === "flash" ? "text-green-400 drop-shadow-[0_0_12px_rgba(74,222,128,0.3)]" :
                offer.tag === "last" ? "text-emerald-400" :
                "text-foreground"
              }`}>
                {tagLabel}
              </p>
              {showCount && (
                <div className={`mt-2 flex items-center justify-center gap-2 text-base font-mono font-bold tracking-wider ${
                  urgent ? "text-green-300 animate-pulse drop-shadow-[0_0_10px_rgba(134,239,172,0.5)]" :
                  offer.tag === "flash" ? "text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.4)]" :
                  "text-primary"
                }`}>
                  <Timer className="h-4 w-4" />
                  {formatCountdown(countdown)}
                </div>
              )}
              <p className="mt-3 text-lg font-bold text-foreground">
                {format(offer.price, currency)}
              </p>
              <p className="text-xs text-muted-foreground">{t("pricingLifetime")}</p>
            </div>
            <button
              onClick={() =>
                window.open(
                  "https://wa.me/59173427418?text=" +
                    encodeURIComponent(
                      getLanguage() === "es"
                        ? `¡Hola! Quiero Bitly Premium a ${format(offer.price, "BOB")}${offer.pct > 0 ? ` (${offer.pct}% OFF)` : ""}`
                        : `Hi! I want Bitly Premium at ${format(offer.price, "BOB")}${offer.pct > 0 ? ` (${offer.pct}% OFF)` : ""}`
                    ),
                  "_blank", "noopener,noreferrer"
                )
              }
              className={`w-full rounded-xl bg-gradient-to-r py-3 text-sm font-bold shadow-lg transition-all duration-200 hover:shadow-xl active:scale-[0.97] ${
                isPct
                  ? "text-white from-green-500 to-emerald-600 shadow-green-500/30 hover:shadow-green-500/50"
                  : "text-primary-foreground from-primary to-accent shadow-primary/20 hover:shadow-primary/30"
              }`}
            >
              <Send className="mr-2 inline h-4 w-4" />
              {isPct ? t("pricingAcquire") : t("pricingWhatsApp")}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted-foreground/40">
          {t("currencyCompany")} · {t("currencyBs")}
        </p>
      </div>
    </div>
  );
}
