import { useState } from "react";
import { Check, X as XIcon, MessageCircle, Gem, Info } from "lucide-react";
import { useI18n, getLanguage } from "@/lib/i18n";
import { getFaseActual } from "@/lib/pricing";
import { useCurrency, format } from "@/lib/currency";
import { retraso } from "@/lib/reveal";
import { enlaceWhatsApp } from "@/lib/contacto";
import SectionHeader from "@/components/ui/section-header";
import ModalWrapper from "@/components/ui/modal-wrapper";

const freeFeatures = ["freeCompare1", "freeCompare2", "freeCompare3", "freeCompare4"];
const freeBlocked = ["freeNoUnlimited", "freeNoFlac", "freeNoBatch"];
const premFeatures = ["premiumCompare1", "premiumCompare2", "premiumCompare3", "premiumCompare4", "premiumCompare5", "premiumCompare6", "premiumCompare7", "premiumCompare8"];

export default function PlansSection() {
  const t = useI18n();
  const [currency] = useCurrency();
  const { precio, original, etiqueta, etiquetaEn, enOferta } = getFaseActual();
  const lang = getLanguage();
  const [infoHoras, setInfoHoras] = useState(false);
  const [comoObtener, setComoObtener] = useState(false);
  const [planMovil, setPlanMovil] = useState<"free" | "premium">("premium");

  return (
    <section id="planes" className="container mx-auto px-4 pb-4 pt-2 sm:px-6 sm:pb-5 sm:pt-2">
      <SectionHeader
        numero="04"
        icono={Gem}
        badge={t("plansSubtitle")}
        titulo={t("plansTitle")}
        descripcion={t("plansDescription")}
        descripcionSoloEscritorio
        compacto
      />

      <div
        role="tablist"
        aria-label={t("plansTitle")}
        className="mx-auto mb-2 flex max-w-fit gap-1 rounded-full border border-border bg-card/60 p-1 md:hidden"
      >
        {([
          { id: "free", label: t("plansFree") },
          { id: "premium", label: t("plansPremium") },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={planMovil === id}
            onClick={() => setPlanMovil(id)}
            className={`texto-tag rounded-full px-4 py-2 text-sm transition-colors ${
              planMovil === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        {/* Free */}
        <div
          data-reveal suppressHydrationWarning
          style={retraso(60)}
          className={`tarjeta p-4 transition-transform duration-300 hover:-translate-y-1 sm:p-5 md:block ${
            planMovil === "free" ? "block" : "hidden"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="texto-tag text-2xl leading-none sm:text-3xl">{t("plansFree")}</h3>
            <span className="etiqueta">
              {t("plansFreePrice").replace("{price}", format(0, currency))}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:block sm:space-y-2.5">
            {freeFeatures.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
                  <Check className="h-3 w-3 text-muted-foreground" />
                </span>
                <span className="flex items-start gap-1.5">
                  <span className="min-w-0">{t(k)}</span>
                  {k === "freeCompare3" && (
                    <span className="relative inline-flex shrink-0">
                      <button
                        type="button"
                        aria-label={t("freeCompare3InfoLabel")}
                        aria-expanded={infoHoras}
                        onClick={() => setInfoHoras((v) => !v)}
                        className="flex h-4 w-4 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                      {infoHoras && (
                        <span className="absolute right-0 top-6 z-30 w-64 rounded-xl border border-border bg-card p-3 text-xs leading-relaxed text-foreground shadow-xl">
                          {t("freeCompare3Info")}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </li>
            ))}
            {freeBlocked.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-muted/20">
                  <XIcon className="h-3 w-3 text-muted-foreground" />
                </span>
                <span className="line-through">{t(k)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("plansSeeMore")}</p>
        </div>

        {/* Premium */}
        <div
          data-reveal suppressHydrationWarning
          style={retraso(150)}
          className={`tarjeta tarjeta-al-reves relative p-4 transition-transform duration-300 hover:-translate-y-1 sm:p-5 md:block ${
            planMovil === "premium" ? "block" : "hidden"
          } [border-color:var(--foreground)]`}
        >
          {enOferta && (
            <div className="etiqueta absolute -right-2 -top-3 rotate-3 bg-primary text-primary-foreground sm:right-4">
              {lang === "es" ? etiqueta : etiquetaEn}
            </div>
          )}
          <div className="mb-3 pt-2 sm:pt-0">
            <h3 className="texto-tag text-2xl leading-none text-primary sm:text-3xl">{t("plansPremium")}</h3>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="texto-tag text-4xl leading-none text-foreground sm:text-6xl">{format(precio, currency)}</span>
              {enOferta && <span className="text-sm text-muted-foreground line-through">{format(original, currency)}</span>}
            </div>
            <p className="mt-1 text-xs font-medium text-primary">{t("plansPremiumPrice")}</p>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:block sm:space-y-2.5">
            {premFeatures.map((k) => (
              <li key={k} className="flex items-center gap-2 text-xs text-muted-foreground sm:gap-2.5 sm:text-sm">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
                  <Check className="h-3 w-3 text-primary" />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        data-reveal
        suppressHydrationWarning
        className="mx-auto mt-3 flex max-w-4xl flex-col items-center justify-between gap-2 rounded-[1.8rem] border border-border bg-card/60 p-3 sm:mt-4 sm:flex-row sm:pl-5"
      >
        <div className="min-w-0 text-center sm:text-left">
          <p className="texto-tag text-lg leading-none">{t("plansHowToGet")}</p>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{t("plansPremiumPrice")}</p>
        </div>
        <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => setComoObtener(true)}
            className="boton-fantasma min-h-10 px-4 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("plansHowToGet")}
          </button>
          <a
            href={enlaceWhatsApp(t("plansWaText"))}
            target="_blank"
            rel="noopener noreferrer"
            className="boton-spray group min-h-10 gap-2.5 px-4 py-2 text-sm"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            <span className="text-left">
              <span className="block text-[10px] font-normal opacity-80">{t("plansWhatsAppHint")}</span>
              <span className="block text-xs">{t("plansWhatsAppLabel")}</span>
            </span>
          </a>
        </div>
      </div>

      <ModalWrapper
        open={comoObtener}
        onClose={() => setComoObtener(false)}
        title={t("plansHowToGet")}
        subtitle={t("plansDescription")}
        icon={<Gem className="h-6 w-6 text-primary" />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[t("plansStep1"), t("plansStep2"), t("plansStep3")].map((paso, i) => (
            <div key={paso} className="tarjeta-tenue flex flex-col items-center gap-2 p-4 text-center">
              <span aria-hidden className="numero-seccion text-4xl text-primary/60">{i + 1}</span>
              <p className="text-xs text-muted-foreground sm:text-sm">{paso}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">{t("plansWhatsAppHint")}</p>
      </ModalWrapper>
    </section>
  );
}
