import { ChevronDown, HelpCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { FAQ } from "@/lib/faq";
import { retraso } from "@/lib/reveal";

/**
 * Sección de preguntas frecuentes.
 *
 * Va SIEMPRE en la página, no en un modal: es el único modo de que Google la
 * indexe, de que el `FAQPage` del JSON-LD coincida con lo visible y de que
 * quien navega con teclado o lector de pantalla pueda leerla sin abrir nada.
 *
 * Usa `<details>` nativo: sin JavaScript, con foco y con la flecha del sistema.
 * Las respuestas quedan en el HTML desde el primer pintado aunque estén
 * plegadas, que es exactamente lo que piden los rich results.
 */
export default function FaqSection() {
  const t = useI18n();

  return (
    <section id="faq" className="container mx-auto scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mb-6 text-center sm:mb-8" data-reveal suppressHydrationWarning>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur sm:px-4">
          <HelpCircle className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {t("faqTitle")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("faqTitle")}
          </span>
        </h2>
        <span aria-hidden className="bit-regla mx-auto mt-3 block h-px w-24 opacity-60" />
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">{t("faqDesc")}</p>
      </div>

      <div className="mx-auto grid max-w-3xl gap-2.5 sm:gap-3" data-reveal suppressHydrationWarning style={retraso(80)}>
        {FAQ.map((item) => (
          <details
            key={item.qKey}
            className="group rounded-2xl border border-border/60 bg-gradient-to-b from-card/50 to-card/20 px-4 backdrop-blur transition-all duration-300 open:border-primary/40 sm:px-5"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary sm:py-4 sm:text-base [&::-webkit-details-marker]:hidden">
              {t(item.qKey)}
              <ChevronDown
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
              />
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{t(item.aKey)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
