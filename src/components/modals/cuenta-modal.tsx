import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ClipboardCopy,
  Gem,
  Headphones,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  PackageSearch,
  User,
  UserPlus,
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
  iniciarSesion,
  miCuenta,
  registrarCuenta,
  type CuentaPublica,
  type PedidoDeCuenta,
} from "@/server/cuentas";

type Props = {
  open: boolean;
  onClose: () => void;
};

const COLOR: Record<string, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

const input =
  "min-h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

export default function CuentaModal({ open, onClose }: Props) {
  const t = useI18n();
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [cuenta, setCuenta] = useState<CuentaPublica | null>(null);
  const [pedidos, setPedidos] = useState<PedidoDeCuenta[]>([]);
  const [premium, setPremium] = useState<{ codigo: string; estado: string } | null>(null);
  const [activado, setActivado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async (token: string) => {
    setCargando(true);
    try {
      const r = await miCuenta({ data: { token } });
      if (!r.ok) {
        quitarTokenCuenta();
        setCuenta(null);
        setPedidos([]);
        setPremium(null);
        return;
      }
      setCuenta(r.cuenta);
      setPedidos(r.pedidos);
      setPremium(r.premium ? { codigo: r.premium.codigo, estado: r.premium.estado } : null);
    } catch {
      setError(i18n("cuentaErrorServidor"));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setModo("login");
    setClave("");
    setRepetir("");
    const token = leerTokenCuenta();
    if (token) void cargar(token);
    else {
      setCuenta(null);
      setPedidos([]);
    }
  }, [open, cargar]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await iniciarSesion({ data: { correo, clave } });
      if (!r.ok) {
        setError(
          r.motivo === "limite"
            ? t("cuentaErrorLimite")
            : r.motivo === "servidor"
              ? t("cuentaErrorServidor")
              : t("cuentaErrorCredenciales"),
        );
        return;
      }
      guardarTokenCuenta(r.token);
      setCuenta(r.cuenta);
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
      const r = await registrarCuenta({ data: { nombre, correo, clave } });
      if (!r.ok) {
        setError(
          r.motivo === "existe"
            ? t("cuentaErrorExiste")
            : r.motivo === "limite"
              ? t("cuentaErrorLimite")
              : r.motivo === "servidor"
                ? t("cuentaErrorServidor")
                : t("cuentaErrorDatos"),
        );
        return;
      }
      guardarTokenCuenta(r.token);
      setCuenta(r.cuenta);
      setPedidos([]);
      setNombre("");
      setCorreo("");
      setClave("");
      setRepetir("");
    } catch {
      setError(t("cuentaErrorServidor"));
    } finally {
      setGuardando(false);
    }
  };

  const salir = () => {
    quitarTokenCuenta();
    setCuenta(null);
    setPedidos([]);
    setPremium(null);
    setActivado(false);
    setError(null);
    setModo("login");
  };

  const copiar = async (codigo: string) => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(codigo);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      // sin portapapeles
    }
  };

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("cuentaTitulo")}
      subtitle={cuenta ? cuenta.correo : t("cuentaDesc")}
      icon={<User className="h-5 w-5 text-primary" />}
      ancho="amplio"
    >
      {cargando && !cuenta ? (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("cuentaCargando")}
        </p>
      ) : cuenta ? (
        <div className="space-y-3">
          {/* Ficha de la cuenta: quién sos, qué te habilita y por dónde seguir. */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-3.5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20"
                style={{ backgroundImage: "var(--gradiente-marca)" }}
              >
                {(cuenta.nombre.trim()[0] ?? "B").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {t("cuentaHola").replace("{nombre}", cuenta.nombre)}
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
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Gem className="mt-px h-3 w-3 shrink-0 text-primary" aria-hidden />
              {t("cuentaBienvenida").replace("{nombre}", cuenta.nombre.split(" ")[0] ?? cuenta.nombre)}
            </p>
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
          </div>

          {/* Premium de la cuenta: el código que el admin cargó en el pedido.
              Se puede copiar o activar en este dispositivo sin ir a la demo. */}
          {premium && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Gem className="h-3.5 w-3.5" aria-hidden /> {t("cuentaPremiumTitulo")}
              </p>
              <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-foreground">
                {premium.codigo}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">{t("cuentaPremiumNota")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void copiar(premium.codigo)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground"
                >
                  {copiado === premium.codigo ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                  {copiado === premium.codigo ? t("cuentaCopiado") : t("cuentaCopiar")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // La demo escucha este evento y guarda el código: quien
                    // activa acá ya no tiene que pegarlo en el reproductor.
                    window.dispatchEvent(new CustomEvent("bitly-premium", { detail: premium.codigo }));
                    setActivado(true);
                  }}
                  disabled={activado}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  <Check className="h-3 w-3" />
                  {activado ? t("cuentaActivado") : t("cuentaActivar")}
                </button>
              </div>
            </div>
          )}

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
                    {p.codigo ? (
                      <div className="mt-2 rounded-xl border border-primary/30 bg-primary/10 p-2.5">
                        <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                          <KeyRound className="h-3 w-3" aria-hidden /> {t("cuentaCodigo")}
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] text-foreground">{p.codigo}</p>
                        <button
                          type="button"
                          onClick={() => void copiar(p.codigo ?? "")}
                          className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground"
                        >
                          {copiado === p.codigo ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                          {copiado === p.codigo ? t("cuentaCopiado") : t("cuentaCopiar")}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <PackageSearch className="h-3 w-3" aria-hidden /> {t("cuentaSinCodigo")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div role="tablist" className="flex gap-1 rounded-full border border-border bg-background/40 p-1">
            {(["login", "registro"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={modo === id}
                onClick={() => {
                  setModo(id);
                  setError(null);
                }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  modo === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {id === "login" ? <LogIn className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                {id === "login" ? t("cuentaEntrar") : t("cuentaCrear")}
              </button>
            ))}
          </div>

          {/* Qué gana quien se registra —y qué queda para Premium—, sin letra chica. */}
          <ul className="space-y-1.5 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5">
            <li className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <Headphones className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                <strong className="font-semibold text-foreground">{t("cuentaBeneficioGratis")}</strong>
                <span className="mt-0.5 block">{t("cuentaBeneficioCalidad")}</span>
              </span>
            </li>
          </ul>

          <form onSubmit={modo === "login" ? entrar : registrar} className="space-y-3">
            {modo === "registro" && (
              <label className="block text-[11px] font-medium text-muted-foreground">
                {t("cuentaNombre")}
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  maxLength={60}
                  autoComplete="name"
                  required
                  className={`mt-1 ${input}`}
                />
              </label>
            )}
            <label className="block text-[11px] font-medium text-muted-foreground">
              {t("cuentaCorreo")}
              <input
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                maxLength={120}
                autoComplete="email"
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
                minLength={modo === "registro" ? 8 : 1}
                maxLength={200}
                autoComplete={modo === "registro" ? "new-password" : "current-password"}
                required
                className={`mt-1 ${input}`}
              />
            </label>
            {modo === "registro" && (
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
              ) : modo === "login" ? (
                <LogIn className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {modo === "login" ? t("cuentaEntrarBoton") : t("cuentaCrearBoton")}
            </button>
          </form>
          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">{t("cuentaNota")}</p>
        </div>
      )}
    </ModalWrapper>
  );
}
