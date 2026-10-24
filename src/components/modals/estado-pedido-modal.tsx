import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCopy, Clock, KeyRound, Loader2, PackageSearch, RefreshCw, XCircle } from "lucide-react";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { useI18n } from "@/lib/i18n";
import {
  guardarPedidoLocal,
  leerPedidosLocales,
  quitarPedidoLocal,
  type PedidoLocal,
} from "@/lib/pedidos-cliente";
import {
  abortarCompra,
  anularPedido,
  consultarPedido,
  recuperarPedido,
  type PedidoPublico,
} from "@/server/pedidos";
import { useHayCuenta } from "@/lib/cuentas-cliente";

type EstadoCargado = {
  local: PedidoLocal;
  pedido: PedidoPublico | null;
  aviso?: "no_encontrado" | "servidor";
};

type Props = {
  open: boolean;
  onClose: () => void;
  onComprar: () => void;
  /** Abre el modal de cuenta: el estado del pedido pide sesión. */
  onCuenta?: () => void;
};

const COLOR: Record<string, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  revision: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** 4:59, para la cuenta atrás de la ventana. */
function formatoRestante(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

export default function EstadoPedidoModal({ open, onClose, onComprar, onCuenta }: Props) {
  const t = useI18n();
  // Los pedidos viven en la cuenta: sin sesión no hay nada que mostrar acá.
  const hayCuenta = useHayCuenta();
  const [cargando, setCargando] = useState(false);
  const [pedidos, setPedidos] = useState<EstadoCargado[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [folio, setFolio] = useState("");
  const [contacto, setContacto] = useState("");
  const [recuperando, setRecuperando] = useState(false);
  const [errorRecuperar, setErrorRecuperar] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [abortando, setAbortando] = useState(false);
  /** Folio con el aviso de aborto abierto (pide doble confirmación). */
  const [confirmarAborto, setConfirmarAborto] = useState<string | null>(null);
  const [avisoAccion, setAvisoAccion] = useState<string | null>(null);
  /** Aviso del último «anular» / «abortar» con su tono. */
  const [accionError, setAccionError] = useState(false);
  /** Segundos que le quedan a la ventana del pedido abierto. */
  const [restante, setRestante] = useState(0);
  const abiertoPedido = pedidos.find((p) => p.local.folio === abierto)?.pedido ?? null;
  const finVentana =
    abiertoPedido?.estado === "pendiente" ? abiertoPedido.ventanaFin : null;

  useEffect(() => {
    if (!finVentana) {
      setRestante(0);
      return;
    }
    const calcular = () =>
      setRestante(Math.max(0, Math.floor((Date.parse(finVentana) - Date.now()) / 1000)));
    calcular();
    const id = setInterval(calcular, 1000);
    return () => clearInterval(id);
  }, [finVentana]);

  const cargar = useCallback(async () => {
    const locales = leerPedidosLocales();
    if (locales.length === 0) {
      setPedidos([]);
      return;
    }
    setCargando(true);
    try {
      const resultados = await Promise.all(
        locales.map(async (local): Promise<EstadoCargado> => {
          try {
            const r = await consultarPedido({ data: { folio: local.folio, token: local.token } });
            if (r.ok) return { local, pedido: r.pedido };
            if (r.motivo === "no_encontrado") {
              quitarPedidoLocal(local.folio);
              return { local, pedido: null, aviso: "no_encontrado" };
            }
            return { local, pedido: null, aviso: "servidor" };
          } catch {
            return { local, pedido: null, aviso: "servidor" };
          }
        }),
      );
      const vivos = resultados.filter((r) => r.pedido || r.aviso === "servidor");
      setPedidos(vivos);
      setAbierto((actual) => actual ?? vivos[0]?.local.folio ?? null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (open) void cargar();
  }, [open, cargar]);

  const recuperar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recuperando || !folio.trim() || !contacto.trim()) return;
    setRecuperando(true);
    setErrorRecuperar(false);
    try {
      const r = await recuperarPedido({ data: { folio, contacto } });
      if (!r.ok) {
        setErrorRecuperar(true);
        return;
      }
      guardarPedidoLocal({ folio: r.pedido.folio, token: r.token, creado: r.pedido.creado });
      setFolio("");
      setContacto("");
      await cargar();
      setAbierto(r.pedido.folio);
    } catch {
      setErrorRecuperar(true);
    } finally {
      setRecuperando(false);
    }
  };

  /** Anulación normal: sólo dentro de la ventana y sin consecuencias. */
  const anular = async (local: PedidoLocal) => {
    if (anulando) return;
    setAnulando(local.folio);
    setAvisoAccion(null);
    try {
      const r = await anularPedido({ data: { folio: local.folio, token: local.token } });
      if (!r.ok) {
        setAccionError(true);
        setAvisoAccion(t(r.motivo === "fuera_de_tiempo" ? "estadoAnularTarde" : "estadoAnularError"));
        return;
      }
      setAccionError(false);
      setAvisoAccion(t("estadoAnulado"));
      await cargar();
    } catch {
      setAccionError(true);
      setAvisoAccion(t("estadoAnularError"));
    } finally {
      setAnulando(null);
    }
  };

  /**
   * Abortar: cancela el pedido y da de baja la cuenta.
   *
   * Queda detrás de un despliegue aparte y de un «sí» explícito: es el único
   * botón del sitio que tiene consecuencias sobre la cuenta, y no tiene vuelta.
   */
  const abortar = async (local: PedidoLocal) => {
    if (abortando) return;
    setAbortando(true);
    setAvisoAccion(null);
    try {
      const r = await abortarCompra({ data: { folio: local.folio, token: local.token } });
      if (!r.ok) {
        setAccionError(true);
        setAvisoAccion(t(r.motivo === "fuera_de_tiempo" ? "estadoAnularTarde" : "estadoAnularError"));
        return;
      }
      setAccionError(false);
      setAvisoAccion(t(r.baneada ? "estadoAbortado" : "estadoAbortadoSinCuenta"));
      setConfirmarAborto(null);
      await cargar();
    } catch {
      setAccionError(true);
      setAvisoAccion(t("estadoAnularError"));
    } finally {
      setAbortando(false);
    }
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      setTimeout(() => setCopiado(null), 1600);
    } catch {
      // sin permiso de portapapeles: el usuario puede seleccionarlo a mano
    }
  };

  const input =
    "min-h-10 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("estadoTitulo")}
      subtitle={t("estadoDesc")}
      icon={<PackageSearch className="h-5 w-5 text-primary" />}
      ancho="amplio"
    >
      {!hayCuenta ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
            <p className="text-sm font-semibold text-foreground">{t("pagoSesionTitulo")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("pagoSesionTexto")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onCuenta?.();
            }}
            className="boton-spray min-h-11 w-full justify-center gap-2 text-sm"
          >
            {t("pagoSesionBoton")}
          </button>
        </div>
      ) : (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{t("estadoGuardados")}</p>
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={cargando}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
            {t("adminActualizar")}
          </button>
        </div>

        {avisoAccion && (
          <p
            className={`rounded-xl px-3 py-2 text-[11px] ${
              accionError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}
          >
            {avisoAccion}
          </p>
        )}

        {cargando && pedidos.length === 0 && (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("estadoCargando")}
          </p>
        )}

        {!cargando && pedidos.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-background/30 p-5 text-center">
            <p className="text-xs text-muted-foreground">{t("estadoVacio")}</p>
            <button type="button" onClick={onComprar} className="boton-spray mt-3 min-h-10 justify-center px-4 text-xs">
              {t("pagoTitulo")}
            </button>
          </div>
        )}

        {pedidos.length > 0 && (
          <ul className="space-y-2">
            {pedidos.map(({ local, pedido, aviso }) => {
              const activo = abierto === local.folio;
              return (
                <li key={local.folio} className="overflow-hidden rounded-2xl border border-border bg-background/40">
                  <button
                    type="button"
                    onClick={() => setAbierto(activo ? null : local.folio)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <span className="font-mono text-xs font-bold text-foreground">{local.folio}</span>
                    {pedido ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COLOR[pedido.estado] ?? ""}`}>
                        {t(`pagoEstado_${pedido.estado}`)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {aviso === "servidor" ? t("estadoError") : t("estadoNoEncontrado")}
                      </span>
                    )}
                    {pedido?.codigo && <KeyRound className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                  </button>

                  {activo && pedido && (
                    <div className="space-y-2 border-t border-border/60 px-3 py-3 text-xs">
                      <p className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden />
                        {new Date(pedido.creado).toLocaleString()}
                      </p>
                      {pedido.cantidad > 1 && (
                        <p className="text-[11px] text-muted-foreground">
                          {t("estadoCantidad")}: <strong className="text-foreground">{pedido.cantidad}</strong>
                        </p>
                      )}

                      {pedido.estado === "pendiente" && (
                        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                          <p className="text-[11px] text-amber-500">
                            {restante > 0
                              ? t("estadoVentanaNota").replace("{t}", formatoRestante(restante))
                              : t("estadoVentanaCerrada")}
                          </p>
                          {restante > 0 && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void anular(local)}
                                disabled={anulando === local.folio}
                                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-[11px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                              >
                                {anulando === local.folio ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                                {t("estadoAnular")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmarAborto(confirmarAborto === local.folio ? null : local.folio)}
                                className="text-[10px] text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
                              >
                                {t("estadoAbortar")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {pedido.estado === "revision" && (
                        <p className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-[11px] text-violet-400">
                          {t("estadoRevisionNota")}
                        </p>
                      )}

                      {confirmarAborto === local.folio && (
                        <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
                          <p className="text-[11px] leading-relaxed text-destructive">{t("estadoAbortarAviso")}</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void abortar(local)}
                              disabled={abortando}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-destructive px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                            >
                              {abortando && <Loader2 className="h-3 w-3 animate-spin" />}
                              {t("estadoAbortarSi")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmarAborto(null)}
                              disabled={abortando}
                              className="boton-fantasma min-h-8 px-3 text-[11px]"
                            >
                              {t("estadoAbortarNo")}
                            </button>
                          </div>
                        </div>
                      )}

                      {pedido.nota && <p className="text-[11px] text-muted-foreground">{pedido.nota}</p>}

                      {pedido.codigos.length > 0 ? (
                        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-primary">
                            {pedido.codigos.length > 1 ? t("estadoCodigos") : t("estadoCodigo")}
                          </p>
                          <ul className="mt-1 space-y-1.5">
                            {pedido.codigos.map((codigo) => (
                              <li key={codigo} className="flex flex-wrap items-center gap-2">
                                <p className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{codigo}</p>
                                <button
                                  type="button"
                                  onClick={() => void copiar(codigo)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground"
                                >
                                  {copiado === codigo ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                                  {copiado === codigo ? t("estadoCopiado") : t("estadoCopiar")}
                                </button>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-[10px] text-muted-foreground">{t("estadoActivar")}</p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">{t("estadoSinCodigo")}</p>
                      )}
                    </div>
                  )}
                  {activo && !pedido && (
                    <p className="border-t border-border/60 px-3 py-3 text-[11px] text-muted-foreground">
                      {aviso === "servidor" ? t("estadoError") : t("estadoNoEncontrado")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={recuperar} className="rounded-2xl border border-border bg-card/40 p-3">
          <p className="mb-2 text-[11px] font-medium text-foreground">{t("estadoRecuperar")}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={folio}
              onChange={(e) => {
                setFolio(e.target.value.toUpperCase());
                setErrorRecuperar(false);
              }}
              placeholder="FLX-XXXXXXXX"
              aria-label={t("pagoFolio")}
              className={input}
            />
            <input
              value={contacto}
              onChange={(e) => {
                setContacto(e.target.value);
                setErrorRecuperar(false);
              }}
              placeholder={t("estadoContactoPlaceholder")}
              aria-label={t("estadoContactoPlaceholder")}
              className={input}
            />
            <button
              type="submit"
              disabled={recuperando || !folio.trim() || !contacto.trim()}
              className="boton-fantasma min-h-10 justify-center px-3 text-xs disabled:opacity-40"
            >
              {recuperando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t("estadoRecuperarBoton")}
            </button>
          </div>
          {errorRecuperar && <p className="mt-2 text-[11px] text-destructive">{t("estadoRecuperarError")}</p>}
        </form>
      </div>
      )}
    </ModalWrapper>
  );
}
