import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";

const faqs = [
  { qKey: "faq1Q", aKey: "faq1A" },
  { qKey: "faq2Q", aKey: "faq2A" },
  { qKey: "faq3Q", aKey: "faq3A" },
  { qKey: "faq4Q", aKey: "faq4A" },
  { qKey: "faq5Q", aKey: "faq5A" },
  { qKey: "faq6Q", aKey: "faq6A" },
  { qKey: "faq7Q", aKey: "faq7A" },
];

type Props = { open: boolean; onClose: () => void };

export default function FaqModal({ open, onClose }: Props) {
  const t = useI18n();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <ModalWrapper open={open} onClose={onClose} title={t("faqTitle")} subtitle={t("faqDesc")} icon={<HelpCircle className="h-6 w-6 text-primary" />}>
      <div className="space-y-1.5">
        {faqs.map((faq, i) => {
          const isOpen = openIdx === i;
          return (
            <button key={i} onClick={() => setOpenIdx(isOpen ? null : i)} className="w-full rounded-xl border border-border bg-gradient-to-b from-card/40 to-card/20 p-3 text-left backdrop-blur transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold sm:text-sm">{t(faq.qKey)}</h4>
                <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
              </div>
              <div className={`grid transition-all duration-300 ${isOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden"><p className="text-[10px] leading-relaxed text-muted-foreground sm:text-xs">{t(faq.aKey)}</p></div>
              </div>
            </button>
          );
        })}
      </div>
    </ModalWrapper>
  );
}
