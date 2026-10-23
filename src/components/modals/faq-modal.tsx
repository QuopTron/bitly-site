import { ChevronDown, HelpCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { FAQ } from "@/lib/faq";
import ModalWrapper from "@/components/ui/modal-wrapper";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Preguntas frecuentes en modal. La guía de iconos de la cabecera vive en
 * `pistas-cabecera.tsx`: unas flechas que apuntan a cada botón la primera vez.
 */
export default function FaqModal({ open, onClose }: Props) {
  const t = useI18n();

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("faqTitle")}
      subtitle={t("faqModalDesc")}
      icon={<HelpCircle className="h-6 w-6 text-primary" />}
      ancho="amplio"
    >
      <div className="divide-y divide-border/70 rounded-2xl border border-border/60 bg-background/35 px-3 sm:px-4">
        {FAQ.map((item, i) => (
          <details key={item.qKey} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 py-3 text-sm font-semibold text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary sm:text-base [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="texto-marker shrink-0 text-lg text-primary/40">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1">{t(item.qKey)}</span>
              <ChevronDown
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
              />
            </summary>
            <p className="pb-3.5 pl-9 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {t(item.aKey)}
            </p>
          </details>
        ))}
      </div>
    </ModalWrapper>
  );
}
