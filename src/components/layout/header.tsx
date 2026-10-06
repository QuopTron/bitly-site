import { Sun, Moon, Globe, Menu, X } from "lucide-react";
import logo from "@/assets/bitly-logo.png";
import { useI18n, setLanguage, getLanguage } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { aplicarTema, temaGuardado, type Tema } from "@/lib/tema";
import CurrencySelector from "./currency-selector";

type Props = Record<string, never>;

export default function Header(_props: Props) {
  const t = useI18n();
  const [lang, setLang] = useState(getLanguage());
  // El estado arranca con lo GUARDADO (el script del <head> ya lo aplicó) y se
  // corrige al montar: así el ícono coincide con el tema real y no depende de
  // que este componente se hidrate a tiempo.
  const [theme, setTheme] = useState<Tema>(() =>
    typeof document === "undefined" ? "dark" : temaGuardado(),
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const toggleTheme = () => {
    const next: Tema = theme === "dark" ? "light" : "dark";
    setTheme(next);
    aplicarTema(next);
  };

  const switchLang = () => {
    const next = lang === "es" ? "en" : "es";
    setLanguage(next);
    setLang(next);
  };

  return (
    <header id="inicio" className="container mx-auto px-4 py-4 sm:px-6 sm:py-6">
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
          <button onClick={() => setMobileOpen(!mobileOpen)} className="inline-flex sm:hidden items-center justify-center rounded-full border border-border bg-card/40 px-2.5 py-2 text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground active:scale-90">
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="hidden sm:flex items-center gap-3">
            <CurrencySelector />
            <button onClick={toggleTheme} className="inline-flex items-center justify-center rounded-full border border-border bg-card/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground active:scale-95">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button onClick={switchLang} className="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground active:scale-95">
              <Globe className="h-3 w-3" />
              {t("langSwitch")}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-border/50 bg-card/95 p-3 shadow-xl backdrop-blur animate-in fade-in slide-in-from-top-2 duration-200 sm:hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("currencyTitle")}</span>
            <CurrencySelector />
          </div>
          <div className="flex gap-2">
            <button onClick={toggleTheme} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground active:scale-95">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button onClick={switchLang} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground active:scale-95">
              <Globe className="h-3 w-3" />
              {t("langSwitch")}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
