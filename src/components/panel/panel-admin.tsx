import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  CircleDollarSign,
  Clock3,
  Eye,
  Gem,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import AdminCuentas from "@/components/modals/admin-cuentas";
import AdminPedidos from "@/components/modals/admin-pedidos";
import { guardarSesionAdmin, leerSesionAdmin, olvidarSesionAdmin, type SesionAdmin } from "@/lib/admin-cliente";
import { entrarPanel } from "@/server/admin";
import {
  crearEgreso,
  eliminarEgreso,
  listarEgresos,
  probarCanales,
  resumenPanel,
  type Egreso,
  type ResumenPanel,
} from "@/server/panel";
import type { PruebaCanal } from "@/server/rescate";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const CATEGORIAS = ["servicios", "publicidad", "herramientas", "comisiones", "equipo", "impuestos", "otros"];

function numero(n: number): string {
  return new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 }).format(n ?? 0);
}

function dinero(n: number): string {
  return `Bs ${numero(Math.round((n ?? 0) * 100) / 100)}`;
}

function fechaCorta(iso: string): string {
  const d = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "—";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

function etiquetaMes(mes: string): string {
  const m = Number(mes.slice(5, 7));
  return MESES[m - 1] ?? mes;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── Acceso ─────────────────────────────────────────────────────────────── */

const MOTIVO: Record<string, string> = {
  clave: "Correo o clave incorrectos.",
  cupo: "Demasiados intentos seguidos. Probá de nuevo en unos minutos.",
  datos: "Completá el correo y la clave.",
  servidor: "No pudimos entrar. Probá de nuevo en un rato.",
};

function Acceso({ onEntrar }: { onEntrar: (sesion: SesionAdmin) => void }) {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cargando) return;
    setCargando(true);
    setError("");
    try {
      const r = await entrarPanel({ data: { correo, clave } });
      if (r.ok) onEntrar({ token: r.token, expira: r.expira, correo: r.correo });
      else setError(MOTIVO[r.motivo] ?? MOTIVO.servidor);
    } catch {
      setError(MOTIVO.servidor);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%), radial-gradient(40% 40% at 85% 100%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <LayoutDashboard className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">Panel del dueño</h1>
            <p className="mt-1 text-xs text-muted-foreground">Ingresos, egresos, pedidos y usuarios de Bitly.</p>
          </div>

          <form onSubmit={enviar} className="space-y-3">
            <label className="block text-[11px] font-medium text-muted-foreground">
              Correo
              <input
                type="email"
                name="correo"
                autoComplete="username"
                autoFocus
                required
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="tu@correo.com"
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Clave
              <input
                type="password"
                name="clave"
                autoComplete="current-password"
                required
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="••••••••"
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {error}
              </p>
            )}

            <button type="submit" disabled={cargando} className="boton-spray min-h-11 w-full gap-2 text-sm disabled:opacity-60">
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
              {cargando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>

        <a
          href="/"
          className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Volver al sitio
        </a>
      </div>
    </div>
  );
}

/* ── Piezas del resumen ─────────────────────────────────────────────────── */

function Kpi({
  Icono,
  etiqueta,
  valor,
  detalle,
  tono = "primary",
}: {
  Icono: ComponentType<{ className?: string }>;
  etiqueta: string;
  valor: string;
  detalle?: string;
  tono?: "primary" | "destructive" | "sky" | "amber" | "violet";
}) {
  const color = {
    primary: "text-primary bg-primary/10 ring-primary/25",
    destructive: "text-destructive bg-destructive/10 ring-destructive/25",
    sky: "text-sky-400 bg-sky-400/10 ring-sky-400/25",
    amber: "text-amber-400 bg-amber-400/10 ring-amber-400/25",
    violet: "text-violet-400 bg-violet-400/10 ring-violet-400/25",
  }[tono];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{etiqueta}</p>
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ${color}`}>
          <Icono className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums leading-none">{valor}</p>
      {detalle && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function Mini({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

function Grafico({ meses }: { meses: ResumenPanel["ingresos"]["porMes"] }) {
  const max = Math.max(1, ...meses.flatMap((m) => [m.ingresos, m.egresos]));
  return (
    <div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Ingresos
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden /> Egresos
        </span>
      </div>
      <div className="mt-3 flex h-36 items-end gap-2 sm:gap-4">
        {meses.map((m) => (
          <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <span
                title={`Ingresos ${etiquetaMes(m.mes)}: ${dinero(m.ingresos)}`}
                className="w-2.5 rounded-t-md bg-primary/90 transition-all sm:w-3.5"
                style={{ height: `${Math.max(m.ingresos > 0 ? 3 : 0, (m.ingresos / max) * 100)}%` }}
              />
              <span
                title={`Egresos ${etiquetaMes(m.mes)}: ${dinero(m.egresos)}`}
                className="w-2.5 rounded-t-md bg-destructive/80 transition-all sm:w-3.5"
                style={{ height: `${Math.max(m.egresos > 0 ? 3 : 0, (m.egresos / max) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] uppercase text-muted-foreground">{etiquetaMes(m.mes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Salud de los canales de audio, probada desde el Worker. */
function Canales({ token }: { token: string }) {
  const [pruebas, setPruebas] = useState<PruebaCanal[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const probar = async () => {
    if (cargando) return;
    setCargando(true);
    setError("");
    try {
      const r = await probarCanales({ data: { admin: token } });
      if (r.ok) setPruebas(r.pruebas);
      else setError("No pudimos probar los canales.");
    } catch {
      setError("No pudimos probar los canales.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Salud de los canales de audio</h2>
        <button
          type="button"
          onClick={() => void probar()}
          disabled={cargando}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
          {cargando ? "Probando…" : "Probar ahora"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Se prueba desde el servidor del sitio con «Bohemian Rhapsody»: si un canal falla acá, la demo lo va a extrañar.
      </p>
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      {pruebas && (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {pruebas.map((p) => (
            <li
              key={p.canal}
              className={`rounded-xl border px-2.5 py-1.5 text-[11px] ${
                p.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.ok ? "bg-primary" : "bg-destructive"}`} aria-hidden />
                <strong className="text-foreground">{p.canal}</strong>
                <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">{p.ms} ms</span>
              </span>
              <span className="mt-0.5 block break-words text-[10px] text-muted-foreground">{p.detalle}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Resumen({ datos, onEgresos, token }: { datos: ResumenPanel; onEgresos: () => void; token: string }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi Icono={TrendingUp} etiqueta="Ingresos del mes" valor={dinero(datos.ingresos.mes)} detalle={`Total: ${dinero(datos.ingresos.total)}`} />
        <Kpi Icono={TrendingDown} etiqueta="Egresos del mes" valor={dinero(datos.egresos.mes)} detalle={`Total: ${dinero(datos.egresos.total)}`} tono="destructive" />
        <Kpi Icono={Wallet} etiqueta="Balance del mes" valor={dinero(datos.balance.mes)} detalle={`Histórico: ${dinero(datos.balance.total)}`} tono={datos.balance.mes >= 0 ? "primary" : "destructive"} />
        <Kpi Icono={Clock3} etiqueta="Por cobrar" valor={dinero(datos.ingresos.porCobrar)} detalle="Pedidos pendientes o en revisión" tono="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Últimos 6 meses</h2>
            <button
              type="button"
              onClick={onEgresos}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Receipt className="h-3 w-3" aria-hidden /> Cargar egreso
            </button>
          </div>
          <Grafico meses={datos.ingresos.porMes} />
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <h2 className="mb-3 text-sm font-semibold">Números rápidos</h2>
          <div className="grid grid-cols-2 gap-2">
            <Mini etiqueta="Pedidos cobrados" valor={numero(datos.ingresos.pedidos)} />
            <Mini etiqueta="Ticket promedio" valor={dinero(datos.ingresos.ticket)} />
            <Mini etiqueta="Usuarios" valor={numero(datos.cuentas.total)} />
            <Mini etiqueta="Premium" valor={numero(datos.cuentas.premium)} />
            <Mini etiqueta="En línea" valor={numero(datos.cuentas.enLinea)} />
            <Mini etiqueta="Nuevos del mes" valor={numero(datos.cuentas.nuevasMes)} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Eye className="h-4 w-4 text-primary" aria-hidden /> Sitio
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Mini etiqueta="Vistas" valor={numero(datos.trafico.vistas)} />
            <Mini etiqueta="Descargas" valor={numero(datos.trafico.descargas)} />
            <Mini etiqueta="Opiniones" valor={numero(datos.trafico.opiniones)} />
            <Mini etiqueta="Sesiones" valor={numero(datos.trafico.sesiones)} />
            <Mini etiqueta="Activas 24 h" valor={numero(datos.trafico.activas24h)} />
            <Mini etiqueta="Tiempo prom." valor={`${numero(datos.trafico.segundosPromedio)} s`} />
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/60 p-4 lg:col-span-2">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <CircleDollarSign className="h-4 w-4 text-primary" aria-hidden /> Últimos movimientos
          </h2>
          {datos.movimientos.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Todavía no hay ingresos ni egresos cargados.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {datos.movimientos.slice(0, 10).map((m, i) => (
                <li key={`${m.tipo}-${m.fecha}-${i}`} className="flex items-center gap-2 py-2 text-[11px]">
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      m.tipo === "ingreso" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                    }`}
                    aria-hidden
                  >
                    {m.tipo === "ingreso" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{m.titulo}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{m.detalle}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{fechaCorta(m.fecha)}</span>
                  <span
                    className={`w-24 shrink-0 text-right font-semibold tabular-nums ${
                      m.tipo === "ingreso" ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {m.tipo === "ingreso" ? "+" : "−"} {dinero(m.monto)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Canales token={token} />
    </div>
  );
}

/* ── Egresos ────────────────────────────────────────────────────────────── */

function Egresos({ token, onCambio }: { token: string; onCambio: () => void }) {
  const [lista, setLista] = useState<Egreso[]>([]);
  const [cargando, setCargando] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [fecha, setFecha] = useState(hoy);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState("");
  const [confirmar, setConfirmar] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await listarEgresos({ data: { admin: token } });
      if (r) setLista(r);
    } catch {
      /* el aviso lo da el resumen */
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const agregar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setAviso(null);
    try {
      const r = await crearEgreso({
        data: { admin: token, concepto, monto: Number(monto.replace(",", ".")), categoria, fecha },
      });
      if (r.ok) {
        setConcepto("");
        setMonto("");
        setCategoria(CATEGORIAS[0]);
        setFecha(hoy());
        setAviso({ tipo: "ok", texto: "Egreso guardado." });
        await cargar();
        onCambio();
      } else {
        setAviso({
          tipo: "error",
          texto:
            r.motivo === "datos"
              ? "Revisá el concepto, el monto (mayor que 0) y la fecha."
              : "No se pudo guardar. Probá de nuevo.",
        });
      }
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo guardar. Probá de nuevo." });
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (id: string) => {
    setBorrando(id);
    setAviso(null);
    try {
      const r = await eliminarEgreso({ data: { admin: token, id } });
      if (r.ok) {
        setLista((l) => l.filter((x) => x.id !== id));
        setConfirmar("");
        onCambio();
      } else {
        setAviso({ tipo: "error", texto: "No se pudo borrar. Probá de nuevo." });
      }
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo borrar. Probá de nuevo." });
    } finally {
      setBorrando("");
    }
  };

  const total = lista.reduce((s, e) => s + (Number(e.monto) || 0), 0);

  return (
    <div className="space-y-4">
      <form onSubmit={agregar} className="rounded-2xl border border-border/70 bg-card/60 p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Plus className="h-4 w-4 text-primary" aria-hidden /> Nuevo egreso
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-[11px] font-medium text-muted-foreground sm:col-span-2">
            Concepto
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              required
              maxLength={80}
              placeholder="Ej.: hosting y dominio"
              className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus-visible:border-primary"
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Monto (Bs)
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              required
              inputMode="decimal"
              placeholder="150"
              className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm tabular-nums outline-none focus-visible:border-primary"
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Categoría
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/70 px-2 text-sm capitalize outline-none focus-visible:border-primary"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Fecha
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
              className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background/70 px-2 text-sm outline-none focus-visible:border-primary"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={guardando} className="boton-spray min-h-9 gap-1.5 px-3 text-[11px] disabled:opacity-50">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
            Agregar egreso
          </button>
          {aviso && (
            <p className={`text-[11px] ${aviso.tipo === "ok" ? "text-primary" : "text-destructive"}`}>{aviso.texto}</p>
          )}
        </div>
      </form>

      <section className="rounded-2xl border border-border/70 bg-card/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold">Egresos cargados ({lista.length})</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Total: <strong className="tabular-nums text-destructive">{dinero(total)}</strong>
            </span>
            <button
              type="button"
              onClick={() => void cargar()}
              disabled={cargando}
              aria-label="Actualizar egresos"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden /> Actualizar
            </button>
          </div>
        </div>

        {lista.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            {cargando ? "Cargando…" : "Todavía no cargaste egresos."}
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {lista.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[11px]">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive" aria-hidden>
                  <Receipt className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{e.concepto}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {fechaCorta(e.fecha)} · <span className="capitalize">{e.categoria}</span>
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-destructive">{dinero(e.monto)}</span>
                {confirmar === e.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void borrar(e.id)}
                      disabled={borrando === e.id}
                      className="rounded-full bg-destructive px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      {borrando === e.id ? "…" : "Borrar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmar("")}
                      className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmar(e.id)}
                    aria-label={`Borrar ${e.concepto}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

type Tab = "resumen" | "pedidos" | "usuarios" | "egresos";

const TABS: { id: Tab; label: string; Icono: ComponentType<{ className?: string }> }[] = [
  { id: "resumen", label: "Resumen", Icono: LayoutDashboard },
  { id: "pedidos", label: "Pedidos", Icono: ShoppingBag },
  { id: "usuarios", label: "Usuarios", Icono: Users },
  { id: "egresos", label: "Egresos", Icono: Receipt },
];

function Panel({ sesion, onSalir }: { sesion: SesionAdmin; onSalir: () => void }) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [datos, setDatos] = useState<ResumenPanel | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(false);
    try {
      const r = await resumenPanel({ data: { admin: sesion.token } });
      if (r) setDatos(r);
      else {
        // Token vencido o clave cambiada: se vuelve al acceso.
        onSalir();
        return;
      }
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [sesion.token, onSalir]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="relative min-h-[100dvh] bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-60"
        style={{
          background:
            "radial-gradient(50% 100% at 20% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-3 pb-12 pt-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 backdrop-blur">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <LayoutDashboard className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Panel Bitly</p>
            <p className="truncate text-[10px] text-muted-foreground">{sesion.correo || "Administrador"}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void cargar()}
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
              onClick={onSalir}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label="Cerrar sesión del panel"
            >
              <LogOut className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </header>

        <nav role="tablist" aria-label="Secciones del panel" className="mb-4 flex gap-1 overflow-x-auto rounded-full border border-border bg-background/50 p-1">
          {TABS.map(({ id, label, Icono }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[11px] font-medium transition-colors ${
                tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </nav>

        {tab === "resumen" && (
          <>
            {!datos && cargando && (
              <p className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando el panel…
              </p>
            )}
            {!datos && error && !cargando && (
              <p className="py-16 text-center text-xs text-destructive">No pudimos cargar el resumen. Probá con Actualizar.</p>
            )}
            {datos && <Resumen datos={datos} onEgresos={() => setTab("egresos")} token={sesion.token} />}
          </>
        )}

        {tab === "pedidos" && (
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
            <AdminPedidos codigo={sesion.token} />
          </section>
        )}

        {tab === "usuarios" && (
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
            <AdminCuentas codigo={sesion.token} />
          </section>
        )}

        {tab === "egresos" && <Egresos token={sesion.token} onCambio={() => void cargar()} />}

        <footer className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
          <Gem className="h-3 w-3" aria-hidden /> Panel privado de Bitly · los datos salen del repo privado
        </footer>
      </div>
    </div>
  );
}

export default function PanelAdmin() {
  const [sesion, setSesion] = useState<SesionAdmin | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    setSesion(leerSesionAdmin());
    setListo(true);
  }, []);

  const entrar = (s: SesionAdmin) => {
    guardarSesionAdmin(s);
    setSesion(s);
  };

  const salir = useCallback(() => {
    olvidarSesionAdmin();
    setSesion(null);
  }, []);

  if (!listo) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (!sesion) return <Acceso onEntrar={entrar} />;
  return <Panel sesion={sesion} onSalir={salir} />;
}
