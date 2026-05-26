import { useI18n } from "@/lib/i18n";

export default function Footer() {
  const t = useI18n();

  return (
    <footer className="container mx-auto px-4 py-3 text-center text-[10px] text-muted-foreground sm:px-6 sm:py-4 sm:text-xs">
      <p className="mb-1">{t("footerDisclaimer")}</p>
      <p>© {new Date().getFullYear()} Bitly · Open Source</p>
    </footer>
  );
}
