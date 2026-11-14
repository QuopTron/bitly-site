import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Ban,
  Check,
  ClipboardCopy,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  X,
} from "lucide-react";
import {
  adminRevendedores,
  banearRevendedor,
  cambiarEstadoRevendedor,
  crearRevendedor,
  type RevendedorAdmin,
} from "@/server/revendedores";

function dinero(n: number): string {
  return `Bs ${new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 }).format(n || 0)}`;
}

function fecha(iso: string): string {
  const d = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "-";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

const ESTADO_CLASE: Record<string, string> = {
  activo: "border-primary/40 bg-primary/10 text-primary",
  suspendido: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  baneado: "border-destructive/40 bg-destructive/10 text-destructive",
};

const MOTIVOS: Record<string, string> = {
  datos: "Revisá el correo y el slug (3-32 letras, números o guiones).",
  sin_cuenta: "Ese correo no tiene una cuenta activa en el sitio.",
  ya_es_revendedor: "Esa cuenta ya es revendedora.",
  slug_ocupado: "Ese slug ya está en uso.",
  no_encontrado: "Ese revendedor ya no existe.",
  servidor: "No se pudo guardar. Probá de nuevo.",
};

export default function AdminRevendedores({ codigo }: { codigo: string }) {
  const [lista, setLista] = useState<RevendedorAdmin[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [correo, setCorreo] = useState("");
  const [slug, setSlug] = useState("");
  const [nombre, setNombre] = useState("");
  const [comision, setComision] = useState("10");
  const [creando, setCreando] = useState(false);

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [baneando, setBaneando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!codigo) return;
    setCargando(true);
    setError(false);
    try {
      const r = await adminRevendedores({ data: { admin: codigo } });
      if (r.ok) setLista(r.revendedores);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (creando) return;
    setCreando(true);
    setAviso(null);
    try {
      const r = await crearRevendedor({
        data: {
          admin: codigo,
          correo: correo.trim(),
          slug: slug.trim(),
          nombre: nombre.trim(),
          comision: Number(comision) || 0,
        },
      });
      if (!r.ok) {
        setAviso({ tipo: "error", texto: MOTIVOS[r.motivo] ?? MOTIVOS.servidor });
        return;
      }
      setAviso({
        tipo: "ok",
        texto: `Revendedor @${r.revendedor.slug} creado. Su enlace ya está activo.`,
      });
      setCorreo("");
      setSlug("");
      setNombre("");
      setComision("10");
      await cargar();
    } catch {
      setAviso({ tipo: "error", texto: MOTIVOS.servidor });
    } finally {
      setCreando(false);
    }
  };

  const cambiar = async (r: RevendedorAdmin, estado: "activo" | "suspendido") => {
    if (ocupado) return;
    setOcupado(r.id);
    setAviso(null);
    try {
      const res = await cambiarEstadoRevendedor({ data: { admin: codigo, id: r.id, estado } });
      if (!res.ok) {
        setAviso({ tipo: "error", texto: MOTIVOS[res.motivo] ?? MOTIVOS.servidor });
        return;
      }
      setAviso({
        tipo: "ok",
        texto: estado === "activo" ? `@${r.slug} reactivado.` : `@${r.slug} suspendido.`,
      });
      await cargar();
    } catch {
      setAviso({ tipo: "error", texto: MOTIVOS.servidor });
    } finally {
      setOcupado(null);
    }
  };

  const banear = async (r: RevendedorAdmin) => {
    if (baneando) return;
    setBaneando(r.id);
    setAviso(null);
    try {
      const res = await banearRevendedor({
        data: { admin: codigo, id: r.id, motivo: motivo.trim() },
      });
      if (!res.ok) {
        setAviso({ tipo: "error", texto: MOTIVOS[res.motivo] ?? MOTIVOS.servidor });
        return;
      }
      setAviso({
        tipo: "ok",
        texto: `@${r.slug} baneado: ${res.cuentasBaneadas} cuenta(s), ${res.pedidosCancelados} pedido(s) cancelado(s), ${res.codigosRevocados} código(s) revocado(s)${
          res.registroApp ? ` y ${res.registroApp} cancelado(s) en la app` : ""
        }.`,
      });
      setBaneando(null);
      setMotivo("");
      await cargar();
    } catch {
      setAviso({ tipo: "error", texto: MOTIVOS.servidor });
    } finally {
      setBaneando(null);
    }
  };

  const copiar = async (slug: string) => {
    const enlace = `${window.location.origin}/?ref=${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(slug);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      setAviso({ tipo: "error", texto: `Copiá a mano: ${enlace}` });
    }
  };

  const input =
    "min-h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus-visible:border-primary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-primary" aria-hidden />
          Revendedores: <strong className="text-foreground">{lista.length}</strong>
        </span>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
          Actualizar
        </button>
      </div>

      <form onSubmit={crear} className="rounded-2xl border border-border/60 bg-background/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <UserPlus className="h-3.5 w-3.5 text-primary" aria-hidden />
          Inscribir un revendedor
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[10px] text-muted-foreground">
            Correo de su cuenta
            <input
              className={input}
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="vendedor@correo.com"
              required
            />
          </label>
          <label className="text-[10px] text-muted-foreground">
            Slug del enlace
            <input
              className={input}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="juan10 (opcional)"
            />
          </label>
          <label className="text-[10px] text-muted-foreground">
            Nombre visible
            <input
              className={input}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Juan (opcional)"
            />
          </label>
          <label className="text-[10px] text-muted-foreground">
            Comisión %
            <input
              className={input}
              type="number"
              min={0}
              max={100}
              value={comision}
              onChange={(e) => setComision(e.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={creando}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Crear revendedor
        </button>
        <p className="mt-2 text-[10px] text-muted-foreground">
          La cuenta tiene que existir. Su enlace será <strong className="text-foreground">/?ref=slug</strong> y
          todo pedido que llegue por ahí queda atribuido a esta persona.
        </p>
      </form>

      {aviso && (
        <p className={`text-[11px] ${aviso.tipo === "ok" ? "text-primary" : "text-destructive"}`}>
          {aviso.texto}
        </p>
      )}
      {error && !cargando && (
        <p className="py-6 text-center text-xs text-destructive">No pudimos cargar los revendedores.</p>
      )}
      {cargando && lista.length === 0 && (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando revendedores.
        </p>
      )}

      <ul className="space-y-2">
        {lista.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <Link2 className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {r.nombre} <span className="text-muted-foreground">@{r.slug}</span>
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {r.correo} · comisión {r.comision}% · desde {fecha(r.creado)}
                </p>
              </div>
              <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] ${ESTADO_CLASE[r.estado] ?? ESTADO_CLASE.activo}`}>
                {r.estado}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-border/50 bg-background/50 px-2 py-1.5">
                <p className="text-sm font-semibold tabular-nums">{r.pedidos}</p>
                <p className="text-[10px] text-muted-foreground">Pedidos</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-background/50 px-2 py-1.5">
                <p className="text-sm font-semibold tabular-nums">{dinero(r.ventas)}</p>
                <p className="text-[10px] text-muted-foreground">Ventas</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-background/50 px-2 py-1.5">
                <p className="text-sm font-semibold tabular-nums">{r.clientes}</p>
                <p className="text-[10px] text-muted-foreground">Clientes</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-background/50 px-2 py-1.5">
                <p className="text-sm font-semibold tabular-nums">{r.premiumActivos}</p>
                <p className="text-[10px] text-muted-foreground">Premium activos</p>
              </div>
            </div>

            {r.estado === "baneado" && r.motivoBaneo && (
              <p className="mt-2 text-[10px] text-destructive">Motivo: {r.motivoBaneo}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void copiar(r.slug)}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-background/60 px-2.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copiado === r.slug ? <Check className="h-3 w-3 text-primary" aria-hidden /> : <ClipboardCopy className="h-3 w-3" aria-hidden />}
                {copiado === r.slug ? "Copiado" : "Copiar enlace"}
              </button>

              {r.estado === "activo" ? (
                <button
                  type="button"
                  onClick={() => void cambiar(r, "suspendido")}
                  disabled={Boolean(ocupado)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 text-[10px] text-amber-500 disabled:opacity-50"
                >
                  <ShieldOff className="h-3 w-3" aria-hidden /> Suspender
                </button>
              ) : r.estado === "suspendido" ? (
                <button
                  type="button"
                  onClick={() => void cambiar(r, "activo")}
                  disabled={Boolean(ocupado)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-[10px] text-primary disabled:opacity-50"
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden /> Reactivar
                </button>
              ) : null}

              {r.estado !== "baneado" && (baneando === r.id ? (
                <div className="flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 p-2">
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo del baneo (opcional)"
                    className="min-h-8 flex-1 rounded-lg border border-border bg-background/70 px-2 text-[11px] outline-none focus-visible:border-destructive"
                  />
                  <button
                    type="button"
                    onClick={() => void banear(r)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-destructive px-2.5 text-[10px] font-semibold text-white"
                  >
                    <Ban className="h-3 w-3" aria-hidden /> Banear y dar de baja a sus clientes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBaneando(null);
                      setMotivo("");
                    }}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-[10px] text-muted-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden /> Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBaneando(r.id);
                    setMotivo("");
                  }}
                  className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 text-[10px] text-destructive"
                >
                  <Ban className="h-3 w-3" aria-hidden /> Banear
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {!cargando && !error && lista.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Todavía no hay revendedores. Inscribí el primero arriba.
        </p>
      )}
    </div>
  );
}
