import { useState } from "react";
import { Smartphone, Music, Layers, Puzzle, Search, ListMusic, Tags, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import ModalWrapper from "@/components/ui/modal-wrapper";

const features = [
  { titleKey: "mobileFeature1Title", descKey: "mobileFeature1Desc", icon: Music },
  { titleKey: "mobileFeature2Title", descKey: "mobileFeature2Desc", icon: Layers },
  { titleKey: "mobileFeature3Title", descKey: "mobileFeature3Desc", icon: Puzzle },
  { titleKey: "mobileFeature4Title", descKey: "mobileFeature4Desc", icon: Search },
  { titleKey: "mobileFeature5Title", descKey: "mobileFeature5Desc", icon: ListMusic },
  { titleKey: "mobileFeature6Title", descKey: "mobileFeature6Desc", icon: Tags },
];

type Props = { open: boolean; onClose: () => void };

export default function MobileModal({ open, onClose }: Props) {
  const t = useI18n();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <ModalWrapper open={open} onClose={onClose} title="Bitly Mobile" subtitle="Music utility built with Flutter and Go" icon={<Smartphone className="h-6 w-6 text-primary" />}>
      <div className="mb-3 flex flex-wrap justify-center gap-1.5 text-[10px] text-muted-foreground sm:text-xs">
        <span className="rounded-full border border-border/60 bg-card/40 px-2 py-0.5 backdrop-blur sm:px-3 sm:py-1">Android 7.0+</span>
      </div>
      <div className="space-y-1.5">
        {features.map((f, i) => {
          const Icon = f.icon;
          const isOpen = openIdx === i;
          return (
            <button key={i} onClick={() => setOpenIdx(isOpen ? null : i)} className="group w-full rounded-xl border border-border bg-gradient-to-b from-card/40 to-card/20 p-3 text-left backdrop-blur transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/30 sm:h-9 sm:w-9" style={{ background: "var(--gradient-mint)", opacity: 0.9 }}>
                    <Icon className="h-3.5 w-3.5 text-background sm:h-4 sm:w-4" />
                  </div>
                  <h3 className="text-xs font-semibold sm:text-sm">{t(f.titleKey)}</h3>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
              </div>
              <div className={`grid transition-all duration-300 ${isOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden"><p className="text-[10px] leading-relaxed text-muted-foreground sm:text-xs">{t(f.descKey)}</p></div>
              </div>
            </button>
          );
        })}
      </div>
    </ModalWrapper>
  );
}
