import { Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function BlockedBanner() {
  const t = useI18n();

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-center">
      <p className="flex items-center justify-center gap-2 text-xs font-semibold text-primary sm:text-sm">
        <Clock className="h-3.5 w-3.5" />
        {t("blockedBanner")}
      </p>
    </div>
  );
}
