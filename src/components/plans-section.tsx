import { Check, X as XIcon, MessageCircle, Camera, Gem, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const WHATSAPP = "+59173427418";
const INSTAGRAM = "flox_devs_sucre";
const IG_URL = "https://www.instagram.com/flox_devs_sucre/";

const freeFeatures = ["freeCompare1", "freeCompare2", "freeCompare3", "freeCompare4"];
const freeBlocked = ["freeNoUnlimited", "freeNoFlac", "freeNoBatch"];
const premFeatures = ["premiumCompare1", "premiumCompare2", "premiumCompare3", "premiumCompare4", "premiumCompare5", "premiumCompare6", "premiumCompare7", "premiumCompare8"];

export default function PlansSection() {
  const t = useI18n();

  return (
    <section className="container mx-auto px-4 py-12 sm:px-6 sm:py-16 md:py-20">
      <div className="mb-8 text-center sm:mb-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs">
          <Gem className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {t("plansSubtitle")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("plansTitle")}
          </span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          {t("plansDescription")}
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl gap-4 sm:gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="rounded-2xl bg-gradient-to-b from-card to-card/80 p-5 ring-1 ring-border/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold sm:text-xl">{t("plansFree")}</h3>
            <span className="rounded-full bg-muted/50 px-3 py-1 text-xs font-semibold text-muted-foreground">{t("plansFreePrice")}</span>
          </div>
          <ul className="space-y-3">
            {freeFeatures.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted/50">
                  <Check className="h-3 w-3 text-muted-foreground" />
                </span>
                {t(k)}
              </li>
            ))}
            {freeBlocked.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm text-muted-foreground/50">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted/30">
                  <XIcon className="h-3 w-3 text-muted-foreground/50" />
                </span>
                <span className="line-through">{t(k)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground/60">{t("plansSeeMore")}</p>
        </div>

        {/* Premium */}
        <div className="relative rounded-2xl bg-gradient-to-b from-primary/[0.08] to-primary/[0.02] p-5 ring-1 ring-primary/25 shadow-xl shadow-primary/5 sm:p-6">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-green-500/30 sm:px-4 sm:text-xs">
            {t("plansOfferTag")}
          </div>
          <div className="mb-4 pt-2">
            <h3 className="text-lg font-bold text-primary sm:text-xl">{t("plansPremium")}</h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-foreground sm:text-4xl">30 Bs</span>
              <span className="text-sm text-muted-foreground/60 line-through">{t("plansOriginalPrice")}</span>
            </div>
            <p className="mt-1 text-xs text-primary font-medium">{t("plansPremiumPrice")}</p>
          </div>
          <ul className="space-y-3">
            {premFeatures.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <Check className="h-3 w-3 text-primary" />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* How to get it */}
      <div className="mx-auto mt-10 max-w-2xl sm:mt-12">
        <div className="rounded-2xl border border-border bg-gradient-to-b from-card/60 to-card/30 p-5 backdrop-blur sm:p-6">
          <h3 className="mb-4 text-center text-base font-bold sm:text-lg">{t("plansHowToGet")}</h3>

          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-card/40 p-4 text-center ring-1 ring-border/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">1</div>
              <p className="text-xs text-muted-foreground sm:text-sm">{t("plansStep1")}</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl bg-card/40 p-4 text-center ring-1 ring-border/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">2</div>
              <p className="text-xs text-muted-foreground sm:text-sm">{t("plansStep2")}</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl bg-card/40 p-4 text-center ring-1 ring-border/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">3</div>
              <p className="text-xs text-muted-foreground sm:text-sm">{t("plansStep3")}</p>
            </div>
          </div>

          {/* Contact buttons */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href={`https://wa.me/59173427418?text=${encodeURIComponent("Hola! Quiero Bitly Premium")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2.5 rounded-xl bg-[#25D366] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#25D366]/20 transition-all hover:shadow-xl hover:shadow-[#25D366]/30 hover:scale-[1.02] active:scale-[0.98]"
            >
              <MessageCircle className="h-5 w-5" />
              <div className="text-left">
                <div className="text-[10px] font-normal opacity-80">{t("plansWhatsAppLabel")}</div>
                <div>{WHATSAPP}</div>
              </div>
            </a>
            <a
              href={IG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#FCAF45] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#833AB4]/20 transition-all hover:shadow-xl hover:shadow-[#833AB4]/30 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Camera className="h-5 w-5" />
              <div className="text-left">
                <div className="text-[10px] font-normal opacity-80">{t("plansIGLabel")}</div>
                <div>@{INSTAGRAM}</div>
              </div>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
