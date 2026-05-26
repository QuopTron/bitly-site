import { Sun, Moon, Globe, Wallet, Download, Menu, X } from "lucide-react";
import logo from "@/assets/bitly-logo.png";
import { useI18n, setLanguage, getLanguage } from "@/lib/i18n";
import { useState } from "react";
import CurrencySelector from "./currency-selector";

type Props = {
  onPricing: () => void;
};

export default function Header({ onPricing }: Props) {
  const t = useI18n();
  const [lang, setLang] = useState(getLanguage());
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("light") ? "light" : "dark"
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(next);
    localStorage.setItem("bitly_theme", next);
  };

  const switchLang = () => {
    const next = lang === "es" ? "en" : "es";
    setLanguage(next);
    setLang(next);
  };

  return (
    <header className="container mx-auto px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-3 sm:justify-normal">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Logo" className="h-8 w-8 sm:h-10 sm:w-10" />
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight sm:text-xl">Bitly</span>
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground sm:text-[10px]">
              <span className="text-foreground">{t("poweredBy")} </span>
              <span className="font-semibold text-foreground">Flo</span>
              <span className="font-semibold text-primary">X</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 sm:flex-1 sm:justify-end">
          <button onClick={() => setMobileOpen(!mobileOpen)} className="inline-flex sm:hidden items-center justify-center rounded-full border border-border bg-card/40 px-2.5 py-2 text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="hidden sm:flex items-center gap-3">
            <CurrencySelector />
            <button onClick={toggleTheme} className="inline-flex items-center justify-center rounded-full border border-border bg-card/40 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button onClick={switchLang} className="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
              <Globe className="h-3 w-3" />
              {t("langSwitch")}
            </button>
            <button onClick={onPricing} className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20 sm:px-5 sm:text-sm">
              <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t("pricingTitle")}
            </button>
            <a href="#descargar" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 sm:px-5 sm:text-sm">
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {t("navDownload")}
            </a>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-border/50 bg-card/95 p-3 shadow-xl backdrop-blur sm:hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("currencyTitle")}</span>
            <CurrencySelector />
          </div>
          <div className="flex gap-2">
            <button onClick={toggleTheme} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button onClick={switchLang} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
              <Globe className="h-3 w-3" />
              {t("langSwitch")}
            </button>
          </div>
          <button onClick={() => { onPricing(); setMobileOpen(false); }} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/20">
            <Wallet className="h-3.5 w-3.5" /> {t("pricingTitle")}
          </button>
          <a href="#descargar" onClick={() => setMobileOpen(false)} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> {t("navDownload")}
          </a>
        </div>
      )}
    </header>
  );
}
