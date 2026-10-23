import { Camera } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { INSTAGRAM, INSTAGRAM_URL, TIKTOK, TIKTOK_URL } from "@/lib/contacto";
import TikTokIcon from "@/components/ui/tiktok-icon";

/** Contacto directo, arriba del formulario de comentarios. */
export default function ContactoPanel() {
  const t = useI18n();

  return (
    <div>
      <p className="mb-2 text-center text-xs font-semibold text-muted-foreground">{t("footerRedes")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="boton-spray min-h-10 flex-1 gap-2 px-5 text-sm"
        >
          <Camera className="h-4 w-4" aria-hidden />
          {t("footerIg")}
        </a>
        <a
          href={TIKTOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="boton-fantasma min-h-10 flex-1 gap-2 px-5 text-sm text-muted-foreground hover:text-foreground"
        >
          <TikTokIcon className="h-4 w-4" />
          {t("footerTiktok")}
        </a>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        <span className="texto-marker text-foreground/80">@{INSTAGRAM}</span>
        <span aria-hidden className="mx-2 text-muted-foreground/50">·</span>
        <span className="texto-marker text-foreground/80">@{TIKTOK}</span>
      </p>
    </div>
  );
}
