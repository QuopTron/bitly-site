import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { verificarCodigo } from "@/server/analytics";
import ModalWrapper from "@/components/ui/modal-wrapper";

type Props = {
  open: boolean;
  onClose: () => void;
  onOk: (codigo: string) => void;
};

export default function CodigoModal({ open, onClose, onOk }: Props) {
  const t = useI18n();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(false);
    try {
      if (await verificarCodigo({ data: { codigo } })) {
        setCodigo("");
        onOk(codigo.trim());
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("adminAccesoTitulo")}
      subtitle={t("adminAccesoDesc")}
      icon={<Lock className="h-6 w-6 text-primary" />}
    >
      <form onSubmit={enviar} className="space-y-3">
        <label htmlFor="codigo-admin" className="sr-only">
          {t("adminCodigo")}
        </label>
        <input
          id="codigo-admin"
          type="password"
          value={codigo}
          onChange={(e) => {
            setCodigo(e.target.value);
            setError(false);
          }}
          autoComplete="off"
          placeholder={t("adminCodigo")}
          className="min-h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {error && <p className="text-xs text-destructive">{t("adminCodigoMal")}</p>}
        <button type="submit" disabled={!codigo.trim() || enviando} className="boton-spray min-h-11 w-full justify-center gap-2 text-sm disabled:opacity-40">
          {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t("adminEntrar")}
        </button>
      </form>
    </ModalWrapper>
  );
}
