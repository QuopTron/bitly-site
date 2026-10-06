import { ArrowUp, Camera, MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { INSTAGRAM, INSTAGRAM_URL, TIKTOK, TIKTOK_URL, WHATSAPP, enlaceWhatsApp } from "@/lib/contacto";
import TikTokIcon from "@/components/ui/tiktok-icon";

/**
 * Pie de página.
 *
 * Tenía sólo el aviso legal y el copyright: ni redes ni contacto. Ahora lleva la
 * tarjeta de contacto con ancla propia (`#contacto`), así también es una sección
 * a la que se puede saltar desde la barra, y un "volver arriba" que aprovecha el
 * `#inicio` del encabezado.
 *
 * Los enlaces de afuera van con `rel="noopener noreferrer"`, igual que el resto
 * del sitio.
 */
export default function Footer() {
  const t = useI18n();
  const whatsapp = enlaceWhatsApp(t("footerWaText"));

  return (
    <footer id="contacto" className="container mx-auto px-4 pb-28 pt-10 text-center sm:px-6 sm:pb-20">
      <div className="mx-auto max-w-md rounded-3xl border border-primary/20 bg-gradient-to-b from-card/50 to-card/20 p-5 sm:p-6">
        <h2 className="text-sm font-bold sm:text-base">{t("footerRedes")}</h2>
        <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">{t("footerRedesDesc")}</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#15803D] px-4 text-sm font-bold text-white shadow-lg shadow-[#15803D]/30 transition hover:bg-[#0E7A46] hover:scale-[1.02] active:scale-[0.98]"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            {t("footerWa")}
          </a>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 text-sm font-semibold text-muted-foreground transition hover:border-[#833AB4]/50 hover:text-foreground active:scale-[0.98]"
          >
            <Camera className="h-4 w-4" aria-hidden />
            {t("footerIg")}
          </a>
          <a
            href={TIKTOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 text-sm font-semibold text-muted-foreground transition hover:border-foreground/50 hover:text-foreground active:scale-[0.98]"
          >
            <TikTokIcon className="h-4 w-4" />
            {t("footerTiktok")}
          </a>
        </div>

        {/* Los datos van en la sección que la barra llama «Contacto»: el número
            se puede tocar para llamar y el usuario queda a la vista. Antes el
            número también estaba escrito dentro del botón de Planes, que ya
            lleva a este mismo chat: quedaba repetido. */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80">
          <a
            href={`tel:${WHATSAPP}`}
            className="rounded px-1 font-semibold tabular-nums outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
          >
            {WHATSAPP}
          </a>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="px-1">@{INSTAGRAM}</span>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="px-1">@{TIKTOK}</span>
        </div>
      </div>

      <p className="mt-8 text-[10px] text-muted-foreground sm:text-xs">{t("footerDisclaimer")}</p>
      <p className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
        {t("footerCopyright").replace("{name}", "Bitly")}
      </p>

      <a
        href="#inicio"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        {t("footerVolverArriba")}
      </a>
    </footer>
  );
}
