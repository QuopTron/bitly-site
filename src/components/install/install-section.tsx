import { useEffect, useState } from "react";
import { Apple, Download, Laptop, MessageCircle, Monitor, Smartphone, Tv, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { GuiaCelular, GuiaIOS, GuiaMac, GuiaPC, GuiaTV } from "./guides";

export type Plataforma = "phone" | "pc" | "tv" | "ios" | "mac";

const EVENTO = "bitly:abrir-guia";

/** Abre una pestaña de la guía desde cualquier parte del sitio (por ejemplo, el modal de descarga). */
export function abrirGuia(plataforma: Plataforma) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: plataforma }));
  document.getElementById("instalar")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Traduce la plataforma que usa el modal de descargas a la pestaña de esta sección. */
export function plataformaDeDescarga(p: "windows" | "android" | "tv" | "ios" | "macos"): Plataforma {
  if (p === "windows") return "pc";
  if (p === "macos") return "mac";
  if (p === "tv") return "tv";
  if (p === "ios") return "ios";
  return "phone";
}

const PESTANAS: { id: Plataforma; clave: string; Icono: typeof Smartphone }[] = [
  { id: "phone", clave: "installTabPhone", Icono: Smartphone },
  { id: "pc", clave: "installTabPC", Icono: Monitor },
  { id: "tv", clave: "installTabTV", Icono: Tv },
  { id: "ios", clave: "installTabIOS", Icono: Apple },
  { id: "mac", clave: "installTabMac", Icono: Laptop },
];

/** Botón de descarga al pie de cada guía: lleva al modal con los archivos. */
const DESCARGA: Record<Plataforma, { plataforma: Descarga; clave: string }> = {
  phone: { plataforma: "android", clave: "installGetPhone" },
  pc: { plataforma: "windows", clave: "installGetPC" },
  tv: { plataforma: "tv", clave: "installGetTV" },
  ios: { plataforma: "ios", clave: "installGetIOS" },
  mac: { plataforma: "macos", clave: "installGetMac" },
};

type Descarga = "windows" | "android" | "tv" | "ios" | "macos";

export default function InstallSection({ onDownload }: { onDownload?: (p: Descarga) => void }) {
  const t = useI18n();
  const [activa, setActiva] = useState<Plataforma>("phone");

  useEffect(() => {
    const alPedirGuia = (e: Event) => {
      const destino = (e as CustomEvent<Plataforma>).detail;
      if (destino) setActiva(destino);
    };
    window.addEventListener(EVENTO, alPedirGuia);
    return () => window.removeEventListener(EVENTO, alPedirGuia);
  }, []);

  return (
    <section id="instalar" className="container mx-auto scroll-mt-6 px-4 pb-4 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-6 text-center sm:mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs">
          <Wrench className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {t("installSectionBadge")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("installSectionTitle")}
          </span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {t("installSectionDesc")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={t("installSectionBadge")}
        className="mx-auto mb-5 flex max-w-2xl snap-x gap-1.5 overflow-x-auto rounded-2xl border border-border/60 bg-card/30 p-1.5 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-center"
      >
        {PESTANAS.map(({ id, clave, Icono }) => {
          const seleccionada = activa === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={seleccionada}
              onClick={() => setActiva(id)}
              className={`flex shrink-0 snap-start items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition sm:gap-2 sm:px-4 sm:text-xs ${
                seleccionada
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
            >
              <Icono className="h-3.5 w-3.5" />
              {t(clave)}
            </button>
          );
        })}
      </div>

      <div className="mx-auto max-w-5xl rounded-3xl border border-border/50 bg-gradient-to-b from-card/50 to-card/20 p-4 backdrop-blur sm:p-6">
        <div key={activa} role="tabpanel" className="animate-in fade-in duration-300">
          {activa === "phone" && <GuiaCelular conCapturas />}
          {activa === "pc" && <GuiaPC conCapturas />}
          {activa === "tv" && <GuiaTV conCapturas />}
          {activa === "ios" && <GuiaIOS conCapturas />}
          {activa === "mac" && <GuiaMac conCapturas />}

          {onDownload && (
            <button
              type="button"
              onClick={() => onDownload(DESCARGA[activa].plataforma)}
              className="group mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-5 py-3.5 text-sm font-semibold text-background shadow-lg shadow-foreground/20 transition hover:scale-[1.01] active:scale-[0.99] sm:text-base"
            >
              <Download className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 sm:h-5 sm:w-5" />
              {t(DESCARGA[activa].clave)}
            </button>
          )}
        </div>

        <a
          href={`https://wa.me/59173427418?text=${encodeURIComponent("Hola! Necesito ayuda para instalar Bitly")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/30 px-4 py-3 text-center text-[11px] font-medium text-muted-foreground transition hover:border-[#25D366]/40 hover:bg-[#25D366]/5 hover:text-foreground sm:text-xs"
        >
          <MessageCircle className="h-4 w-4 text-[#25D366]" />
          {t("installHelp")}
        </a>
      </div>
    </section>
  );
}
