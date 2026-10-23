import { useEffect, useState } from "react";
import { Check, Loader2, MessageCircle, MessageSquare, PenLine, Send, Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { publicarOpinion } from "@/server/opiniones";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { con } from "@/components/comentarios/carrusel-opiniones";
import ContactoPanel from "@/components/comentarios/contacto-panel";

const NOTAS = [1, 2, 3, 4, 5];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ComentariosModal({ open, onClose }: Props) {
  const t = useI18n();
  const [form, setForm] = useState(false);
  const [estrellas, setEstrellas] = useState(0);
  const [nombre, setNombre] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(false);
    setAviso(null);
  }, [open]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await publicarOpinion({ data: { nombre, estrellas, texto } });
      if (!r.ok) {
        const motivo = r.motivo === "datos" ? "opinionesErrorDatos" : r.motivo === "limite" ? "opinionesErrorLimite" : "opinionesErrorServidor";
        setAviso({ ok: false, texto: t(motivo) });
        return;
      }
      setNombre("");
      setTexto("");
      setEstrellas(0);
      setAviso({ ok: true, texto: t("opinionesGracias") });
      window.dispatchEvent(new Event("bitly:opinion-publicada"));
    } catch {
      setAviso({ ok: false, texto: t("opinionesErrorServidor") });
    } finally {
      setEnviando(false);
    }
  };

  const listo = estrellas > 0 && texto.trim().length >= 2 && nombre.trim().length >= 2;

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("comentariosTitulo")}
      subtitle={t("comentariosDesc")}
      icon={<MessageCircle className="h-6 w-6 text-primary" />}
      ancho="amplio"
    >
      <ContactoPanel />

      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="texto-tag flex items-center gap-2 text-xl leading-none">
              <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
              {t("comentariosEnSitio")}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("comentariosEnSitioDesc")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
              setForm((v) => !v);
            }}
            aria-expanded={form}
            className="boton-spray w-full shrink-0 gap-1.5 px-4 py-2.5 text-xs sm:w-auto"
          >
            <PenLine className="h-3.5 w-3.5" aria-hidden />
            {t("opinionesFormTitulo")}
          </button>
        </div>

        {form && (
          <form onSubmit={enviar} className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{t("opinionesEstrellas")}</span>
              <span className="flex items-center gap-0.5">
                {NOTAS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setEstrellas(n)}
                    aria-label={con(t("opinionesEstrella"), { n })}
                    className="rounded p-0.5"
                  >
                    <Star className={`h-5 w-5 ${n <= estrellas ? "fill-primary text-primary" : "text-muted-foreground/50"}`} />
                  </button>
                ))}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={t("opinionesNombrePlaceholder")}
                maxLength={24}
                className="min-h-9 rounded-lg border border-border bg-card px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={t("opinionesTextoPlaceholder")}
                maxLength={400}
                className="min-h-9 rounded-lg border border-border bg-card px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className={`text-[10px] ${aviso ? (aviso.ok ? "text-primary" : "text-destructive") : "text-muted-foreground"}`}>
                {aviso?.texto ?? (listo ? "" : t("opinionesFalta"))}
              </p>
              <button type="submit" disabled={!listo || enviando} className="boton-spray shrink-0 gap-1.5 px-4 py-2 text-xs disabled:opacity-40">
                {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : aviso?.ok ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                {t("opinionesEnviar")}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalWrapper>
  );
}
