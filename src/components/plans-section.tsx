import { Check, X as XIcon, MessageCircle, Gem } from "lucide-react";
import { useI18n, getLanguage } from "@/lib/i18n";
import { getFaseActual } from "@/lib/pricing";
import { useCurrency, format } from "@/lib/currency";
import { retraso } from "@/lib/reveal";
import { enlaceWhatsApp } from "@/lib/contacto";

const freeFeatures = ["freeCompare1", "freeCompare2", "freeCompare3", "freeCompare4"];
const freeBlocked = ["freeNoUnlimited", "freeNoFlac", "freeNoBatch"];
const premFeatures = ["premiumCompare1", "premiumCompare2", "premiumCompare3", "premiumCompare4", "premiumCompare5", "premiumCompare6", "premiumCompare7", "premiumCompare8"];

export default function PlansSection() {
  const t = useI18n();
  const [currency] = useCurrency();
  const { precio, original, etiqueta, etiquetaEn, enOferta } = getFaseActual();
  const lang = getLanguage();

  return (
    <section id="planes" className="container mx-auto scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16 md:py-20">
      <div className="mb-8 text-center sm:mb-10" data-reveal>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs">
          <Gem className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {t("plansSubtitle")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("plansTitle")}
          </span>
        </h2>
        <span aria-hidden className="bit-regla mx-auto mt-3 block h-px w-24 opacity-60" />
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          {t("plansDescription")}
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl gap-4 sm:gap-6 md:grid-cols-2">
        {/* Free */}
        <div
          data-reveal
          style={retraso(60)}
          className="rounded-2xl bg-gradient-to-b from-card to-card/80 p-5 ring-1 ring-border/60 transition-all duration-300 hover:-translate-y-1 hover:ring-border/80 sm:p-6"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold sm:text-xl">{t("plansFree")}</h3>
            <span className="rounded-full bg-muted/50 px-3 py-1 text-xs font-semibold text-muted-foreground">
              {t("plansFreePrice").replace("{price}", format(0, currency))}
            </span>
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
        <div
          data-reveal
          style={retraso(150)}
          className="relative rounded-2xl bg-gradient-to-b from-primary/[0.08] to-primary/[0.02] p-5 ring-1 ring-primary/25 shadow-xl shadow-primary/5 transition-all duration-300 hover:-translate-y-1 hover:ring-primary/45 sm:p-6"
        >
          {enOferta && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#15803D] to-[#0E7A46] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-[#15803D]/30 sm:px-4 sm:text-xs">
              {lang === "es" ? etiqueta : etiquetaEn}
            </div>
          )}
          <div className="mb-4 pt-2">
            <h3 className="text-lg font-bold text-primary sm:text-xl">{t("plansPremium")}</h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-foreground sm:text-4xl">{format(precio, currency)}</span>
              {enOferta && <span className="text-sm text-muted-foreground/60 line-through">{format(original, currency)}</span>}
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
        <div data-reveal className="rounded-2xl border border-border bg-gradient-to-b from-card/60 to-card/30 p-5 backdrop-blur sm:p-6">
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

          {/* Contacto: SÓLO el de compra. El par WhatsApp + Instagram que había
              acá se repetía tal cual, un scroll más abajo, en la tarjeta de
              contacto (`#contacto`), que es además la que apunta la barra de
              secciones. Los datos (número y usuario) viven en esa tarjeta y
              salen de `@/lib/contacto`: acá el botón no los repite. */}
          <div className="mt-5 flex justify-center">
            <a
              href={enlaceWhatsApp(t("plansWaText"))}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#15803D] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#15803D]/25 transition-all hover:bg-[#0E7A46] hover:shadow-xl hover:shadow-[#15803D]/35 hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              <MessageCircle className="h-5 w-5" aria-hidden />
              <span className="text-left">
                <span className="block text-[10px] font-normal opacity-80">{t("plansWhatsAppHint")}</span>
                <span className="block">{t("plansWhatsAppLabel")}</span>
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
