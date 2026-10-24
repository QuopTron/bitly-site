import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { asignarCodigos } from "@/server/asignaciones";
import {
  actualizarPedido,
  adminPedidos,
  eliminarPedido,
  enviarCodigoPedido,
  leerComprobante,
  probarCorreo,
  resumenCodigos,
  sincronizarCodigos,
  type EstadoPedido,
  type PedidoPublico,
  type ResumenCodigos,
} from "@/server/pedidos";

type PedidoAdmin = PedidoPublico & { comprobante: string; tipoComprobante: string };

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

const ESTADOS: EstadoPedido[] = ["pendiente", "revision", "pagado", "enviado", "cancelado"];

const COLOR: Record<EstadoPedido, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  revision: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

function base64ABlob(base64: string, tipo: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

function FilaPedido({
  pedido,
  codigoAdmin,
  codigosActivos,
  onCambio,
  onEliminar,
}: {
  pedido: PedidoAdmin;
  codigoAdmin: string;
  codigosActivos: string[];
  onCambio: (p: PedidoAdmin) => void;
  onEliminar: () => void;
}) {
  const t = useI18n();
  const [abierto, setAbierto] = useState(false);
  /** Comprobante ya cargado: se muestra inline y se libera al cerrar. */
  const [vista, setVista] = useState<{ url: string; tipo: string } | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);

  useEffect(() => () => {
    if (vista) URL.revokeObjectURL(vista.url);
  }, [vista]);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [estado, setEstado] = useState<EstadoPedido>(pedido.estado);
  const [codigo, setCodigo] = useState((pedido.codigos ?? []).join(", "));
  const [cantidad, setCantidad] = useState(pedido.cantidad);
  const [nota, setNota] = useState(pedido.nota);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [copiado, setCopiado] = useState(false);
  const [correoAsignar, setCorreoAsignar] = useState("");
  const [repartiendo, setRepartiendo] = useState(false);
  const [avisoReparto, setAvisoReparto] = useState<Aviso>(null);

  const repartir = async () => {
    if (repartiendo || !correoAsignar.trim()) return;
    setRepartiendo(true);
    setAvisoReparto(null);
    try {
      const r = await asignarCodigos({
        data: { admin: codigoAdmin, folio: pedido.folio, correos: [correoAsignar.trim()] },
      });
      if (!r.ok) {
        setAvisoReparto({
          tipo: "error",
          texto: t(r.motivo === "sin_codigos" ? "cuentaAsignarSinCodigos" : "cuentaAsignarError"),
        });
        return;
      }
      const asignada = r.asignadas[0];
      if (!asignada) {
        setAvisoReparto({ tipo: "error", texto: t("cuentaAsignarError") });
        return;
      }
      setAvisoReparto({
        tipo: "ok",
        texto: asignada.enviado
          ? t("cuentaAsignarListo").replace("{correo}", asignada.correo)
          : asignada.motivo === "ya_tenia_cuenta"
            ? t("cuentaAsignarYaTenia").replace("{correo}", asignada.correo)
            : `${t("cuentaAsignarSinCorreo")} ${t("cuentaAsignarCredenciales")
                .replace("{usuario}", asignada.usuario)
                .replace("{clave}", asignada.clave ?? "")}`,
      });
      setCorreoAsignar("");
    } catch {
      setAvisoReparto({ tipo: "error", texto: t("cuentaAsignarError") });
    } finally {
      setRepartiendo(false);
    }
  };

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    setAviso(null);
    try {
      // El campo de códigos se manda tal cual sólo si el admin lo tocó: si va
      // siempre, «volver a pendiente» arrastra los códigos viejos y no se
      // liberan, que es justo lo que hay que poder hacer.
      const original = (pedido.codigos ?? []).join(", ");
      const r = await actualizarPedido({
        data: {
          admin: codigoAdmin,
          folio: pedido.folio,
          estado,
          cantidad,
          codigoPremium: codigo.trim() === original ? "" : codigo,
          nota,
        },
      });
      if (!r.ok) {
        setAviso({ tipo: "error", texto: t(`adminPedidoError_${r.motivo}`) });
        return;
      }
      onCambio({ ...pedido, ...r.pedido, comprobante: pedido.comprobante, tipoComprobante: pedido.tipoComprobante });
      setEstado(r.pedido.estado);
      setCantidad(r.pedido.cantidad);
      setCodigo((r.pedido.codigos ?? []).join(", "));
      setNota(r.pedido.nota);
      setAviso({ tipo: "ok", texto: t(r.aviso ? "adminPedidoGuardadoAviso" : "adminPedidoGuardado") });
    } catch {
      setAviso({ tipo: "error", texto: t("adminPedidoError_servidor") });
    } finally {
      setGuardando(false);
    }
  };

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await enviarCodigoPedido({ data: { admin: codigoAdmin, folio: pedido.folio } });
      if (!r.ok) {
        setAviso({ tipo: "error", texto: t(`adminPedidoEnvio_${r.motivo}`) });
        return;
      }
      onCambio({ ...pedido, estado: "enviado" });
      setEstado("enviado");
      setAviso({ tipo: "ok", texto: t("adminPedidoEnviado") });
    } catch {
      setAviso({ tipo: "error", texto: t("adminPedidoError_servidor") });
    } finally {
      setEnviando(false);
    }
  };

  const borrar = async () => {
    if (borrando) return;
    setBorrando(true);
    setAviso(null);
    try {
      const r = await eliminarPedido({ data: { admin: codigoAdmin, folio: pedido.folio } });
      if (!r.ok) {
        setAviso({ tipo: "error", texto: t(r.motivo === "admin" ? "adminError" : "adminPedidoEliminarError") });
        return;
      }
      onEliminar();
    } catch {
      setAviso({ tipo: "error", texto: t("adminPedidoEliminarError") });
    } finally {
      setBorrando(false);
    }
  };

  /**
   * Abre el comprobante DENTRO del panel.
   *
   * Antes se abría en una pestaña nueva con un clic sintético sobre un enlace
   * `blob:`: si el navegador tiene bloqueo de ventanas emergentes (o el
   * comprobante pasa el minuto de vida del blob), el pedido «no tenía» archivo.
   * Acá se ve sin salir de la lista y queda botón para descargarlo.
   */
  const ver = async () => {
    if (vista) {
      setVista(null);
      return;
    }
    setAviso(null);
    setCargandoVista(true);
    try {
      const r = await leerComprobante({ data: { admin: codigoAdmin, folio: pedido.folio } });
      if (!r) {
        setAviso({ tipo: "error", texto: t("adminPedidoSinArchivo") });
        return;
      }
      setVista({ url: URL.createObjectURL(base64ABlob(r.base64, r.tipo)), tipo: r.tipo });
    } catch {
      setAviso({ tipo: "error", texto: t("adminPedidoError_servidor") });
    } finally {
      setCargandoVista(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pedido.folio);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1400);
    } catch {
      // sin portapapeles
    }
  };

  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="font-mono text-xs font-bold text-foreground">{pedido.folio}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COLOR[pedido.estado]}`}>
          {t(`pagoEstado_${pedido.estado}`)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{pedido.nombre || pedido.correo}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {new Date(pedido.creado).toLocaleDateString()}
        </span>
      </button>

      {abierto && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
              <p className="text-muted-foreground">{t("pagoNombre")}</p>
              <p className="font-medium text-foreground">{pedido.nombre || "—"}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
              <p className="text-muted-foreground">{t("pagoCelular")}</p>
              <p className="font-medium text-foreground">{pedido.celular}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
              <p className="text-muted-foreground">{t("pagoCorreo")}</p>
              <p className="break-all font-medium text-foreground">{pedido.correo}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 p-2.5">
              <p className="text-muted-foreground">
                {t("adminPedidoCantidad")} · {t("adminPedidoTotal")}
              </p>
              <p className="font-medium text-foreground">
                {pedido.cantidad} × {pedido.total / Math.max(1, pedido.cantidad)} = {pedido.total} Bs
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 p-2.5 sm:col-span-2">
              <p className="text-muted-foreground">{t("adminPedidoVentana")}</p>
              <p className="font-medium text-foreground">
                {pedido.estado === "pendiente"
                  ? new Date(pedido.ventanaFin).toLocaleString()
                  : t("adminPedidoVentanaCerrada")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void ver()}
              disabled={cargandoVista}
              className="boton-fantasma min-h-9 gap-1.5 px-3 text-[11px]"
            >
              {cargandoVista ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              {vista ? t("adminPedidoOcultar") : t("adminPedidoVer")}
            </button>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <FileText className="h-3 w-3" aria-hidden />
              {pedido.tipoComprobante.replace("application/", "").replace("image/", "")}
            </span>
            <button
              type="button"
              onClick={() => void copiar()}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {copiado ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <ClipboardCopy className="h-3 w-3" />}
              {copiado ? t("adminPedidoCopiado") : t("adminPedidoCopiarFolio")}
            </button>
          </div>

          {pedido.codigos.length > 0 ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                {t("adminPedidoCodigosLista")} ({pedido.codigos.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {pedido.codigos.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-background/60 px-1.5 py-1 text-[10px] text-foreground">
                      {c}
                    </code>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(c)}
                      aria-label={t("adminPedidoCopiarFolio")}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ClipboardCopy className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
              {t("adminPedidoCodigosVacio")}
            </p>
          )}

          {(pedido.estado === "pagado" || pedido.estado === "enviado") && pedido.codigos.length > 0 && (
            <div className="rounded-2xl border border-border bg-background/40 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminPedidoRepartir")}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{t("adminPedidoRepartirAyuda")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <input
                  type="email"
                  value={correoAsignar}
                  onChange={(e) => setCorreoAsignar(e.target.value)}
                  aria-label={t("cuentaAsignarCorreo")}
                  placeholder="persona@correo.com"
                  className="min-h-9 min-w-0 flex-1 rounded-xl border border-border bg-background/60 px-2 text-xs text-foreground outline-none focus-visible:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void repartir()}
                  disabled={repartiendo || !correoAsignar.trim()}
                  className="boton-spray min-h-9 shrink-0 gap-1.5 px-3 text-[11px] disabled:opacity-50"
                >
                  {repartiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t("cuentaAsignarEnviar")}
                </button>
              </div>
              {avisoReparto && (
                <p className={`mt-1.5 text-[10px] ${avisoReparto.tipo === "ok" ? "text-primary" : "text-destructive"}`}>
                  {avisoReparto.texto}
                </p>
              )}
            </div>
          )}

          {vista && (
            <div className="rounded-2xl border border-border bg-background/60 p-2">
              {vista.tipo.startsWith("image/") ? (
                <img
                  src={vista.url}
                  alt={`${t("adminPedidoComprobante")} ${pedido.folio}`}
                  className="max-h-[60vh] w-full rounded-xl bg-white object-contain"
                />
              ) : (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("adminPedidoAbrirPdf")}</p>
              )}
              <div className="mt-1.5 flex items-center gap-3 px-1 text-[10px]">
                <a href={vista.url} download={pedido.folio} className="font-semibold text-primary hover:underline">
                  {t("adminPedidoDescargar")}
                </a>
                <a href={vista.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:underline">
                  {t("adminPedidoAbrirPdf")}
                </a>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="text-[10px] text-muted-foreground">
              {t("adminPedidoEstado")}
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoPedido)}
                className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/60 px-2 text-xs text-foreground outline-none focus-visible:border-primary"
              >
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {t(`pagoEstado_${e}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("adminPedidoCantidad")}
              <input
                type="number"
                min={1}
                max={10}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="mt-1 min-h-10 w-20 rounded-xl border border-border bg-background/60 px-2 text-xs text-foreground outline-none focus-visible:border-primary"
              />
            </label>
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] text-muted-foreground">
              {t("adminPedidoCodigo")}
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                aria-describedby={`codigos-ayuda-${pedido.folio}`}
                list={`codigos-${pedido.folio}`}
                spellCheck={false}
                placeholder={t("adminPedidoCodigoPlaceholder")}
                className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/60 px-2 font-mono text-[10px] text-foreground outline-none focus-visible:border-primary"
              />
              <datalist id={`codigos-${pedido.folio}`}>
                {codigosActivos.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="block text-[10px] text-muted-foreground">
            {t("adminPedidoNota")}
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={600}
              rows={2}
              className="mt-1 w-full resize-y rounded-xl border border-border bg-background/60 px-2 py-2 text-xs text-foreground outline-none focus-visible:border-primary"
              placeholder={t("adminPedidoNotaPlaceholder")}
            />
          </label>

          {aviso && (
            <p className={`rounded-xl px-3 py-2 text-[11px] ${aviso.tipo === "ok" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              {aviso.texto}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando}
              className="boton-spray min-h-9 gap-1.5 px-3 text-[11px] disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t("adminPedidoGuardar")}
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || pedido.codigos.length === 0}
              className="boton-fantasma min-h-9 gap-1.5 px-3 text-[11px] disabled:opacity-40"
              title={pedido.codigos.length === 0 ? t("adminPedidoSinCodigo") : undefined}
            >
              {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {t("adminPedidoEnviar")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAviso(null);
                setConfirmarBorrado(true);
              }}
              disabled={borrando}
              className="boton-fantasma ml-auto min-h-9 gap-1.5 px-3 text-[11px] text-destructive disabled:opacity-40"
            >
              {borrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t("adminPedidoEliminar")}
            </button>
          </div>

          {confirmarBorrado && (
            <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
              <p className="text-[11px] text-destructive">{t("adminPedidoEliminarAviso")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void borrar()}
                  disabled={borrando}
                  className="boton-spray min-h-9 gap-1.5 px-3 text-[11px] disabled:opacity-50"
                >
                  {borrando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("adminPedidoEliminarSi")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmarBorrado(false)}
                  disabled={borrando}
                  className="boton-fantasma min-h-9 px-3 text-[11px]"
                >
                  {t("adminPedidoEliminarNo")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function AdminPedidos({ codigo }: { codigo: string }) {
  const t = useI18n();
  const [pedidos, setPedidos] = useState<PedidoAdmin[]>([]);
  const [resumen, setResumen] = useState<ResumenCodigos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [probando, setProbando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [avisoCorreo, setAvisoCorreo] = useState<string | null>(null);
  const [avisoSync, setAvisoSync] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!codigo) return;
    setCargando(true);
    setError(false);
    try {
      const [rPedidos, rResumen] = await Promise.all([
        adminPedidos({ data: { admin: codigo } }),
        resumenCodigos({ data: { admin: codigo } }),
      ]);
      if (rPedidos.ok) setPedidos(rPedidos.pedidos);
      else setError(true);
      setResumen(rResumen);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const probar = async () => {
    if (probando) return;
    setProbando(true);
    setAvisoCorreo(null);
    try {
      const r = await probarCorreo({ data: { admin: codigo } });
      setAvisoCorreo(r.ok ? t("adminPedidoCorreoOk") : t(`adminPedidoEnvio_${r.motivo ?? "servidor"}`));
    } catch {
      setAvisoCorreo(t("adminPedidoEnvio_servidor"));
    } finally {
      setProbando(false);
    }
  };

  const sincronizar = async () => {
    if (sincronizando) return;
    setSincronizando(true);
    setAvisoSync(null);
    try {
      const r = await sincronizarCodigos({ data: { admin: codigo } });
      setAvisoSync(
        r.ok ? t("adminCodigosSyncOk").replace("{n}", String(r.total)) : t("adminCodigosSyncError"),
      );
    } catch {
      setAvisoSync(t("adminCodigosSyncError"));
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-muted-foreground">
          <Mail className={`h-3 w-3 ${resumen?.correoConfigurado ? "text-primary" : "text-destructive"}`} aria-hidden />
          {resumen?.correoConfigurado ? t("adminPedidoCorreoListo") : t("adminPedidoCorreoSin")}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-primary" aria-hidden />
          {t("adminPedidoActivos")}: <strong className="text-foreground">{resumen?.activos ?? 0}</strong>
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1 text-muted-foreground"
          title={t(resumen?.firmaConfigurada ? "adminPedidoFirmaOk" : "adminPedidoFirmaNo")}
        >
          <KeyRound className={`h-3 w-3 ${resumen?.firmaConfigurada ? "text-primary" : "text-amber-500"}`} aria-hidden />
          {resumen?.firmaConfigurada ? t("adminPedidoFirmaOk") : t("adminPedidoFirmaNo")}
        </span>
        <button
          type="button"
          onClick={() => void probar()}
          disabled={probando}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {probando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
          {t("adminPedidoProbarCorreo")}
        </button>
        <button
          type="button"
          onClick={() => void sincronizar()}
          disabled={sincronizando}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {sincronizando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t("adminCodigosSync")}
        </button>
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

      {avisoCorreo && (
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">{avisoCorreo}</p>
      )}
      {avisoSync && (
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">{avisoSync}</p>
      )}

      {resumen && resumen.codigosActivos.length > 0 && (
        <details className="rounded-2xl border border-border bg-background/40 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-foreground">
            {t("adminPedidoCodigosDisponibles")} ({resumen.codigosActivos.length})
          </summary>
          <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {resumen.codigosActivos.map((c) => (
              <code key={c} className="rounded-lg border border-border/60 bg-card/60 px-1.5 py-1 text-[9px] text-muted-foreground">
                {c.slice(0, 42)}…
              </code>
            ))}
          </div>
        </details>
      )}

      {cargando && pedidos.length === 0 && (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("adminCargando")}
        </p>
      )}
      {error && <p className="py-6 text-center text-xs text-destructive">{t("adminError")}</p>}
      {!cargando && !error && pedidos.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-background/30 p-6 text-center text-xs text-muted-foreground">
          {t("adminPedidoVacio")}
        </p>
      )}

      {pedidos.length > 0 && (
        <ul className="space-y-2">
          {pedidos.map((p) => (
            <FilaPedido
              key={p.folio}
              pedido={p}
              codigoAdmin={codigo}
              codigosActivos={resumen?.codigosActivos ?? []}
              onCambio={(nuevo) => setPedidos((lista) => lista.map((x) => (x.folio === nuevo.folio ? nuevo : x)))}
              onEliminar={() => setPedidos((lista) => lista.filter((x) => x.folio !== p.folio))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
