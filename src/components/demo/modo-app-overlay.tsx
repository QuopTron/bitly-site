"use client";

import { useState } from "react";
import { Check, Gem, Lock, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Overlay que tapa el reproductor cuando el sitio está corriendo como app
 * instalada (PWA standalone). Ahí `bloquearDescarga()` apaga el clic derecho,
 * el arrastre y los atajos que guardan el audio, así que la demo no tiene
 * sentido a medias: se oculta y se invita a abrirla en el navegador.
 *
 * No es un candado — el audio se sirve cifrado — pero dentro de la app
 * instalada no hay barra de direcciones ni "Guardar como" a un clic.
 */
export default function ModoAppOverlay() {
  const t = useI18n();
  const [copiado, setCopiado] = useState(false);
  const [compartido, setCompartido] = useState(false);

  const url = () => (typeof window === "undefined" ? "/" : `${window.location.origin}/`);

  const abrirEnNavegador = async () => {
    // En iOS la PWA puede compartir el enlace para abrirlo en Safari; en
    // Android no hay equivalente, así que se copia al portapapeles.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Bitly", url: url() });
        setCompartido(true);
        setTimeout(() => setCompartido(false), 2500);
        return;
      } catch {
        /* el usuario canceló: seguimos con el portapapeles */
      }
    }
    try {
      await navigator.clipboard.writeText(url());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* sin permiso de portapapeles: el enlace queda a la vista del usuario */
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background/92 px-4 text-center backdrop-blur-md">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
        <Lock className="h-5 w-5" aria-hidden />
      </span>

      <h3 className="text-sm font-bold leading-tight sm:text-base">{t("pwaBloqueadoTitulo")}</h3>
      <p className="max-w-[18rem] text-[0.7rem] leading-relaxed text-muted-foreground sm:text-xs">{t("pwaBloqueadoDesc")}</p>

      <button
        type="button"
        onClick={() => void abrirEnNavegador()}
        className="mt-1 flex w-full max-w-[16rem] items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 transition hover:opacity-90 active:scale-[0.98]"
      >
        {copiado || compartido ? <Check className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
        {copiado || compartido ? t("pwaLinkCopiado") : t("pwaAbrirNavegador")}
      </button>

      <a
        href="#planes"
        className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-[0.7rem] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground sm:text-xs"
      >
        <Gem className="h-3 w-3" aria-hidden />
        {t("pwaVerPlanes")}
      </a>
    </div>
  );
}
