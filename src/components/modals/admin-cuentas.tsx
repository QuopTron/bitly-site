import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Bot,
  CheckCircle2,
  CircleDot,
  Eye,
  Gem,
  Gift,
  RefreshCw,
  Search,
  ShieldOff,
  Smartphone,
  Trash2,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminCuentas, type CuentaAdmin, type ResumenCuentas } from "@/server/cuentas";
import { regalarPremium } from "@/server/asignaciones";
import { buscarEnPanel, type ResultadoBusquedaPanel } from "@/server/panel";

/** Estado del código → color y clave de traducción. */
const ESTADOS: Record<string, { clave: string; clase: string }> = {
  activo: { clave: "adminCodigoActivo", clase: "border-primary/40 bg-primary/10 text-primary" },
  usado: { clave: "adminCodigoUsado", clase: "border-border bg-background/60 text-muted-foreground" },
  cancelado: { clave: "adminCodigoCancelado", clase: "border-destructive/40 bg-destructive/10 text-destructive" },
  liberado: { clave: "adminCodigoLiberado", clase: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  no_encontrado: { clave: "adminCodigoNoEncontrado", clase: "border-border bg-background/60 text-muted-foreground" },
  desconocido: { clave: "adminCodigoDesconocido", clase: "border-border bg-background/60 text-muted-foreground" },
};

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

/** Motivo del servidor → clave de traducción. */
const MOTIVOS_REGALO: Record<string, string> = {
  ya_premium: "adminUsuariosRegaloYa",
  sin_codigos: "adminUsuariosRegaloSinCodigos",
  sin_cuenta: "adminUsuariosRegaloSinCuenta",
};

export default function AdminCuentas({ codigo }: { codigo: string }) {
  const t = useI18n();
  const [cuentas, setCuentas] = useState<CuentaAdmin[]>([]);
  const [resumen, setResumen] = useState<ResumenCuentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [regalando, setRegalando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string; codigo?: string } | null>(null);
  const [consulta, setConsulta] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [hallado, setHallado] = useState<Extract<ResultadoBusquedaPanel, { ok: true }> | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState("");

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

  const verificar = async (e: FormEvent) => {
    e.preventDefault();
    const texto = consulta.trim();
    if (texto.length < 2 || buscando) return;
    setBuscando(true);
    setErrorBusqueda("");
    try {
      const r = await buscarEnPanel({ data: { admin: codigo, consulta: texto } });
      if (r.ok) setHallado(r);
      else {
        setHallado(null);
        setErrorBusqueda(t(r.motivo === "datos" ? "adminBuscarCorto" : "adminBuscarError"));
      }
    } catch {
      setHallado(null);
      setErrorBusqueda(t("adminBuscarError"));
    } finally {
      setBuscando(false);
    }
  };

  const regalar = async (correo: string) => {
    if (regalando) return;
    setRegalando(correo);
    setAviso(null);
    try {
      const r = await regalarPremium({ data: { admin: codigo, correo } });
      if (r.ok) {
        setAviso({ tipo: "ok", texto: `${t("adminUsuariosRegalado")} @${r.usuario}`, codigo: r.codigo });
        // Refresco inmediato: el badge Premium y el resumen tienen que cambiar
        // en la misma pasada, sin recargar el panel.
        await cargar();
      } else {
        setAviso({ tipo: "error", texto: t(MOTIVOS_REGALO[r.motivo] ?? "adminUsuariosRegaloError") });
      }
    } catch {
      setAviso({ tipo: "error", texto: t("adminUsuariosRegaloError") });
    } finally {
      setRegalando(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
          <CircleDot
            className={`h-3 w-3 ${(resumen?.enLinea ?? 0) > 0 ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden
          />
          {t("adminUsuariosOnline")}: <strong className="text-foreground">{resumen?.enLinea ?? 0}</strong>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
          <Eye className="h-3 w-3" aria-hidden />
          {t("adminUsuariosAnonimos")}: <strong className="text-foreground">{resumen?.anonimos ?? 0}</strong>
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-8">
          <Tarjeta valor={resumen.total} etiqueta={t("adminUsuariosTotal")} />
          <Tarjeta valor={resumen.enLinea} etiqueta={t("adminUsuariosOnline")} />
          <Tarjeta valor={resumen.anonimos} etiqueta={t("adminUsuariosAnonimos")} />
          <Tarjeta valor={resumen.premium} etiqueta={t("adminUsuariosPremium")} />
          <Tarjeta valor={resumen.invitadas} etiqueta={t("adminUsuariosInvitadas")} />
          <Tarjeta valor={resumen.deLaApp} etiqueta={t("adminUsuariosDeLaApp")} />
          <Tarjeta valor={resumen.porConfirmar} etiqueta={t("adminUsuariosPorConfirmar")} />
          <Tarjeta valor={resumen.eliminadas} etiqueta={t("adminUsuariosEliminadas")} />
        </div>
      )}

      <form onSubmit={verificar} className="rounded-2xl border border-border/70 bg-background/40 p-3">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("adminBuscarTitulo")}
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span className="relative flex min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <input
                type="search"
                name="consulta"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder={t("adminBuscarAyuda")}
                autoComplete="off"
                spellCheck={false}
                className="min-h-10 w-full rounded-xl border border-border bg-background/70 pl-8 pr-3 text-[12px] text-foreground outline-none transition-colors focus-visible:border-primary"
              />
            </span>
            <button
              type="submit"
              disabled={buscando || consulta.trim().length < 2}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${buscando ? "animate-spin" : "hidden"}`} aria-hidden />
              {t("adminBuscarBoton")}
            </button>
          </span>
        </label>
        <p className="mt-1.5 text-[10px] text-muted-foreground">{t("adminBuscarPista")}</p>

        {errorBusqueda && (
          <p role="alert" className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {errorBusqueda}
          </p>
        )}

        {hallado && (
          <div className="mt-3 space-y-2" role="status">
            <p
              className={`flex items-start gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-medium ${
                hallado.cuentas.length > 0
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : hallado.pedidos.length > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                    : "border-border bg-background/50 text-muted-foreground"
              }`}
            >
              {hallado.cuentas.length > 0 ? (
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 break-words">
                {hallado.cuentas.length > 0
                  ? `${t("adminBuscarExiste")} · ${hallado.totalCuentas} ${t("adminBuscarCuentas")}`
                  : hallado.pedidos.length > 0
                    ? t("adminBuscarSoloPedido")
                    : `${t("adminBuscarNoExiste")} «${hallado.consulta}»`}
              </span>
            </p>

            {hallado.cuentas.length > 0 && (
              <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border bg-background/50">
                {hallado.cuentas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-[11px]">
                    <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="max-w-[45%] truncate font-semibold text-foreground">@{c.usuario}</span>
                    <span className="max-w-[40%] truncate text-muted-foreground">{c.correo}</span>
                    {c.premium && (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        <Gem className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosPremium")}
                      </span>
                    )}
                    {c.invitada && (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                        {t("adminUsuariosInvitada")}
                      </span>
                    )}
                    {!c.correoConfirmado && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-500">
                        {t("adminUsuariosPorConfirmar")}
                      </span>
                    )}
                    {c.baneada && (
                      <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
                        {t("adminUsuariosBaneada")}
                      </span>
                    )}
                    {c.eliminada && (
                      <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
                        {t("adminUsuariosEliminada")}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {c.creado ? `${t("adminBuscarDesde")} ${hace(c.creado, false)}` : ""}
                    </span>
                    {c.codigo && (
                      <code className="w-full break-all rounded-lg bg-background/60 px-2 py-1 text-[9px] text-muted-foreground">
                        {c.codigo}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {hallado.codigos.length > 0 && (
              <ul className="space-y-1.5">
                {hallado.codigos.map((c) => {
                  const tono = ESTADOS[c.estado] ?? ESTADOS.desconocido;
                  return (
                    <li key={c.codigo} className="rounded-xl border border-border bg-background/50 px-3 py-2 text-[10px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tono.clase}`}>
                          {t(tono.clave)}
                        </span>
                        {c.origen && (
                          <span className="text-[9px] text-muted-foreground">
                            {c.origen === "sitio" ? t("adminCodigoOrigenSitio") : t("adminCodigoOrigenRegistro")}
                          </span>
                        )}
                        {c.usuario && (
                          <span className="text-[9px] text-muted-foreground">
                            {t("adminCodigoDueno")}: <strong className="text-foreground">@{c.usuario}</strong>
                          </span>
                        )}
                        {c.pedido && (
                          <span className="text-[9px] text-muted-foreground">
                            {t("adminCodigoPedido")}: <strong className="text-foreground">{c.pedido}</strong>
                          </span>
                        )}
                      </div>
                      <code className="mt-1 block break-all text-[9px] text-muted-foreground">{c.codigo}</code>
                    </li>
                  );
                })}
              </ul>
            )}

            {hallado.pedidos.length > 0 && (
              <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border bg-background/50">
                {hallado.pedidos.map((p) => (
                  <li key={p.folio} className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-[11px]">
                    <span className="font-semibold text-foreground">{p.folio}</span>
                    <span className="max-w-[40%] truncate text-muted-foreground">{p.nombre || p.correo}</span>
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] capitalize text-muted-foreground">
                      {p.estado || "—"}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {p.cantidad} · Bs {p.total}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      {aviso && (
        <p
          role="status"
          className={`rounded-xl border px-3 py-2 text-[11px] ${
            aviso.tipo === "ok"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {aviso.texto}
          {aviso.codigo && (
            <code className="ml-1 break-all text-[10px] text-foreground/70">{aviso.codigo}</code>
          )}
        </p>
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
                {c.origen === "app" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[9px] text-primary">
                    <Smartphone className="h-2.5 w-2.5" aria-hidden /> {t("adminUsuariosApp")}
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

                {!c.premium && !c.eliminada && !c.baneada && (
                  <button
                    type="button"
                    onClick={() => void regalar(c.correo)}
                    disabled={regalando !== null}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    <Gift
                      className={`h-2.5 w-2.5 ${regalando === c.correo ? "animate-pulse" : ""}`}
                      aria-hidden
                    />
                    {t("adminUsuariosRegalar")}
                  </button>
                )}

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
