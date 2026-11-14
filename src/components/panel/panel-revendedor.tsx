import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  ClipboardCopy,
  Gem,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShoppingBag,
  Users,
  Wallet,
} from "lucide-react";
import {
  guardarTokenCuenta,
  leerTokenCuenta,
  quitarTokenCuenta,
} from "@/lib/cuentas-cliente";
import { iniciarSesion } from "@/server/cuentas";
import {
  panelRevendedor,
  type ClienteRevendedor,
  type PedidoRevendedor,
} from "@/server/revendedores";

type Datos = Extract<Awaited<ReturnType<typeof panelRevendedor>>, { ok: true }>;

function dinero(n: number): string {
  return `Bs ${new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 }).format(n || 0)}`;
}

function fecha(iso: string): string {
  const d = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "-";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

const COLOR_ESTADO: Record<string, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  revision: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  pagado: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  enviado: "border-primary/40 bg-primary/10 text-primary",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
};

const input =
  "min-h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

function Acceso({ onEntrar }: { onEntrar: (token: string) => void }) {
  const [identificador, setIdentificador] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    setError("");
    try {
      const r = await iniciarSesion({ data: { identificador, clave } });
      if (!r.ok) {
        setError(
          r.motivo === "baneada"
            ? "Esta cuenta está dada de baja."
            : r.motivo === "limite"
              ? "Demasiados intentos. Esperá unos minutos."
              : r.motivo === "sin_confirmar"
                ? "Falta confirmar el correo."
                : "Correo o contraseña incorrectos.",
        );
        return;
      }
      guardarTokenCuenta(r.token);
      onEntrar(r.token);
    } catch {
      setError("No pudimos entrar. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10 text-foreground">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm rounded-2xl border border-border/70 bg-card/70 p-5 backdrop-blur"
      >
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
          <Link2 className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Panel de revendedor</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Entrá con la cuenta que el dueño inscribió como revendedora.
        </p>

        <label className="mt-4 block text-[11px] text-muted-foreground">
          Correo o usuario
          <input
            className={`${input} mt-1`}
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="mt-3 block text-[11px] text-muted-foreground">
          Contraseña
          <input
            className={`${input} mt-1`}
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
          Entrar
        </button>
        <a
          href="/"
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Volver al sitio
        </a>
      </form>
    </div>
  );
}

function Tarjeta({
  icono,
  valor,
  etiqueta,
}: {
  icono: React.ReactNode;
  valor: string;
  etiqueta: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        {icono}
        {etiqueta}
      </span>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums leading-none">{valor}</p>
    </div>
  );
}

function Pedidos({ pedidos }: { pedidos: PedidoRevendedor[] }) {
  if (pedidos.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Todavía no hay pedidos con tu enlace.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[11px]">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Folio</th>
            <th className="py-1.5 pr-2 font-medium">Cliente</th>
            <th className="py-1.5 pr-2 font-medium">Fecha</th>
            <th className="py-1.5 pr-2 font-medium">Estado</th>
            <th className="py-1.5 pr-2 text-right font-medium">Cant.</th>
            <th className="py-1.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => (
            <tr key={p.folio} className="border-t border-border/40">
              <td className="py-1.5 pr-2 font-mono text-[10px]">{p.folio}</td>
              <td className="py-1.5 pr-2">
                <span className="block truncate">{p.cliente || "Invitado"}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{p.correo || p.celular}</span>
              </td>
              <td className="py-1.5 pr-2 text-muted-foreground">{fecha(p.creado)}</td>
              <td className="py-1.5 pr-2">
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${COLOR_ESTADO[p.estado] ?? COLOR_ESTADO.pendiente}`}>
                  {p.estado}
                </span>
                {p.entregado && <span className="ml-1 text-[10px] text-primary">entregado</span>}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{p.cantidad}</td>
              <td className="py-1.5 text-right tabular-nums">{dinero(p.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Clientes({ clientes }: { clientes: ClienteRevendedor[] }) {
  if (clientes.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Todavía no hay clientes atribuidos.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[11px]">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Usuario</th>
            <th className="py-1.5 pr-2 font-medium">Correo</th>
            <th className="py-1.5 pr-2 font-medium">Alta</th>
            <th className="py-1.5 text-right font-medium">Premium</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.correo} className="border-t border-border/40">
              <td className="py-1.5 pr-2">{c.usuario || "-"}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{c.correo}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{fecha(c.creado)}</td>
              <td className="py-1.5 text-right">
                {c.baneada ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                    <Ban className="h-3 w-3" aria-hidden /> baneado
                  </span>
                ) : c.eliminada ? (
                  <span className="text-[10px] text-muted-foreground">baja</span>
                ) : c.premium ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                    <Gem className="h-3 w-3" aria-hidden /> activo
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">sin premium</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PanelRevendedor() {
  const [token, setToken] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [motivo, setMotivo] = useState<"no_revendedor" | "inactivo" | "servidor" | null>(null);
  const [estadoInactivo, setEstadoInactivo] = useState<string>("");
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    setToken(leerTokenCuenta());
    setListo(true);
  }, []);

  const cargar = useCallback(async (usado: string | null) => {
    if (!usado) return;
    setCargando(true);
    setMotivo(null);
    try {
      const r = await panelRevendedor({ data: { token: usado } });
      if (r.ok) {
        setDatos(r);
        return;
      }
      if (r.motivo === "sesion") {
        quitarTokenCuenta();
        setToken(null);
        setDatos(null);
        return;
      }
      if (r.motivo === "inactivo") {
        setEstadoInactivo(r.estado ?? "");
        setMotivo("inactivo");
      } else {
        setMotivo(r.motivo);
      }
      setDatos(null);
    } catch {
      setMotivo("servidor");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (listo && token) void cargar(token);
  }, [listo, token, cargar]);

  const salir = () => {
    quitarTokenCuenta();
    setToken(null);
    setDatos(null);
    setMotivo(null);
  };

  const copiar = async () => {
    if (!datos) return;
    const enlace = `${window.location.origin}/?ref=${encodeURIComponent(datos.revendedor.slug)}`;
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // sin clipboard: el enlace se muestra igual en pantalla
    }
  };

  if (!listo) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!token) return <Acceso onEntrar={setToken} />;

  if (motivo) {
    const texto =
      motivo === "no_revendedor"
        ? "Esta cuenta no está inscripta como revendedora. Pedile al dueño que la agregue desde el panel."
        : motivo === "inactivo"
          ? `Tu cuenta de revendedor está ${estadoInactivo || "inactiva"}. El dueño tiene que reactivarla.`
          : "No pudimos cargar tu panel. Probá de nuevo en un rato.";
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/70 p-5 text-center">
          <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
            <Ban className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-base font-semibold">Panel de revendedor</h1>
          <p className="mt-2 text-xs text-muted-foreground">{texto}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void cargar(token)}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Reintentar
            </button>
            <a href="/" className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[11px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" aria-hidden /> Ir al sitio
            </a>
            <button
              type="button"
              onClick={salir}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3 w-3" aria-hidden /> Salir
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!datos) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const enlace = `/?ref=${datos.revendedor.slug}`;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-3 pb-12 pt-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 backdrop-blur">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Link2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{datos.revendedor.nombre}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Revendedor @{datos.revendedor.slug} · comisión {datos.revendedor.comision}%
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void cargar(token)}
              disabled={cargando}
              aria-label="Actualizar panel"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            <a
              href="/"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">Ver sitio</span>
            </a>
            <button
              type="button"
              onClick={salir}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </header>

        <section className="mb-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tu enlace de referido</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background/70 px-2 py-1.5 text-[11px]">
              {enlace}
            </code>
            <button
              type="button"
              onClick={() => void copiar()}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary px-3 text-[10px] font-semibold text-primary-foreground"
            >
              {copiado ? <Check className="h-3 w-3" aria-hidden /> : <ClipboardCopy className="h-3 w-3" aria-hidden />}
              {copiado ? "Copiado" : "Copiar enlace"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Todo pedido y toda cuenta que llegue por este enlace queda a tu nombre. Los códigos Premium
            los entrega el sistema al validarse el pago: no los verás ni podrás repartirlos a mano.
          </p>
        </section>

        <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tarjeta icono={<ShoppingBag className="h-3 w-3" aria-hidden />} valor={String(datos.resumen.pedidos)} etiqueta="Pedidos" />
          <Tarjeta icono={<Wallet className="h-3 w-3" aria-hidden />} valor={dinero(datos.resumen.ventas)} etiqueta="Ventas" />
          <Tarjeta icono={<Users className="h-3 w-3" aria-hidden />} valor={String(datos.resumen.clientes)} etiqueta="Clientes" />
          <Tarjeta icono={<Gem className="h-3 w-3" aria-hidden />} valor={String(datos.resumen.premiumActivos)} etiqueta="Premium activos" />
        </section>

        <section className="mb-3 rounded-2xl border border-border/70 bg-card/60 p-3">
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <ShoppingBag className="h-3.5 w-3.5 text-primary" aria-hidden /> Pedidos con tu enlace
          </h2>
          <Pedidos pedidos={datos.pedidos} />
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/60 p-3">
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <Users className="h-3.5 w-3.5 text-primary" aria-hidden /> Tus clientes
          </h2>
          <Clientes clientes={datos.clientes} />
        </section>
      </div>
    </div>
  );
}
