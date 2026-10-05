import { useState } from "react";
import { Gem, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { useI18n } from "@/lib/i18n";
import { canjearCodigo } from "@/lib/premium-check";
import type { EstadoCodigo } from "@/lib/demo-cuota";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Se llama con el código ya validado contra el registro. */
  onActivado: (codigo: string) => void;
};

/**
 * Canje de código Premium contra el registro real.
 *
 * El texto de error sale del estado que devuelve el servidor, no de un
 * `switch` local: así el sitio y la app cuentan lo mismo cuando un código ya
 * fue usado o está cancelado.
 */
export default function DemoCodigoModal({ open, onClose, onActivado }: Props) {
  const t = useI18n();
  const [codigo, setCodigo] = useState("");
  const [estado, setEstado] = useState<EstadoCodigo | null>(null);
  const [aviso, setAviso] = useState<"registro" | "intentos" | null>(null);
  const [cargando, setCargando] = useState(false);

  const validar = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = codigo.trim();
    if (!limpio || cargando) return;

    setCargando(true);
    setEstado(null);
    setAviso(null);
    try {
      const r = await canjearCodigo({ data: { codigo: limpio } });
      setEstado(r.estado);
      setAviso(r.aviso ?? null);
      if (r.estado === "ok") {
        onActivado(limpio);
        setCodigo("");
        onClose();
      }
    } catch {
      setEstado("desconocido");
      setAviso("registro");
    } finally {
      setCargando(false);
    }
  };

  const texto = estado ? t(`codigoEstado_${estado}`) : null;

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("codigoTitle")}
      subtitle={t("codigoSubtitle")}
      icon={<KeyRound className="h-5 w-5 text-primary" />}
    >
      <form onSubmit={validar} className="space-y-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2.5 focus-within:border-primary/50">
          {cargando ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <input
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              setEstado(null);
              setAviso(null);
            }}
            placeholder={t("codigoPlaceholder")}
            aria-label={t("codigoPlaceholder")}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground/60"
          />
        </div>

        {texto && (
          <p
            role="status"
            className={`rounded-xl px-3 py-2.5 text-xs font-medium ${
              estado === "ok"
                ? "bg-primary/15 text-primary"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {texto}
          </p>
        )}

        {aviso === "intentos" && (
          <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
            {t("codigoDemasiados")}
          </p>
        )}
        {aviso === "registro" && (
          <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
            {t("codigoSinRegistro")}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando || !codigo.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
        >
          <Gem className="h-4 w-4" />
          {t("codigoCanjear")}
        </button>

        <p className="flex items-start gap-2 pt-1 text-[11px] leading-relaxed text-muted-foreground/70">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("codigoNota")}
        </p>
      </form>
    </ModalWrapper>
  );
}