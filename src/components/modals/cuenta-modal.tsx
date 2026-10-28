import { useCallback, useEffect, useState } from "react";
import {
  AtSign,
  Check,
  ClipboardCopy,
  Gem,
  Headphones,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MailCheck,
  PackageSearch,
  Send,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  Wrench,
} from "lucide-react";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { i18n, useI18n } from "@/lib/i18n";
import { navegarA } from "@/lib/navegacion";
import {
  guardarTokenCuenta,
  leerTokenCuenta,
  quitarTokenCuenta,
} from "@/lib/cuentas-cliente";
import {
  confirmarCambio,
  confirmarCuenta,
  eliminarCuenta,
  iniciarSesion,
  miCuenta,
  registrarCuenta,
  reenviarConfirmacion,
  solicitarCambio,
  type CuentaPublica,
  type PedidoDeCuenta,
} from "@/server/cuentas";
import {
  asignarCodigos,
  misCodigos,
  revocarAsignacion,
  type Asignada,
  type CodigoDeComprador,
} from "@/server/asignaciones";
import {
  borrarRescate,
  guardarRescate,
  leerRescate,
  type RescateGuardado,
} from "@/lib/rescate-cuenta";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Paso = "login" | "registro" | "confirmar" | "sesion";

type Grupo = { folio: string; estado: string; codigos: CodigoDeComprador[] };

type Cambio = {
  tipo: "clave" | "usuario";
  etapa: "pedir" | "confirmar";
  codigo: string;
  aviso: string | null;
  error: string | null;
  ocupado: boolean;
};

type Asignacion = {
  folio: string;
  codigo: string;
  correo: string;
  error: string | null;
  ocupado: boolean;
  resultado: Asignada | null;
};

/**
 * Formulario del rescate. `relay` es un tri-estado como el del contrato: "sin"
 * es "no lo toquen" y NO es lo mismo que "off" (apagado).
 */
type Rescate = {
  cargando: boolean;
  guardando: boolean;
  borrando: boolean;
  espejos: string;
  espejosApagados: boolean;
  arcod: string;
  arcodApagado: boolean;
  monochrome: string;
  monochromeApagado: boolean;
  relay: "sin" | "on" | "off";
  aviso: string | null;
  error: string | null;
};

const RESCATE_VACIO: Omit<Rescate, "cargando" | "aviso" | "error"> = {
  guardando: false,
  borrando: false,
  espejos: "",
  espejosApagados: false,
  arcod: "",
  arcodApagado: false,
  monochrome: "",
  monochromeApagado: false,
  relay: "sin",
};

/** Lo que la cuenta tiene guardado → el formulario del panel. */
function formularioDesdeConfig(cfg: RescateGuardado): Omit<Rescate, "cargando" | "aviso" | "error"> {
  const espejos = cfg.mirrors ?? [];
  return {
    ...RESCATE_VACIO,
    espejos: espejos.join("\n"),
    // Una lista VACÍA es "apagados", y se distingue de "no lo tocaron" (el
    // campo no viene). El interruptor suelto hace lo mismo.
    espejosApagados: (cfg.mirrors !== undefined && espejos.length === 0) || cfg.espejos === false,
    arcod: cfg.arcodBase ?? "",
    arcodApagado: cfg.arcod === false,
    monochrome: cfg.monochromeBase ?? "",
    monochromeApagado: cfg.monochrome === false,
    relay: cfg.stashRelay === undefined ? "sin" : cfg.stashRelay ? "on" : "off",
  };
}

/**
 * El formulario → el contrato de la ruta. Sólo viaja lo DEFINIDO: un campo
 * ausente es "no lo toquen". La instancia propia manda sobre el interruptor
 * porque apuntar el canal ya es encenderlo (misma regla que la app).
 */
function contratoDeFormulario(e: Rescate): RescateGuardado {
  const cfg: RescateGuardado = {};
  const espejos = e.espejos
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);
  if (espejos.length > 0) cfg.mirrors = espejos;
  else if (e.espejosApagados) cfg.mirrors = [];
  if (e.arcod.trim()) cfg.arcodBase = e.arcod.trim();
  else if (e.arcodApagado) cfg.arcod = false;
  if (e.monochrome.trim()) cfg.monochromeBase = e.monochrome.trim();
  else if (e.monochromeApagado) cfg.monochrome = false;
  if (e.relay !== "sin") cfg.stashRelay = e.relay === "on";
  return cfg;
}

const COLOR: Record<string, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  revision: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

const input =
  "min-h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

const chico =
  "inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50";

export default function CuentaModal({ open, onClose }: Props) {
  const t = useI18n();
  const [paso, setPaso] = useState<Paso>("login");
  const [identificador, setIdentificador] = useState("");
  const [usuario, setUsuario] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [pendiente, setPendiente] = useState<{ correo: string; enviado: boolean } | null>(null);
  const [codigoAlta, setCodigoAlta] = useState("");
  const [reenviado, setReenviado] = useState(false);

  const [cuenta, setCuenta] = useState<CuentaPublica | null>(null);
  const [pedidos, setPedidos] = useState<PedidoDeCuenta[]>([]);
  const [premium, setPremium] = useState<string | null>(null);
  const [debeCambiar, setDebeCambiar] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);

  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [activado, setActivado] = useState(false);
  const [eliminada, setEliminada] = useState(false);

  const [cambio, setCambio] = useState<Cambio | null>(null);
  const [nuevoUsuario, setNuevoUsuario] = useState("");
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [claveRepetida, setClaveRepetida] = useState("");

  const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
  const [revocarId, setRevocarId] = useState<string | null>(null);

  const [baja, setBaja] = useState<{ clave: string; error: string | null; ocupado: boolean } | null>(null);

  // Panel del rescate: `null` = cerrado (no se pide nada al servidor hasta que
  // el usuario lo abre).
  const [rescate, setRescate] = useState<Rescate | null>(null);

  const cargar = useCallback(async (token: string) => {
    setCargando(true);
    try {
      const r = await miCuenta({ data: { token } });
      if (!r.ok) {
        quitarTokenCuenta();
        setCuenta(null);
        setPedidos([]);
        setPremium(null);
        setGrupos([]);
        setPaso("login");
        return;
      }
      setCuenta(r.cuenta);
      setPedidos(r.pedidos);
      setPremium(r.premium?.codigo ?? null);
      setDebeCambiar(r.debeCambiarClave);
      // Invitada con contraseña por defecto: el cambio se pide ya, no es una
      // sección más que se pueda saltear.
      if (r.debeCambiarClave) {
        setCambio({ tipo: "clave", etapa: "pedir", codigo: "", aviso: null, error: null, ocupado: false });
      }
      setPaso("sesion");

      const m = await misCodigos({ data: { token } });
      setGrupos(m.ok ? m.grupos : []);
    } catch {
      setError(i18n("cuentaErrorServidor"));
    } finally {
      setCargando(false);
    }
  }, []);

  function setModoInicial() {
    setPaso("login");
    setClave("");
    setRepetir("");
    setCodigoAlta("");
    setPendiente(null);
    setReenviado(false);
    setCambio(null);
    setAsignacion(null);
    setRevocarId(null);
    setBaja(null);
    setEliminada(false);
    setRescate(null);
  }

  /**
   * Abre el panel del rescate y trae lo que la cuenta tiene guardado.
   *
   * Se pide recién ahora a propósito: el modal se abre para muchas cosas
   * (pedidos, códigos, seguridad) y no vale gastar una petición por cada una.
   */
  const abrirRescate = async () => {
    setRescate({ ...RESCATE_VACIO, cargando: true, aviso: null, error: null });
    const r = await leerRescate();
    if (r.ok) {
      setRescate({ ...formularioDesdeConfig(r.config), cargando: false, aviso: null, error: null });
      return;
    }
    setRescate({
      ...RESCATE_VACIO,
      cargando: false,
      aviso: null,
      error: r.motivo === "sesion" ? t("cuentaRescateSinSesion") : t("cuentaRescateMal"),
    });
  };

  const guardarRescateCuenta = async () => {
    if (!rescate || rescate.guardando) return;
    const config = contratoDeFormulario(rescate);
    // Nada definido: la ruta lo tomaría como "borrar" y borraría lo que otro
    // dispositivo de la cuenta haya puesto. Mejor avisar que guardar de más.
    if (Object.keys(config).length === 0) {
      setRescate({ ...rescate, aviso: null, error: t("cuentaRescateVacio") });
      return;
    }
    setRescate({ ...rescate, guardando: true, aviso: null, error: null });
    const r = await guardarRescate(config);
    if (r.ok) {
      setRescate({
        ...formularioDesdeConfig(r.config),
        cargando: false,
        aviso: t("cuentaRescateGuardado"),
        error: null,
      });
      return;
    }
    setRescate({
      ...rescate,
      guardando: false,
      error:
        r.motivo === "sesion"
          ? t("cuentaRescateSinSesion")
          : r.motivo === "datos"
            ? t("cuentaRescateUrlMala")
            : t("cuentaRescateMal"),
    });
  };

  const borrarRescateCuenta = async () => {
    if (!rescate || rescate.borrando) return;
    setRescate({ ...rescate, borrando: true, aviso: null, error: null });
    const r = await borrarRescate();
    if (r.ok) {
      setRescate({ ...RESCATE_VACIO, cargando: false, aviso: t("cuentaRescateBorrado"), error: null });
      return;
    }
    setRescate({
      ...rescate,
      borrando: false,
      error: r.motivo === "sesion" ? t("cuentaRescateSinSesion") : t("cuentaRescateMal"),
    });
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setModoInicial();
    const token = leerTokenCuenta();
    if (token) void cargar(token);
    else {
      setCuenta(null);
      setPedidos([]);
      setPremium(null);
      setGrupos([]);
    }
  }, [open, cargar]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await iniciarSesion({ data: { identificador, clave } });
      if (!r.ok) {
        if (r.motivo === "sin_confirmar" && identificador.includes("@")) {
          setPendiente({ correo: identificador.trim().toLowerCase(), enviado: true });
          setPaso("confirmar");
          return;
        }
        setError(
          r.motivo === "limite"
            ? t("cuentaErrorLimite")
            : r.motivo === "baneada"
              ? t("cuentaErrorBaneada")
              : r.motivo === "servidor"
                ? t("cuentaErrorServidor")
                : r.motivo === "sin_confirmar"
                  ? t("cuentaErrorSinConfirmar")
                  : t("cuentaErrorCredenciales"),
        );
        return;
      }
      guardarTokenCuenta(r.token);
      setClave("");
      await cargar(r.token);
    } catch {
      setError(t("cuentaErrorServidor"));
    } finally {
      setGuardando(false);
    }
  };

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    if (clave !== repetir) {
      setError(t("cuentaErrorClaves"));
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await registrarCuenta({ data: { usuario, correo, clave } });
      if (!r.ok) {
        setError(
          r.motivo === "existe"
            ? t("cuentaErrorExiste")
            : r.motivo === "baneada"
              ? t("cuentaErrorBaneada")
              : r.motivo === "limite"
                ? t("cuentaErrorLimite")
                : r.motivo === "servidor"
                  ? t("cuentaErrorServidor")
                  : t("cuentaErrorDatos"),
        );
        return;
      }
      setUsuario("");
      setClave("");
      setRepetir("");
      if (r.pendiente) {
        setPendiente({ correo: r.correo, enviado: r.enviado });
        setPaso("confirmar");
        return;
      }
      guardarTokenCuenta(r.token);
      await cargar(r.token);
    } catch {
      setError(t("cuentaErrorServidor"));
    } finally {
      setGuardando(false);
    }
  };

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando || !pendiente) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await confirmarCuenta({ data: { identificador: pendiente.correo, codigo: codigoAlta } });
      if (!r.ok) {
        setError(
          r.motivo === "codigo"
            ? t("cuentaErrorCodigo")
            : r.motivo === "expirado"
              ? t("cuentaErrorExpirado")
              : r.motivo === "limite"
                ? t("cuentaErrorLimite")
                : r.motivo === "baneada"
                  ? t("cuentaErrorBaneada")
                  : t("cuentaErrorServidor"),
        );
        return;
      }
      guardarTokenCuenta(r.token);
      setCodigoAlta("");
      await cargar(r.token);
    } catch {
      setError(t("cuentaErrorServidor"));
    } finally {
      setGuardando(false);
    }
  };

  const reenviar = async () => {
    if (!pendiente) return;
    setError(null);
    try {
      const r = await reenviarConfirmacion({ data: { correo: pendiente.correo } });
      if (!r.ok) {
        setError(r.motivo === "limite" ? t("cuentaErrorLimite") : t("cuentaErrorServidor"));
        return;
      }
      setReenviado(true);
      setTimeout(() => setReenviado(false), 4000);
    } catch {
      setError(t("cuentaErrorServidor"));
    }
  };

  const salir = () => {
    quitarTokenCuenta();
    setCuenta(null);
    setPedidos([]);
    setPremium(null);
    setGrupos([]);
    setActivado(false);
    setError(null);
    setModoInicial();
  };

  const copiar = async (valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(valor);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      // sin portapapeles
    }
  };

  /* ── Seguridad: contraseña y usuario con código al correo ───────── */

  const pedirCodigo = async (tipo: "clave" | "usuario") => {
    const token = leerTokenCuenta();
    if (!token) return;
    if (tipo === "clave" && claveNueva !== claveRepetida) {
      setCambio({ tipo, etapa: "pedir", codigo: "", aviso: null, error: t("cuentaErrorClaves"), ocupado: false });
      return;
    }
    setCambio({ tipo, etapa: "pedir", codigo: "", aviso: null, error: null, ocupado: true });
    try {
      const r = await solicitarCambio({
        data: { token, tipo, valor: tipo === "usuario" ? nuevoUsuario : "", claveActual },
      });
      if (!r.ok) {
        setCambio({
          tipo,
          etapa: "pedir",
          codigo: "",
          aviso: null,
          error:
            r.motivo === "clave"
              ? t("cuentaClaveIncorrecta")
              : r.motivo === "ocupado"
                ? t("cuentaErrorUsuarioOcupado")
                : r.motivo === "limite"
                  ? t("cuentaErrorLimite")
                  : r.motivo === "datos"
                    ? tipo === "usuario"
                      ? t("cuentaErrorUsuarioInvalido")
                      : t("cuentaErrorDatos")
                    : t("cuentaErrorServidor"),
          ocupado: false,
        });
        return;
      }
      setClaveActual("");
      setCambio({
        tipo,
        etapa: "confirmar",
        codigo: "",
        aviso: t("cuentaCambioEnviado"),
        error: null,
        ocupado: false,
      });
    } catch {
      setCambio({ tipo, etapa: "pedir", codigo: "", aviso: null, error: t("cuentaErrorServidor"), ocupado: false });
    }
  };

  const confirmarElCambio = async () => {
    const token = leerTokenCuenta();
    if (!token || !cambio) return;
    setCambio({ ...cambio, ocupado: true, error: null });
    try {
      const r = await confirmarCambio({
        data: { token, tipo: cambio.tipo, codigo: cambio.codigo, claveNueva },
      });
      if (!r.ok) {
        setCambio({
          ...cambio,
          ocupado: false,
          error:
            r.motivo === "codigo"
              ? t("cuentaErrorCodigo")
              : r.motivo === "expirado"
                ? t("cuentaErrorExpirado")
                : r.motivo === "ocupado"
                  ? t("cuentaErrorUsuarioOcupado")
                  : t("cuentaErrorServidor"),
        });
        return;
      }
      guardarTokenCuenta(r.token);
      setCuenta(r.cuenta);
      setCambio(null);
      setNuevoUsuario("");
      setClaveNueva("");
      setClaveRepetida("");
      if (cambio.tipo === "clave") setDebeCambiar(false);
      setError(null);
      await cargar(r.token);
    } catch {
      setCambio({ ...cambio, ocupado: false, error: t("cuentaErrorServidor") });
    }
  };

  /* ── Reparto de códigos ─────────────────────────────────────────── */

  const asignar = async () => {
    const token = leerTokenCuenta();
    if (!token || !asignacion) return;
    setAsignacion({ ...asignacion, ocupado: true, error: null, resultado: null });
    try {
      const r = await asignarCodigos({
        data: { token, folio: asignacion.folio, correos: [asignacion.correo] },
      });
      if (!r.ok) {
        setAsignacion({
          ...asignacion,
          ocupado: false,
          error:
            r.motivo === "sin_codigos"
              ? t("cuentaAsignarSinCodigos")
              : r.motivo === "datos"
                ? t("cuentaErrorDatos")
                : t("cuentaAsignarError"),
        });
        return;
      }
      const primera = r.asignadas[0] ?? null;
      setAsignacion({
        ...asignacion,
        ocupado: false,
        correo: primera ? "" : asignacion.correo,
        resultado: primera,
        error: primera ? null : t("cuentaAsignarError"),
      });
      await cargar(token);
    } catch {
      setAsignacion({ ...asignacion, ocupado: false, error: t("cuentaErrorServidor") });
    }
  };

  const revocar = async (id: string) => {
    const token = leerTokenCuenta();
    if (!token) return;
    try {
      const r = await revocarAsignacion({ data: { token, id } });
      setRevocarId(null);
      if (!r.ok) {
        setError(r.motivo === "aceptada" ? t("cuentaRevocarAceptada") : t("cuentaErrorServidor"));
        return;
      }
      setError(null);
      await cargar(token);
    } catch {
      setError(t("cuentaErrorServidor"));
    }
  };

  const eliminar = async () => {
    const token = leerTokenCuenta();
    if (!token || !baja) return;
    setBaja({ ...baja, ocupado: true, error: null });
    try {
      const r = await eliminarCuenta({ data: { token, clave: baja.clave } });
      if (!r.ok) {
        setBaja({
          ...baja,
          ocupado: false,
          error: r.motivo === "clave" ? t("cuentaClaveIncorrecta") : t("cuentaEliminarError"),
        });
        return;
      }
      quitarTokenCuenta();
      setCuenta(null);
      setPedidos([]);
      setPremium(null);
      setGrupos([]);
      setModoInicial();
      setEliminada(true);
    } catch {
      setBaja({ ...baja, ocupado: false, error: t("cuentaEliminarError") });
    }
  };

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("cuentaTitulo")}
      subtitle={cuenta ? `@${cuenta.usuario} · ${cuenta.correo}` : t("cuentaDesc")}
      icon={<User className="h-5 w-5 text-primary" />}
      ancho="amplio"
    >
      {cargando && !cuenta ? (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("cuentaCargando")}
        </p>
      ) : paso === "confirmar" && pendiente ? (
        <form onSubmit={confirmar} className="space-y-3">
          <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MailCheck className="h-4 w-4 text-primary" aria-hidden /> {t("cuentaConfirmarTitulo")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("cuentaConfirmarTexto").replace("{correo}", pendiente.correo)}
            </p>
            {!pendiente.enviado && (
              <p className="mt-2 rounded-xl bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-500">
                {t("cuentaConfirmarSinCorreo")}
              </p>
            )}
          </div>
          <label className="block text-[11px] font-medium text-muted-foreground">
            {t("cuentaConfirmarCodigo")}
            <input
              value={codigoAlta}
              onChange={(e) => setCodigoAlta(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="000000"
              className={`mt-1 text-center font-mono text-lg tracking-[0.4em] ${input}`}
            />
          </label>
          {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}
          {reenviado && (
            <p className="rounded-xl bg-primary/10 px-3 py-2 text-[11px] text-primary">{t("cuentaConfirmarReenviado")}</p>
          )}
          <button
            type="submit"
            disabled={guardando || codigoAlta.length !== 6}
            className="boton-spray min-h-11 w-full justify-center gap-2 text-sm disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("cuentaConfirmarBoton")}
          </button>
          <div className="flex flex-wrap justify-between gap-2 text-[11px]">
            <button type="button" onClick={() => void reenviar()} className="text-primary underline-offset-4 hover:underline">
              {t("cuentaConfirmarReenviar")}
            </button>
            <button
              type="button"
              onClick={() => {
                setModoInicial();
                setCorreo(pendiente.correo);
              }}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("cuentaConfirmarCambiar")}
            </button>
          </div>
        </form>
      ) : cuenta ? (
        <div className="space-y-3">
          {eliminada && (
            <p className="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-[11px] text-primary">
              {t("cuentaEliminada")}
            </p>
          )}

          {/* Ficha: quién sos y en qué estado está la cuenta. */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-3.5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20"
                style={{ backgroundImage: "var(--gradiente-marca)" }}
              >
                {(cuenta.usuario[0] ?? "b").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span className="truncate">@{cuenta.usuario}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      premium ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-background/60 text-muted-foreground"
                    }`}
                  >
                    {premium ? t("cuentaPremiumTitulo") : t("cuentaBeneficioGratis").split(":")[0]}
                  </span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{cuenta.correo}</p>
              </div>
              <button
                type="button"
                onClick={salir}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
              >
                <LogOut className="h-3 w-3" aria-hidden /> {t("cuentaSalir")}
              </button>
            </div>
            {!debeCambiar && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navegarA("demo");
                }}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95"
              >
                <Headphones className="h-3 w-3" aria-hidden /> {t("cuentaIrDemo")}
              </button>
            )}
          </div>

          {debeCambiar && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <KeyRound className="h-3.5 w-3.5 text-amber-500" aria-hidden /> {t("cuentaDebeCambiarTitulo")}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("cuentaDebeCambiarTexto")}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-500">{t("cuentaDebeCambiarBloqueo")}</p>
            </div>
          )}

          {!debeCambiar && premium && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Gem className="h-3.5 w-3.5" aria-hidden /> {t("cuentaPremiumTitulo")}
              </p>
              <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-foreground">{premium}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{t("cuentaPremiumNota")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => void copiar(premium)} className={chico}>
                  {copiado === premium ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                  {copiado === premium ? t("cuentaCopiado") : t("cuentaCopiar")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("bitly-premium", { detail: premium }));
                    setActivado(true);
                  }}
                  disabled={activado}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  <Check className="h-3 w-3" /> {activado ? t("cuentaActivado") : t("cuentaActivar")}
                </button>
              </div>
            </div>
          )}

          {/* Códigos comprados: el propio, los entregados y los que faltan. */}
          {!debeCambiar && grupos.length > 0 && (
            <div className="rounded-2xl border border-border bg-background/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Send className="h-3.5 w-3.5 text-primary" aria-hidden /> {t("cuentaCodigosTitulo")}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("cuentaCodigosDesc")}</p>
              <ul className="mt-2 space-y-2">
                {grupos.map((grupo) => (
                  <li key={grupo.folio} className="rounded-xl border border-border/60 bg-card/40 p-2.5">
                    <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono font-bold text-foreground">{grupo.folio}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 font-semibold ${COLOR[grupo.estado] ?? ""}`}>
                        {t(`pagoEstado_${grupo.estado}`)}
                      </span>
                    </p>
                    <ul className="mt-1.5 space-y-2">
                      {grupo.codigos.map((c) => (
                        <li key={c.codigo} className="rounded-lg border border-border/50 bg-background/50 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {c.estado === "propio"
                                ? t("cuentaCodigoPropio")
                                : c.estado === "asignado"
                                  ? t("cuentaCodigoAsignado").replace("{correo}", c.correo ?? "")
                                  : t("cuentaCodigoLibre")}
                            </span>
                            {c.estado === "asignado" && (
                              <span
                                className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                                  c.aceptada
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-amber-500/40 bg-amber-500/10 text-amber-500"
                                }`}
                              >
                                {c.aceptada ? t("cuentaCodigoAceptado") : t("cuentaCodigoPendiente")}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void copiar(c.codigo)}
                              aria-label={t("cuentaCopiar")}
                              className="ml-auto text-muted-foreground hover:text-foreground"
                            >
                              {copiado === c.codigo ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                            </button>
                          </div>

                          {c.estado === "libre" && (
                            <div className="mt-2 space-y-1.5">
                              {asignacion?.codigo === c.codigo ? (
                                <>
                                  <input
                                    type="email"
                                    value={asignacion.correo}
                                    onChange={(e) => setAsignacion({ ...asignacion, correo: e.target.value })}
                                    placeholder="amigo@correo.com"
                                    aria-label={t("cuentaAsignarCorreo")}
                                    className={`${input} min-h-9 text-xs`}
                                  />
                                  <div className="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void asignar()}
                                      disabled={asignacion.ocupado || !asignacion.correo.trim()}
                                      className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
                                    >
                                      {asignacion.ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                      {t("cuentaAsignarEnviar")}
                                    </button>
                                    <button type="button" onClick={() => setAsignacion(null)} className={chico}>
                                      {t("cuentaRevocarNo")}
                                    </button>
                                  </div>
                                  {asignacion.error && (
                                    <p className="text-[10px] text-destructive">{asignacion.error}</p>
                                  )}
                                  {asignacion.resultado && (
                                    <div className="rounded-lg bg-primary/10 px-2 py-1.5 text-[10px] text-primary">
                                      <p>
                                        {asignacion.resultado.enviado
                                          ? t("cuentaAsignarListo").replace("{correo}", asignacion.resultado.correo)
                                          : t("cuentaAsignarSinCorreo")}
                                      </p>
                                      {asignacion.resultado.clave && (
                                        <p className="mt-1 break-all font-mono">
                                          {t("cuentaAsignarCredenciales")
                                            .replace("{usuario}", asignacion.resultado.usuario)
                                            .replace("{clave}", asignacion.resultado.clave)}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAsignacion({ folio: grupo.folio, codigo: c.codigo, correo: "", error: null, ocupado: false, resultado: null });
                                    setError(null);
                                  }}
                                  className={chico}
                                >
                                  <UserPlus className="h-3 w-3" /> {t("cuentaAsignarBoton")}
                                </button>
                              )}
                            </div>
                          )}

                          {c.estado === "asignado" && c.asignacionId && !c.aceptada && (
                            revocarId === c.asignacionId ? (
                              <div className="mt-2 space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2">
                                <p className="text-[10px] leading-relaxed text-destructive">{t("cuentaRevocarAviso")}</p>
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void revocar(c.asignacionId ?? "")}
                                    className="rounded-full bg-destructive px-2.5 py-1 text-[10px] font-semibold text-destructive-foreground"
                                  >
                                    {t("cuentaRevocarSi")}
                                  </button>
                                  <button type="button" onClick={() => setRevocarId(null)} className={chico}>
                                    {t("cuentaRevocarNo")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRevocarId(c.asignacionId ?? null);
                                  setError(null);
                                }}
                                className="mt-1.5 text-[10px] font-semibold text-destructive underline-offset-4 hover:underline"
                              >
                                {t("cuentaRevocar")}
                              </button>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rescate sin pérdida: los canales de la app, administrables desde la
              cuenta. Lo guardado se pide recién al abrir el panel. */}
          <div className="rounded-2xl border border-border bg-background/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Wrench className="h-3.5 w-3.5 text-primary" aria-hidden /> {t("cuentaRescateTitulo")}
            </p>

            {!rescate ? (
              <>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("cuentaRescateDesc")}</p>
                <button type="button" onClick={() => void abrirRescate()} className={`${chico} mt-2`}>
                  <Wrench className="h-3 w-3" /> {t("cuentaRescateAbrir")}
                </button>
              </>
            ) : rescate.cargando ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t("cuentaRescateCargando")}
              </p>
            ) : (
              <div className="mt-2 space-y-2.5">
                <div>
                  <label
                    htmlFor="rescate-espejos"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t("cuentaRescateEspejos")}
                  </label>
                  <textarea
                    id="rescate-espejos"
                    value={rescate.espejos}
                    onChange={(e) => setRescate({ ...rescate, espejos: e.target.value })}
                    rows={3}
                    spellCheck={false}
                    disabled={rescate.espejosApagados}
                    className={`${input} mt-1 min-h-20 resize-y py-2 font-mono text-[11px] disabled:opacity-50`}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {t("cuentaRescateEspejosAyuda")}
                  </p>
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rescate.espejosApagados}
                      onChange={(e) =>
                        setRescate({
                          ...rescate,
                          espejosApagados: e.target.checked,
                          // Apagados y una lista propia se contradicen: la lista manda.
                          espejos: e.target.checked ? "" : rescate.espejos,
                        })
                      }
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {t("cuentaRescateApagados")}
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="rescate-arcod"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t("cuentaRescateArcod")}
                  </label>
                  <input
                    id="rescate-arcod"
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    value={rescate.arcod}
                    onChange={(e) => setRescate({ ...rescate, arcod: e.target.value, arcodApagado: false })}
                    placeholder="https://mi-arcod.example"
                    disabled={rescate.arcodApagado}
                    className={`${input} mt-1 min-h-9 text-xs disabled:opacity-50`}
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rescate.arcodApagado}
                      onChange={(e) =>
                        setRescate({
                          ...rescate,
                          arcodApagado: e.target.checked,
                          arcod: e.target.checked ? "" : rescate.arcod,
                        })
                      }
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {t("cuentaRescateApagado")}
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="rescate-monochrome"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t("cuentaRescateMonochrome")}
                  </label>
                  <input
                    id="rescate-monochrome"
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    value={rescate.monochrome}
                    onChange={(e) =>
                      setRescate({ ...rescate, monochrome: e.target.value, monochromeApagado: false })
                    }
                    placeholder="https://mi-monochrome.example"
                    disabled={rescate.monochromeApagado}
                    className={`${input} mt-1 min-h-9 text-xs disabled:opacity-50`}
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rescate.monochromeApagado}
                      onChange={(e) =>
                        setRescate({
                          ...rescate,
                          monochromeApagado: e.target.checked,
                          monochrome: e.target.checked ? "" : rescate.monochrome,
                        })
                      }
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {t("cuentaRescateApagado")}
                  </label>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {t("cuentaRescateInstanciaAyuda")}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="rescate-relay"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t("cuentaRescateRelay")}
                  </label>
                  <select
                    id="rescate-relay"
                    value={rescate.relay}
                    onChange={(e) => setRescate({ ...rescate, relay: e.target.value as Rescate["relay"] })}
                    className={`${input} mt-1 min-h-9 text-xs`}
                  >
                    <option value="sin">{t("cuentaRescateSinTocar")}</option>
                    <option value="on">{t("cuentaRescateEncendido")}</option>
                    <option value="off">{t("cuentaRescateApagado")}</option>
                  </select>
                </div>

                <p className="text-[10px] leading-relaxed text-muted-foreground">{t("cuentaRescateNota")}</p>

                {rescate.aviso && (
                  <p className="rounded-lg bg-primary/10 px-2 py-1.5 text-[10px] text-primary">{rescate.aviso}</p>
                )}
                {rescate.error && <p className="text-[10px] text-destructive">{rescate.error}</p>}

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void guardarRescateCuenta()}
                    disabled={rescate.guardando}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {rescate.guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {t("cuentaRescateGuardar")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void borrarRescateCuenta()}
                    disabled={rescate.borrando}
                    className={chico}
                  >
                    {rescate.borrando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    {t("cuentaRescateBorrar")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Seguridad: los dos cambios piden un código al correo. */}
          <div className="rounded-2xl border border-border bg-background/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> {t("cuentaSeguridad")}
            </p>

            {!cambio ? (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCambio({ tipo: "clave", etapa: "pedir", codigo: "", aviso: null, error: null, ocupado: false })}
                  className={chico}
                >
                  <KeyRound className="h-3 w-3" /> {t("cuentaCambiarClave")}
                </button>
                <button
                  type="button"
                  onClick={() => setCambio({ tipo: "usuario", etapa: "pedir", codigo: "", aviso: null, error: null, ocupado: false })}
                  className={chico}
                >
                  <AtSign className="h-3 w-3" /> {t("cuentaCambiarUsuario")}
                </button>
              </div>
            ) : cambio.etapa === "pedir" ? (
              <div className="mt-2 space-y-2">
                {cambio.tipo === "usuario" ? (
                  <label className="block text-[10px] text-muted-foreground">
                    {t("cuentaUsuarioNuevo")}
                    <input
                      value={nuevoUsuario}
                      onChange={(e) => setNuevoUsuario(e.target.value.toLowerCase())}
                      placeholder={cuenta.usuario}
                      maxLength={20}
                      className={`mt-1 ${input} min-h-9 text-xs`}
                    />
                    <span className="mt-1 block text-[9px]">{t("cuentaUsuarioAyuda")}</span>
                  </label>
                ) : (
                  <>
                    <label className="block text-[10px] text-muted-foreground">
                      {t("cuentaClaveActual")}
                      <input
                        type="password"
                        value={claveActual}
                        onChange={(e) => setClaveActual(e.target.value)}
                        autoComplete="current-password"
                        className={`mt-1 ${input} min-h-9 text-xs`}
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-[10px] text-muted-foreground">
                        {t("cuentaClaveNueva")}
                        <input
                          type="password"
                          value={claveNueva}
                          onChange={(e) => setClaveNueva(e.target.value)}
                          minLength={8}
                          autoComplete="new-password"
                          className={`mt-1 ${input} min-h-9 text-xs`}
                        />
                      </label>
                      <label className="block text-[10px] text-muted-foreground">
                        {t("cuentaClaveRepetir")}
                        <input
                          type="password"
                          value={claveRepetida}
                          onChange={(e) => setClaveRepetida(e.target.value)}
                          minLength={8}
                          autoComplete="new-password"
                          className={`mt-1 ${input} min-h-9 text-xs`}
                        />
                      </label>
                    </div>
                  </>
                )}
                {cambio.error && <p className="text-[10px] text-destructive">{cambio.error}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void pedirCodigo(cambio.tipo)}
                    disabled={cambio.ocupado || (cambio.tipo === "usuario" && nuevoUsuario.trim().length < 3)}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {cambio.ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    {t("cuentaEnviarCodigo")}
                  </button>
                  {!debeCambiar && (
                    <button type="button" onClick={() => setCambio(null)} className={chico}>
                      {t("cuentaVolver")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {cambio.aviso && <p className="text-[10px] leading-relaxed text-primary">{cambio.aviso}</p>}
                <label className="block text-[10px] text-muted-foreground">
                  {t("cuentaCambioCodigo")}
                  <input
                    value={cambio.codigo}
                    onChange={(e) => setCambio({ ...cambio, codigo: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className={`mt-1 text-center font-mono tracking-[0.3em] ${input} min-h-9 text-sm`}
                  />
                </label>
                {cambio.error && <p className="text-[10px] text-destructive">{cambio.error}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void confirmarElCambio()}
                    disabled={cambio.ocupado || cambio.codigo.length !== 6}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {cambio.ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {t("cuentaConfirmarCambio")}
                  </button>
                  {!debeCambiar && (
                    <button type="button" onClick={() => setCambio(null)} className={chico}>
                      {t("cuentaRevocarNo")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {!debeCambiar && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("cuentaPedidos")}
            </p>
            {pedidos.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-background/30 p-5 text-center text-xs text-muted-foreground">
                {t("cuentaSinPedidos")}
              </p>
            ) : (
              <ul className="space-y-2">
                {pedidos.map((p) => (
                  <li key={p.folio} className="rounded-2xl border border-border bg-background/40 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-foreground">{p.folio}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COLOR[p.estado] ?? ""}`}>
                        {t(`pagoEstado_${p.estado}`)}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {p.creado ? new Date(p.creado).toLocaleDateString() : ""}
                      </span>
                    </div>
                    {p.nota && <p className="mt-1 text-[11px] text-muted-foreground">{p.nota}</p>}
                    {!p.codigo && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <PackageSearch className="h-3 w-3" aria-hidden /> {t("cuentaSinCodigo")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

          {error && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>
          )}

          {/* Baja: libera el código y avisa al dueño. */}
          {!debeCambiar && (
          <div className="rounded-2xl border border-border/70 bg-background/30 p-3">
            {!baja ? (
              <button
                type="button"
                onClick={() => setBaja({ clave: "", error: null, ocupado: false })}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive underline-offset-4 hover:underline"
              >
                <Trash2 className="h-3 w-3" /> {t("cuentaEliminar")}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("cuentaEliminarAviso")}</p>
                <label className="block text-[10px] text-muted-foreground">
                  {t("cuentaEliminarClave")}
                  <input
                    type="password"
                    value={baja.clave}
                    onChange={(e) => setBaja({ ...baja, clave: e.target.value })}
                    autoComplete="current-password"
                    className={`mt-1 ${input} min-h-9 text-xs`}
                  />
                </label>
                {baja.error && <p className="text-[10px] text-destructive">{baja.error}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void eliminar()}
                    disabled={baja.ocupado || !baja.clave}
                    className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-semibold text-destructive-foreground disabled:opacity-50"
                  >
                    {baja.ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    {t("cuentaEliminarSi")}
                  </button>
                  <button type="button" onClick={() => setBaja(null)} className={chico}>
                    {t("cuentaEliminarNo")}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {eliminada && (
            <p className="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-[11px] text-primary">
              {t("cuentaEliminada")}
            </p>
          )}

          <div role="tablist" className="flex gap-1 rounded-full border border-border bg-background/40 p-1">
            {(["login", "registro"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={paso === id}
                onClick={() => {
                  setPaso(id);
                  setError(null);
                }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  paso === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {id === "login" ? <LogIn className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                {id === "login" ? t("cuentaEntrar") : t("cuentaCrear")}
              </button>
            ))}
          </div>

          <ul className="space-y-1.5 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5">
            <li className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <Headphones className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                <strong className="font-semibold text-foreground">{t("cuentaBeneficioGratis")}</strong>
                <span className="mt-0.5 block">{t("cuentaBeneficioCalidad")}</span>
              </span>
            </li>
          </ul>

          <form onSubmit={paso === "login" ? entrar : registrar} className="space-y-3">
            {paso === "registro" && (
              <label className="block text-[11px] font-medium text-muted-foreground">
                {t("cuentaUsuarioOpcional")}
                <input
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value.toLowerCase())}
                  maxLength={20}
                  autoComplete="username"
                  placeholder={t("cuentaUsuarioOpcionalAyuda")}
                  className={`mt-1 ${input}`}
                />
              </label>
            )}
            <label className="block text-[11px] font-medium text-muted-foreground">
              {paso === "login" ? t("cuentaCorreoOCuenta") : t("cuentaCorreo")}
              <input
                type={paso === "login" ? "text" : "email"}
                value={paso === "login" ? identificador : correo}
                onChange={(e) => (paso === "login" ? setIdentificador(e.target.value) : setCorreo(e.target.value))}
                maxLength={120}
                autoComplete={paso === "login" ? "username" : "email"}
                required
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              {t("cuentaClave")}
              <input
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                minLength={paso === "registro" ? 8 : 1}
                maxLength={200}
                autoComplete={paso === "registro" ? "new-password" : "current-password"}
                required
                className={`mt-1 ${input}`}
              />
            </label>
            {paso === "registro" && (
              <label className="block text-[11px] font-medium text-muted-foreground">
                {t("cuentaClaveRepetir")}
                <input
                  type="password"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  minLength={8}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                  className={`mt-1 ${input}`}
                />
              </label>
            )}
            {error && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>
            )}
            <button
              type="submit"
              disabled={guardando}
              className="boton-spray min-h-11 w-full justify-center gap-2 text-sm disabled:opacity-50"
            >
              {guardando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : paso === "login" ? (
                <LogIn className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {paso === "login" ? t("cuentaEntrarBoton") : t("cuentaCrearBoton")}
            </button>
          </form>
          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">{t("cuentaNota")}</p>
        </div>
      )}
    </ModalWrapper>
  );
}
