import { useCallback, useEffect, useState } from "react";
import { Bot, CircleDot, Gem, RefreshCw, ShieldOff, Trash2, UserRound, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminCuentas, type CuentaAdmin, type ResumenCuentas } from "@/server/cuentas";

/** Hace cuánto fue la última señal, en corto. */
function hace(iso: string, es: boolean): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return es ? "ahora" : "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

function Tarjeta({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="texto-tag text-xl leading-none tabular-nums">{valor}</p>
      <p className="text-[10px] text-muted-foreground">{etiqueta}</p>
    </div>
  );
}

export default function AdminCuentas({ codigo }: { codigo: string }) {
  const t = useI18n();
  const [cuentas, setCuentas] = useState<CuentaAdmin[]>([]);
  const [resumen, setResumen] = useState<ResumenCuentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    if (!codigo) return;
    setCargando(true);
    setError(false);
    try {
      const r = await adminCuentas({ data: { admin: codigo } });
      if (r.ok) {
        setCuentas(r.cuentas);
        setResumen(r.resumen);
      } else setError(true);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
          <CircleDot className={`h-3 w-3 ${(resumen?.enLinea ?? 0) > 0 ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
          {t("adminUsuariosOnline")}: <strong className="text-foreground">{resumen?.enLinea ?? 0}</strong>
        </span>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
          {t("adminActualizar")}
        </button>
      </div>

      {resumen && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tarjeta valor={resumen.total} etiqueta={t("adminUsuariosTotal")} />
          <Tarjeta valor={resumen.enLinea} etiqueta={t("adminUsuariosOnline")} />
          <Tarjeta valor={resumen.premium} etiqueta={t("adminUsuariosPremium")} />
          <Tarjeta valor={resumen.invitadas} etiqueta={t("adminUsuariosInvitadas")} />
          <Tarjeta valor={resumen.porConfirmar} etiqueta={t("adminUsuariosPorConfirmar")} />
          <Tarjeta valor={resumen.eliminadas} etiqueta={t("adminUsuariosEliminadas")} />
        </div>
      )}

      {cargando && cuentas.length === 0 && (
        <p className="py-8 text-center text-xs text-muted-foreground">{t("adminCargando")}</p>
      )}
      {error && <p className="py-6 text-center text-xs text-destructive">{t("adminUsuariosError")}</p>}
      {!cargando && !error && cuentas.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-background/30 p-6 text-center text-xs text-muted-foreground">
          {t("adminUsuariosVacio")}
        </p>
      )}

      {cuentas.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("adminUsuariosLista")} ({cuentas.length})
          </p>
          <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border bg-background/40">
            {cuentas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${c.enLinea ? "bg-primary" : "bg-border"}`}
                />
                <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="max-w-[46%] truncate font-semibold text-foreground">@{c.usuario}</span>
                <span className="max-w-[40%] truncate text-muted-foreground">{c.correo}</span>

                {c.origen === "invitada" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    <Bot className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosInvitada")}
                  </span>
                )}
                {c.premium && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                    <Gem className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosPremium")}
                  </span>
                )}
                {c.debeCambiarClave && !c.eliminada && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-500">
                    {t("adminUsuariosDebeCambiar")}
                  </span>
                )}
                {!c.correoConfirmado && !c.eliminada && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-500">
                    {t("adminUsuariosPorConfirmar")}
                  </span>
                )}
                {c.baneada && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
                    <ShieldOff className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosBaneada")}
                  </span>
                )}
                {c.eliminada && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
                    <Trash2 className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosEliminada")}
                  </span>
                )}

                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {c.ultimaActividad || c.ultimoAcceso
                    ? `${t("adminUsuariosActividad")}: ${hace(c.ultimaActividad || c.ultimoAcceso, false)}`
                    : t("adminUsuariosNunca")}
                </span>

                {c.codigo && (
                  <code className="w-full break-all rounded-lg bg-background/60 px-2 py-1 text-[9px] text-muted-foreground">
                    {c.codigo}
                  </code>
                )}
                {c.codigoLiberado && (
                  <p className="w-full text-[9px] text-muted-foreground">
                    {t("adminUsuariosLiberado")}:{" "}
                    <code className="break-all">{c.codigoLiberado}</code>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {resumen && resumen.baneadas > 0 && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden /> {t("adminUsuariosBaneada")}: {resumen.baneadas}
            </p>
          )}
        </>
      )}
    </div>
  );
}
