import { Monitor, Smartphone, Apple, Tv, Lock, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { retraso } from "@/lib/reveal";

export type Plataforma = "windows" | "android" | "tv" | "ios" | "macos";

type Props = {
  isBlocked: boolean;
  windowsUrl: string | null;
  androidUrl: string | null;
  iosUrl: string | null;
  macosUrl: string | null;
  onDownload: (plataforma: Plataforma, url: string | null) => void;
};

type Item = { id: Plataforma; icono: LucideIcon; clave: string };

const SECUNDARIAS: Item[] = [
  { id: "windows", icono: Monitor, clave: "heroWindows" },
  { id: "tv", icono: Tv, clave: "heroTv" },
  { id: "ios", icono: Apple, clave: "heroIos" },
  { id: "macos", icono: Apple, clave: "heroMacos" },
];

const TARJETA =
  "group flex min-h-12 w-full items-center gap-2.5 rounded-full border border-border bg-card/55 px-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-menta/60 hover:bg-card active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";

const ICONO =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground transition-colors group-hover:bg-menta-suave group-hover:text-foreground";

function Etiqueta({ icono: Icono, sobre, nombre, bloqueado }: { icono: LucideIcon; sobre: string; nombre: string; bloqueado?: boolean }) {
  return (
    <>
      <span className={`${ICONO} relative`}>
        <Icono className="h-4 w-4" aria-hidden />
        {bloqueado && <Lock className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">{sobre}</span>
        <span className="mt-1 block truncate text-sm font-semibold leading-none">{nombre}</span>
      </span>
    </>
  );
}

export default function HeroDescargas({ isBlocked, windowsUrl, androidUrl, iosUrl, macosUrl, onDownload }: Props) {
  const t = useI18n();
  const urls: Record<Plataforma, string | null> = {
    windows: windowsUrl,
    android: androidUrl,
    tv: androidUrl,
    ios: iosUrl,
    macos: macosUrl,
  };

  return (
    <div
      id="descargar"
      data-reveal
      suppressHydrationWarning
      style={retraso(220)}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5"
    >
      <button
        type="button"
        disabled={isBlocked}
        onClick={() => onDownload("android", androidUrl)}
        className="boton-spray group col-span-2 min-h-12 gap-2.5 px-3 py-2 text-left 2xl:col-span-1"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20">
          <Smartphone className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[9px] uppercase leading-none tracking-[0.14em] opacity-80">{t("heroDescargarApk")}</span>
          <span className="mt-1 block text-sm font-semibold leading-none">{t("heroAndroid")}</span>
        </span>
      </button>

      {SECUNDARIAS.map(({ id, icono, clave }) => (
        <button
          key={id}
          type="button"
          disabled={isBlocked}
          onClick={() => onDownload(id, urls[id])}
          className={TARJETA}
        >
          <Etiqueta icono={icono} sobre={t("heroDescargarPara")} nombre={t(clave)} bloqueado={isBlocked} />
        </button>
      ))}
    </div>
  );
}
