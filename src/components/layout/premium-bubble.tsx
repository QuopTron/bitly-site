import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronDown, Gem, MessageCircle, X } from "lucide-react";
import { getLanguage, useI18n } from "@/lib/i18n";
import { format, useCurrency } from "@/lib/currency";
import { getFaseActual } from "@/lib/pricing";
import { INSTAGRAM_URL, TIKTOK_URL, enlaceWhatsApp } from "@/lib/contacto";
import TikTokIcon from "@/components/ui/tiktok-icon";

/** Lo que más pesa al decidir, sacado de la comparativa de planes. */
const BENEFICIOS = ["premiumCompare2", "premiumCompare3", "premiumCompare6"];

/** Cuánto late el puntito de "sin leer" antes de quedarse quieto. */
const LATIDO_MS = 6000;

/**
 * Burbuja flotante que acompaña al visitante en todo el sitio.
 *
 * Muestra el precio vigente (se actualiza solo con la fase de `pricing.ts` y
 * con la moneda elegida) y lleva el contacto directo de WhatsApp/Instagram/TikTok.
 */
export default function PremiumBubble() {
  const t = useI18n();
  const [moneda] = useCurrency();
  const [abierto, setAbierto] = useState(false);
  const [visto, setVisto] = useState(false);
  const [latido, setLatido] = useState(true);
  const raiz = useRef<HTMLDivElement>(null);

  // El puntito late un rato y después se queda quieto: un latido infinito deja
  // un cuadro animándose para siempre, y en gama baja eso se paga en batería.
  useEffect(() => {
    const reloj = window.setTimeout(() => setLatido(false), LATIDO_MS);
    return () => window.clearTimeout(reloj);
  }, []);

  // Cerrar con Escape o tocando afuera.
  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: MouseEvent | TouchEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alTocar);
    document.addEventListener("touchstart", alTocar);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alTocar);
      document.removeEventListener("touchstart", alTocar);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  const fase = getFaseActual();
  const lang = getLanguage();
  // Sin cotización a mano, `format` cae solo a bolivianos: nunca un número de
  // Bs con símbolo de dólar.
  const precio = format(fase.precio, moneda);
  const precioAntes = fase.enOferta ? format(fase.original, moneda) : null;
  const whatsapp = enlaceWhatsApp(t("bubbleWaText").replace("{precio}", precio));

  const alternar = () => {
    setAbierto((v) => !v);
    setVisto(true);
  };

  const irAPlanes = () => {
    setAbierto(false);
    document.getElementById("planes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      ref={raiz}
      className="fixed bottom-4 right-3 z-40 flex flex-col items-end gap-2 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:bottom-6 sm:right-6"
    >
      {abierto && (
        <div
          id="bitly-premium-burbuja"
          role="dialog"
          aria-label={t("bubbleAria")}
          className="w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-primary/25 bg-card/95 shadow-2xl shadow-primary/10 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          {/* Encabezado personal */}
          <div className="flex items-start justify-between gap-2 border-b border-border/50 bg-gradient-to-br from-primary/15 via-transparent to-transparent p-3.5 sm:p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 ring-1 ring-primary/30">
                <Gem className="h-4 w-4 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">{t("navPremium")}</p>
                <p className="text-xs leading-tight text-muted-foreground">{t("bubblePersonal")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label={t("installClose")}
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card/80 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Precio vigente (cambia solo con la moneda y con la fase de oferta) */}
          <div className="px-3.5 pt-3.5 sm:px-4">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-0.5">
              <span className="text-3xl font-bold leading-none text-foreground">{precio}</span>
              {precioAntes && (
                <span className="pb-0.5 text-sm text-muted-foreground line-through">{precioAntes}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/25">
                <Check className="h-3 w-3" />
                {t("plansPremiumPrice")}
              </span>
              {fase.enOferta && (
                <span className="rounded-full bg-gradient-to-r from-[#15803D] to-[#0E7A46] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                  {lang === "es" ? fase.etiqueta : fase.etiquetaEn}
                </span>
              )}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{t("bubbleLead")}</p>
          </div>

          {/* Lo esencial */}
          <ul className="space-y-2 px-3.5 pt-3 sm:px-4">
            {BENEFICIOS.map((clave) => (
              <li key={clave} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <Check className="h-2.5 w-2.5 text-primary" />
                </span>
                {t(clave)}
              </li>
            ))}
          </ul>

          {/* Contacto */}
          <div className="space-y-2 p-3.5 sm:p-4">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#15803D] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#15803D]/30 transition hover:bg-[#0E7A46] hover:scale-[1.02] hover:shadow-xl hover:shadow-[#15803D]/40 active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4" />
              {t("bubbleCta")}
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition hover:border-[#833AB4]/40 hover:text-foreground"
            >
              <Camera className="h-3.5 w-3.5" />
              {t("bubbleIgLabel")}
            </a>
            <a
              href={TIKTOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition hover:border-foreground/50 hover:text-foreground"
            >
              <TikTokIcon className="h-3.5 w-3.5" />
              {t("bubbleTiktokLabel")}
            </a>
            <button
              type="button"
              onClick={irAPlanes}
              className="group flex w-full items-center justify-center gap-1.5 pt-0.5 text-xs font-medium text-primary transition hover:gap-2.5"
            >
              {t("bubbleSeePlans")}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Burbuja colapsada: siempre a la vista */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierto}
        aria-controls="bitly-premium-burbuja"
        className="group relative flex items-center gap-2 rounded-full border border-primary/30 bg-card/90 py-1.5 pl-1.5 pr-2.5 shadow-2xl shadow-primary/15 backdrop-blur-xl transition hover:scale-[1.03] hover:border-primary/50 active:scale-[0.97] sm:gap-2.5 sm:py-2 sm:pl-2 sm:pr-3.5"
      >
        {!visto && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            {latido && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
            )}
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary ring-2 ring-card" />
          </span>
        )}
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 ring-1 ring-primary/30 sm:h-9 sm:w-9">
          <Gem className="h-4 w-4 text-primary" />
        </span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold text-muted-foreground sm:text-xs">
            {t("navPremium")}
          </span>
          <span className="block text-sm font-bold text-foreground sm:text-base">{precio}</span>
        </span>
        {/* El nombre accesible lo arma el propio contenido del botón: un
            `aria-label` que no contuviera el texto visible tal cual hacía
            fallar "label in name". El detalle va en un `sr-only`, que sí entra
            en el nombre y no se ve. */}
        <span className="sr-only">— {t("bubbleAria")}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${abierto ? "rotate-180" : "group-hover:translate-y-0.5"}`}
        />
      </button>
    </div>
  );
}
