import { useEffect, useState } from "react";
import { Apple, Download, Globe, Laptop, MessageCircle, Monitor, Smartphone, Tv, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n";

import { retraso } from "@/lib/reveal";
import { navegarA } from "@/lib/navegacion";
import SectionHeader from "@/components/ui/section-header";
import { GuiaCelular, GuiaIOS, GuiaMac, GuiaPC, GuiaTV } from "./guides";

export type Plataforma = "phone" | "pc" | "tv" | "ios" | "mac";

const EVENTO = "bitly:abrir-guia";

/** Abre una pestaña de la guía desde cualquier parte del sitio (por ejemplo, el modal de descarga). */
export function abrirGuia(plataforma: Plataforma) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: plataforma }));
  navegarA("instalar");
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
    <section
      id="instalar"
      className="instalar-seccion relative isolate container mx-auto scroll-mt-6 px-4 pb-4 pt-6 sm:px-6 sm:pb-5 sm:pt-8"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,var(--menta-suave),transparent_70%)] opacity-70"
      />

      <SectionHeader
        compacto
        className="instalar-cabecera"
        icono={Wrench}
        badge={t("installSectionBadge")}
        titulo={t("installSectionTitle")}
        descripcion={t("installSectionDesc")}
      />

      <div
        role="tablist"
        aria-label={t("installSectionBadge")}
        data-reveal
        suppressHydrationWarning
        style={retraso(80)}
        className="relative mx-auto mb-4 grid w-full max-w-3xl grid-cols-2 gap-1 rounded-[1.75rem] border border-border/70 bg-card/35 p-1.5 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:flex sm:w-fit sm:max-w-full sm:flex-wrap sm:justify-center"
      >
        {PESTANAS.map(({ id, clave, Icono }) => {
          const seleccionada = activa === id;
          return (
            <button
              key={id}
              id={`pestana-${id}`}
              role="tab"
              aria-controls="pestana-panel"
              aria-selected={seleccionada}
              onClick={() => setActiva(id)}
              className={`texto-tag group flex shrink-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs transition-all duration-200 active:scale-[0.97] sm:justify-start sm:px-3.5 sm:text-sm ${
                id === "mac" ? "col-span-2 sm:col-span-1" : ""
              } ${
                seleccionada
                  ? "border-primary/35 bg-primary/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-background/60 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  seleccionada
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <Icono className="h-3.5 w-3.5" aria-hidden />
              </span>
              {t(clave)}
            </button>
          );
        })}
      </div>

      <div
        data-reveal
        suppressHydrationWarning
        style={retraso(120)}
        className="instalar-acciones mb-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center"
      >
        {onDownload && (
          <button
            type="button"
            onClick={() => onDownload(DESCARGA[activa].plataforma)}
            className="boton-spray group px-6 py-2.5 text-sm sm:text-base"
          >
            <Download className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 sm:h-5 sm:w-5" aria-hidden />
            {t(DESCARGA[activa].clave)}
          </button>
        )}

        {/* La app de verdad, sin instalar nada: el bundle de Flutter servido en
            /app (ver scripts/copiar-app-web.mjs). Es OTRA PWA que la del sitio:
            la del sitio es esta web, la de /app es Bitly. */}
        <a
          href="/app/"
          className="boton-fantasma px-5 py-3 text-center text-xs text-muted-foreground hover:text-foreground sm:text-sm"
        >
          <Globe className="h-4 w-4 text-primary" aria-hidden />
          {t("installWebApp")}
        </a>

        <a
          href="#contacto"
          className="boton-fantasma px-5 py-3 text-center text-xs text-muted-foreground hover:text-foreground sm:text-sm"
        >
          <MessageCircle className="h-4 w-4 text-primary" aria-hidden />
          {t("installHelp")}
        </a>
      </div>

      <div
        data-reveal
        suppressHydrationWarning
        style={retraso(160)}
        className="relative mx-auto max-w-6xl"
      >
        <div
          id="pestana-panel"
          data-tab={activa}
          key={activa}
          role="tabpanel"
          aria-labelledby={`pestana-${activa}`}
          className="animate-in fade-in rounded-[1.8rem_2.8rem_2rem_2.6rem] border border-border/60 bg-card/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[2px] duration-300 sm:p-4"
        >
          {activa === "phone" && <GuiaCelular conCapturas />}
          {activa === "pc" && <GuiaPC conCapturas />}
          {activa === "tv" && <GuiaTV conCapturas />}
          {activa === "ios" && <GuiaIOS conCapturas />}
          {activa === "mac" && <GuiaMac conCapturas />}
        </div>
      </div>
    </section>
  );
}
