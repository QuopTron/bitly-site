import { Sun, Moon, Globe, Menu, X, ChevronRight, MessageCircle, HelpCircle, Download, User } from "lucide-react";
import splashBlanco from "@/assets/splash-blanco-128.webp";
import splashNegro from "@/assets/splash-negro-128.webp";
import { useI18n, useLanguage } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { aplicarTema, type Tema } from "@/lib/tema";
import { VISTAS, type VistaId } from "@/lib/navegacion";
import CurrencySelector from "./currency-selector";
import SectionNav from "./section-nav";
import PistasCabecera from "./pistas-cabecera";

type Props = {
  vista: VistaId;
  onNavegar: (id: VistaId) => void;
  onComentarios: () => void;
  onFaq: () => void;
  onAdmin: () => void;
  onCuenta: () => void;
  pwaDisponible?: boolean;
  onInstalarPwa?: () => void;
};

export default function Header({ vista, onNavegar, onComentarios, onFaq, onAdmin, onCuenta, pwaDisponible, onInstalarPwa }: Props) {
  const t = useI18n();
  const [lang, setLang] = useLanguage();
  const [theme, setTheme] = useState<Tema>("dark");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [altoMenu, setAltoMenu] = useState<number>();
  const menuRef = useRef<HTMLDivElement>(null);
  const clicsLogo = useRef(0);
  const esperaLogo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enInicio = vista === "inicio";

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  // En celulares el alto visible cambia con la barra del navegador y algunos
  // WebViews (túneles de desarrollo incluidos) no respetan `dvh`. Medimos el
  // espacio real que queda bajo el menú y lo fijamos en píxeles para que
  // siempre se pueda desplazar.
  useEffect(() => {
    if (!mobileOpen) return;
    const medir = () => {
      const el = menuRef.current;
      if (!el) return;
      // La tarjeta de la cabecera no se mueve con la animación del menú.
      const tarjeta = el.parentElement?.getBoundingClientRect();
      const techo = (tarjeta?.bottom ?? el.getBoundingClientRect().top) + 8;
      setAltoMenu(Math.max(180, window.innerHeight - techo - 12));
    };
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    window.visualViewport?.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      window.visualViewport?.removeEventListener("resize", medir);
    };
  }, [mobileOpen]);

  // Con el menú abierto el fondo no se mueve: el gesto queda para el menú.
  useEffect(() => {
    if (!mobileOpen) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [mobileOpen]);

  const toggleTheme = () => {
    const next: Tema = theme === "dark" ? "light" : "dark";
    setTheme(next);
    aplicarTema(next);
  };

  const switchLang = () => {
    setLang(lang === "es" ? "en" : "es");
  };

  const irA = (id: VistaId) => {
    setMobileOpen(false);
    onNavegar(id);
  };

  const abrirComentarios = () => {
    setMobileOpen(false);
    onComentarios();
  };

  const abrirCuenta = () => {
    setMobileOpen(false);
    onCuenta();
  };

  /** Un clic vuelve al inicio; tres seguidos abren el acceso privado. */
  const alLogo = () => {
    clicsLogo.current += 1;
    if (esperaLogo.current) clearTimeout(esperaLogo.current);
    if (clicsLogo.current >= 3) {
      clicsLogo.current = 0;
      onAdmin();
      return;
    }
    esperaLogo.current = setTimeout(() => {
      clicsLogo.current = 0;
    }, 700);
    irA("inicio");
  };

  return (
    <header className="relative z-40 shrink-0 px-3 pb-2 pt-2 sm:px-4 sm:pt-3">
      <div className="relative mx-auto max-w-7xl rounded-[2.2rem] border border-border bg-card/85 px-2.5 py-1.5 sombra-tag-suave backdrop-blur-xl sm:px-4 sm:py-2">
        {/* Alto fijo por vista: el logo cambia de tamaño entre inicio y el resto,
            y sin este mínimo la cabecera encogía y corría todo el contenido. */}
        <div className="flex min-h-11 items-center gap-2 sm:min-h-12 sm:gap-2.5">
          {/* El nombre accesible tiene que CONTENER el texto visible tal cual
              («Bitly Powered by FloX»): con una coma en el medio, axe lo sigue
              marcando como inconsistencia. */}
          <button
            type="button"
            onClick={alLogo}
            aria-label={`Bitly ${t("poweredBy")} FloX — ${t("navInicio")}`}
            className="group flex min-w-0 shrink items-center gap-2 sm:gap-2.5"
          >
            <span
              className={`mancha relative flex shrink-0 items-center justify-center p-1.5 transition-all duration-500 ease-out ${
                enInicio
                  ? "h-10 w-10 -rotate-6 bg-menta-suave sm:h-12 sm:w-12"
                  : "h-9 w-9 rotate-3 bg-primary/20 shadow-[0_0_26px_-6px_var(--menta)] sm:h-10 sm:w-10"
              }`}
            >
              <span
                aria-hidden
                className={`mancha pointer-events-none absolute -inset-1.5 border border-dashed border-primary/45 transition-opacity duration-500 ${
                  enInicio ? "opacity-0" : "animate-spin opacity-100 [animation-duration:18s]"
                }`}
              />
              <img src={splashBlanco} alt="" width={128} height={128} className="logo-tema-oscuro h-full w-full object-contain" />
              <img src={splashNegro} alt="" width={128} height={128} className="logo-tema-claro h-full w-full object-contain" />
            </span>
            <span className="flex min-w-0 flex-col text-left">
              <span
                className={`texto-tag texto-aerosol truncate leading-none transition-all duration-300 ${
                  enInicio ? "text-xl sm:text-[1.8rem]" : "text-lg sm:text-2xl"
                }`}
              >
                Bitly
              </span>
              {/* La marca visible («Bitly powered by FloX») va también en el
                  aria-label del botón: si no, el nombre accesible no coincide
                  con el texto que se ve y los lectores de pantalla y axe lo
                  marcan como inconsistencia. */}
              <span
                className={`overflow-hidden whitespace-nowrap text-[9px] uppercase tracking-[0.1em] text-muted-foreground transition-all duration-300 sm:text-xs sm:tracking-[0.22em] ${
                  enInicio ? "mt-0.5 max-h-4 translate-y-0 opacity-100" : "mt-0 max-h-0 -translate-y-1 opacity-0"
                }`}
              >
                <span>{t("poweredBy")} </span>
                <span className="font-semibold text-foreground">Flo</span>
                <span className="font-semibold text-primary">X</span>
              </span>
            </span>
          </button>

          <span aria-hidden className="hidden h-7 w-px shrink-0 bg-border/70 lg:block" />

          <SectionNav activa={vista} onNavegar={irA} />

          <span aria-hidden className="hidden h-7 w-px shrink-0 bg-border/70 lg:block" />

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-3">
            {pwaDisponible && (
              <button
                type="button"
                onClick={onInstalarPwa}
                aria-label={t("pwaInstalar")}
                title={t("pwaInstalar")}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-2 text-[11px] font-semibold text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("pwaInstalar")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={abrirCuenta}
              data-pista="cuenta"
              aria-label={t("cuentaTitulo")}
              title={t("cuentaTitulo")}
              className="inline-flex items-center justify-center rounded-full border border-border bg-background/60 p-2 text-muted-foreground transition-all duration-200 hover:border-menta/60 hover:text-foreground active:scale-95"
            >
              <User aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onFaq}
              data-pista="faq"
              aria-label={t("faqTitle")}
              title={t("faqTitle")}
              className="inline-flex items-center justify-center rounded-full border border-border bg-background/60 p-2 text-muted-foreground transition-all duration-200 hover:border-menta/60 hover:text-foreground active:scale-95"
            >
              <HelpCircle aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={abrirComentarios}
              data-pista="comentarios"
              aria-label={t("comentariosTitulo")}
              title={t("comentariosTitulo")}
              className="hidden items-center justify-center rounded-full border border-border bg-background/60 p-2 text-muted-foreground transition-all duration-200 hover:border-menta/60 hover:text-foreground active:scale-95 lg:inline-flex"
            >
              <MessageCircle aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              data-pista="menu"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? t("headerMenuClose") : t("headerMenuOpen")}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background/60 p-2 text-muted-foreground transition-all duration-200 hover:bg-card hover:text-foreground active:scale-90 sm:px-3 lg:hidden"
            >
              {mobileOpen ? <X aria-hidden className="h-4 w-4" /> : <Menu aria-hidden className="h-4 w-4" />}
              <span className="hidden texto-tag text-[0.68rem] uppercase leading-none sm:inline">{t("headerMenuShort")}</span>
            </button>
            <div className="hidden items-center gap-3 lg:flex">
              <span data-pista="moneda">
                <CurrencySelector />
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                data-pista="tema"
                aria-label={theme === "dark" ? t("headerTemaLight") : t("headerTemaDark")}
                className="inline-flex items-center justify-center rounded-full border border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-menta/60 hover:text-foreground active:scale-95"
              >
                {theme === "dark" ? <Sun aria-hidden className="h-3.5 w-3.5" /> : <Moon aria-hidden className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={switchLang}
                data-pista="idioma"
                aria-label={t("headerIdioma")}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:border-menta/60 hover:text-foreground active:scale-95"
              >
                <Globe aria-hidden className="h-3 w-3" />
                {t("langSwitch")}
              </button>
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div
            ref={menuRef}
            style={{ maxHeight: altoMenu }}
            className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 flex max-h-[calc(100dvh-6rem)] touch-pan-y flex-col gap-3 overflow-y-auto overscroll-contain rounded-[1.6rem_2.2rem_1.6rem_2rem] border border-border bg-card/95 p-4 sombra-tag backdrop-blur animate-in fade-in slide-in-from-top-2 duration-200 [-webkit-overflow-scrolling:touch] lg:hidden"
          >
            <div>
              <p className="texto-marker mb-2 px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("navSecciones")}
              </p>
              <nav aria-label={t("navSecciones")} className="grid grid-cols-2 gap-1.5">
                {VISTAS.map(({ id, clave }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => irA(id)}
                    aria-current={vista === id ? "page" : undefined}
                    className={`texto-tag flex min-h-9 items-center justify-between gap-2 rounded-full border px-3 text-[0.72rem] transition-colors ${
                      vista === id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/60 bg-background/45 text-muted-foreground hover:bg-background hover:text-foreground"
                    }`}
                  >
                    {t(clave)}
                    <ChevronRight aria-hidden className="h-3 w-3 opacity-50" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={abrirComentarios}
                  className="texto-tag flex min-h-9 items-center justify-between gap-2 rounded-full border border-border/60 bg-background/45 px-3 text-[0.72rem] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <MessageCircle aria-hidden className="h-3 w-3" />
                    {t("comentariosTitulo")}
                  </span>
                  <ChevronRight aria-hidden className="h-3 w-3 opacity-50" />
                </button>
                <button
                  type="button"
                  onClick={abrirCuenta}
                  className="texto-tag flex min-h-9 items-center justify-between gap-2 rounded-full border border-border/60 bg-background/45 px-3 text-[0.72rem] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <User aria-hidden className="h-3 w-3" />
                    {t("cuentaTitulo")}
                  </span>
                  <ChevronRight aria-hidden className="h-3 w-3 opacity-50" />
                </button>
              </nav>
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs font-medium text-muted-foreground">{t("currencyTitle")}</span>
              <CurrencySelector />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-background/60 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-card hover:text-foreground active:scale-95"
              >
                {theme === "dark" ? <Sun aria-hidden className="h-3.5 w-3.5" /> : <Moon aria-hidden className="h-3.5 w-3.5" />}
                {theme === "dark" ? "Light" : "Dark"}
              </button>
              <button
                type="button"
                onClick={switchLang}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-background/60 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:bg-card hover:text-foreground active:scale-95"
              >
                <Globe aria-hidden className="h-3 w-3" />
                {t("langSwitch")}
              </button>
            </div>
          </div>
        )}
      </div>

      <PistasCabecera />
    </header>
  );
}
