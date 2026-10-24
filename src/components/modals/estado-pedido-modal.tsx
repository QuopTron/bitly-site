import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCopy, Clock, KeyRound, Loader2, PackageSearch, RefreshCw } from "lucide-react";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { useI18n } from "@/lib/i18n";
import {
  guardarPedidoLocal,
  leerPedidosLocales,
  quitarPedidoLocal,
  type PedidoLocal,
} from "@/lib/pedidos-cliente";
import {
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
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

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
                      {pedido.estado === "pendiente" && (
                        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                          {t("estadoPendienteNota")}
                        </p>
                      )}
                      {pedido.nota && <p className="text-[11px] text-muted-foreground">{pedido.nota}</p>}
                      {pedido.codigo ? (
                        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-primary">{t("estadoCodigo")}</p>
                          <p className="mt-1 break-all font-mono text-xs text-foreground">{pedido.codigo}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copiar(pedido.codigo ?? "")}
                              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"
                            >
                              {copiado === pedido.codigo ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                              {copiado === pedido.codigo ? t("estadoCopiado") : t("estadoCopiar")}
                            </button>
                            <span className="self-center text-[10px] text-muted-foreground">{t("estadoActivar")}</span>
                          </div>
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
