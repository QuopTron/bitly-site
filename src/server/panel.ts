/**
 * Datos del panel del dueño: ingresos, egresos, cuentas y tráfico.
 *
 * Todo se calcula en el servidor y sólo se entrega con un token de admin válido
 * (ver `src/server/admin.ts`). Los egresos son lo único que se escribe desde el
 * panel; viven en `data/egresos.json` del repo privado, como el resto.
 */

import { createServerFn } from "@tanstack/react-start";
import { adminValido } from "./admin";
import type { CuentaGuardada } from "./cuentas";
import type { PruebaCanal } from "./rescate";
import { getJson, leerStats, putJson } from "@/server/github-store";

const ARCHIVO_EGRESOS = "data/egresos.json";
const ARCHIVO_PEDIDOS = "data/pedidos.json";
const ARCHIVO_CUENTAS = "data/cuentas.json";
const ARCHIVO_ANALYTICS = "data/analytics.json";
const MAX_EGRESOS = 2_000;

export type Egreso = {
  id: string;
  concepto: string;
  monto: number;
  categoria: string;
  /** Día del gasto, `YYYY-MM-DD`. */
  fecha: string;
  creado: string;
};

export type MesPanel = { mes: string; ingresos: number; egresos: number };

export type Movimiento = {
  tipo: "ingreso" | "egreso";
  titulo: string;
  detalle: string;
  monto: number;
  fecha: string;
};

export type ResumenPanel = {
  ingresos: {
    total: number;
    mes: number;
    pedidos: number;
    porCobrar: number;
    ticket: number;
    porMes: MesPanel[];
  };
  egresos: { total: number; mes: number };
  balance: { total: number; mes: number };
  cuentas: { total: number; premium: number; enLinea: number; nuevasMes: number };
  trafico: {
    vistas: number;
    descargas: number;
    opiniones: number;
    sesiones: number;
    activas24h: number;
    segundosPromedio: number;
  };
  movimientos: Movimiento[];
};

export type ResultadoEgreso = { ok: true } | { ok: false; motivo: "admin" | "datos" | "servidor" };

type PedidoCrudo = {
  folio?: string;
  nombre?: string;
  estado?: string;
  total?: number;
  cantidad?: number;
  creado?: string;
  actualizado?: string;
};

type CuentaCruda = {
  creado?: string;
  eliminada?: boolean;
  codigo?: string | null;
  ultimaActividad?: string;
  ultimoAcceso?: string;
};

const CATEGORIAS = [
  "servicios",
  "publicidad",
  "herramientas",
  "comisiones",
  "equipo",
  "impuestos",
  "otros",
] as const;

const ESTADOS_COBRADOS = new Set(["pagado", "enviado"]);
const ESTADOS_POR_COBRAR = new Set(["pendiente", "revision"]);

/** Primer día del mes, en UTC, como `YYYY-MM`. */
function mesDe(iso: unknown): string {
  const texto = String(iso ?? "");
  const fecha = Date.parse(texto);
  if (!Number.isFinite(fecha)) return "";
  return new Date(fecha).toISOString().slice(0, 7);
}

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Los últimos `n` meses, del más viejo al actual, incluido el actual. */
function ultimosMeses(n: number): string[] {
  const ahora = new Date();
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  return meses;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

async function leerEgresos(): Promise<Egreso[]> {
  const lista = await getJson<Egreso[]>("datos", ARCHIVO_EGRESOS, []);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((e) => e && typeof e.id === "string")
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creado < b.creado ? 1 : -1));
}

export const resumenPanel = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResumenPanel | null> => {
    if (!(await adminValido(data?.admin))) return null;
    try {
      const [pedidos, cuentas, egresos, stats, vistas, opiniones, analytics] = await Promise.all([
        getJson<PedidoCrudo[]>("datos", ARCHIVO_PEDIDOS, []),
        getJson<CuentaCruda[]>("datos", ARCHIVO_CUENTAS, []),
        leerEgresos(),
        leerStats(),
        getJson<{ visitas?: number }>("datos", "data/vistas.json", { visitas: 0 }),
        getJson<unknown[]>("datos", "data/opiniones.json", []),
        getJson<{ sesiones?: Record<string, { ultimo?: string; segundos?: number }> }>(
          "datos",
          ARCHIVO_ANALYTICS,
          { sesiones: {} },
        ),
      ]);

      const mes = mesActual();
      const meses = ultimosMeses(6);
      const porMes: MesPanel[] = meses.map((m) => ({ mes: m, ingresos: 0, egresos: 0 }));

      let totalIngresos = 0;
      let mesIngresos = 0;
      let pagados = 0;
      let porCobrar = 0;
      const movimientos: Movimiento[] = [];

      for (const p of Array.isArray(pedidos) ? pedidos : []) {
        const estado = String(p.estado ?? "");
        const monto = Number(p.total) || 0;
        if (ESTADOS_COBRADOS.has(estado)) {
          totalIngresos += monto;
          pagados++;
          const m = mesDe(p.actualizado || p.creado);
          if (m === mes) mesIngresos += monto;
          const fila = porMes.find((x) => x.mes === m);
          if (fila) fila.ingresos += monto;
          movimientos.push({
            tipo: "ingreso",
            titulo: p.folio ? `Pedido ${p.folio}` : "Pedido",
            detalle: `${p.nombre || "Sin nombre"} · ${Number(p.cantidad) || 1} código${Number(p.cantidad) === 1 ? "" : "s"}`,
            monto,
            fecha: p.actualizado || p.creado || "",
          });
        } else if (ESTADOS_POR_COBRAR.has(estado)) {
          porCobrar += monto;
        }
      }

      let totalEgresos = 0;
      let mesEgresos = 0;
      for (const e of egresos) {
        const monto = Number(e.monto) || 0;
        totalEgresos += monto;
        if (e.fecha.slice(0, 7) === mes) mesEgresos += monto;
        const fila = porMes.find((x) => x.mes === e.fecha.slice(0, 7));
        if (fila) fila.egresos += monto;
        movimientos.push({
          tipo: "egreso",
          titulo: e.concepto,
          detalle: e.categoria,
          monto,
          fecha: e.fecha,
        });
      }

      movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

      const listaCuentas = (Array.isArray(cuentas) ? cuentas : []).filter((c) => c && !c.eliminada);
      const actividadLimite = Date.now() - 6 * 60 * 1000;
      const sesiones = Object.values(analytics?.sesiones ?? {});
      let segundos = 0;
      let activas24h = 0;
      const ahora = Date.now();
      for (const s of sesiones) {
        segundos += Number(s.segundos) || 0;
        if (Number.isFinite(Date.parse(String(s.ultimo ?? ""))) && ahora - Date.parse(String(s.ultimo)) < 86_400_000) {
          activas24h++;
        }
      }

      const descargas = Object.entries(stats)
        .filter(([clave, valor]) => clave !== "actualizado" && typeof valor === "number")
        .reduce((total, [, valor]) => total + (Number(valor) || 0), 0);

      return {
        ingresos: {
          total: redondear(totalIngresos),
          mes: redondear(mesIngresos),
          pedidos: pagados,
          porCobrar: redondear(porCobrar),
          ticket: pagados ? redondear(totalIngresos / pagados) : 0,
          porMes: porMes.map((m) => ({ ...m, ingresos: redondear(m.ingresos), egresos: redondear(m.egresos) })),
        },
        egresos: { total: redondear(totalEgresos), mes: redondear(mesEgresos) },
        balance: {
          total: redondear(totalIngresos - totalEgresos),
          mes: redondear(mesIngresos - mesEgresos),
        },
        cuentas: {
          total: listaCuentas.length,
          premium: listaCuentas.filter((c) => Boolean(c.codigo)).length,
          enLinea: listaCuentas.filter((c) => {
            const t = Date.parse(String(c.ultimaActividad || c.ultimoAcceso || ""));
            return Number.isFinite(t) && t > actividadLimite;
          }).length,
          nuevasMes: listaCuentas.filter((c) => mesDe(c.creado) === mes).length,
        },
        trafico: {
          vistas: Number(vistas.visitas) || 0,
          descargas,
          opiniones: Array.isArray(opiniones) ? opiniones.length : 0,
          sesiones: sesiones.length,
          activas24h,
          segundosPromedio: sesiones.length ? Math.round(segundos / sesiones.length) : 0,
        },
        movimientos: movimientos.slice(0, 24),
      };
    } catch (e) {
      console.error("[panel] no se pudo armar el resumen:", e instanceof Error ? e.message : e);
      return null;
    }
  });

export const listarEgresos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<Egreso[] | null> => {
    if (!(await adminValido(data?.admin))) return null;
    try {
      return await leerEgresos();
    } catch {
      return null;
    }
  });

function idEgreso(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `eg-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const crearEgreso = createServerFn({ method: "POST" })
  .validator(
    (d: { admin?: unknown; concepto?: unknown; monto?: unknown; categoria?: unknown; fecha?: unknown }) => d,
  )
  .handler(async ({ data }): Promise<ResultadoEgreso> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };

    const concepto = String(data?.concepto ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80);
    const monto = Number(data?.monto);
    const categoria = String(data?.categoria ?? "").trim().toLowerCase();
    const fecha = String(data?.fecha ?? "").trim();

    if (
      concepto.length < 2 ||
      !Number.isFinite(monto) ||
      monto <= 0 ||
      monto > 1_000_000 ||
      !(CATEGORIAS as readonly string[]).includes(categoria) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !Number.isFinite(Date.parse(`${fecha}T00:00:00Z`))
    ) {
      return { ok: false, motivo: "datos" };
    }

    try {
      const lista = await leerEgresos();
      const nuevo: Egreso = {
        id: idEgreso(),
        concepto,
        monto: redondear(monto),
        categoria,
        fecha,
        creado: new Date().toISOString(),
      };
      const siguiente = [nuevo, ...lista].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, MAX_EGRESOS);
      const ok = await putJson(
        "datos",
        ARCHIVO_EGRESOS,
        siguiente,
        `panel: egreso ${nuevo.id} (${concepto})`,
      );
      return ok ? { ok: true } : { ok: false, motivo: "servidor" };
    } catch (e) {
      console.error("[panel] no se pudo guardar el egreso:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const eliminarEgreso = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; id?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoEgreso> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    const id = String(data?.id ?? "").trim();
    if (!/^eg-[a-f0-9]{12}$/.test(id)) return { ok: false, motivo: "datos" };
    try {
      const lista = await leerEgresos();
      const siguiente = lista.filter((e) => e.id !== id);
      if (siguiente.length === lista.length) return { ok: false, motivo: "datos" };
      const ok = await putJson("datos", ARCHIVO_EGRESOS, siguiente, `panel: elimina egreso ${id}`);
      return ok ? { ok: true } : { ok: false, motivo: "servidor" };
    } catch (e) {
      console.error("[panel] no se pudo borrar el egreso:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Verificación de personas y códigos ──────────────────────────────────
 *
 * Una persona escribe "no me anda el código" o "¿mi cuenta existe?" y el dueño
 * necesita una respuesta de un vistazo, no recorrer la lista a ojo. Se busca
 * por correo, usuario, código o folio y se devuelve TODO lo que coincide:
 * cuentas, pedidos y el estado real de cada código (activo, usado, cancelado,
 * liberado), con la cuenta que lo tiene.
 *
 * Solo lectura: no canjea ni asigna nada. El dueño mira; la app sigue siendo la
 * única que marca un código como usado.
 */

export type CuentaHallada = {
  id: string;
  usuario: string;
  correo: string;
  premium: boolean;
  codigo: string | null;
  correoConfirmado: boolean;
  invitada: boolean;
  baneada: boolean;
  eliminada: boolean;
  creado: string;
  ultimaActividad: string;
};

export type EstadoCodigoPanel =
  | "activo"
  | "usado"
  | "cancelado"
  | "liberado"
  | "no_encontrado"
  | "desconocido";

export type CodigoHallado = {
  codigo: string;
  estado: EstadoCodigoPanel;
  /** De dónde sale el estado: del registro de la app o de los emitidos acá. */
  origen: "sitio" | "registro" | null;
  usuario: string | null;
  correo: string | null;
  pedido: string | null;
  emitido: string | null;
};

export type PedidoHallado = {
  folio: string;
  nombre: string;
  correo: string;
  estado: string;
  cantidad: number;
  total: number;
  creado: string;
};

export type ResultadoBusquedaPanel =
  | {
      ok: true;
      consulta: string;
      totalCuentas: number;
      cuentas: CuentaHallada[];
      codigos: CodigoHallado[];
      pedidos: PedidoHallado[];
    }
  | { ok: false; motivo: "admin" | "datos" | "servidor" };

export type ResultadoCanales =
  | { ok: true; pruebas: PruebaCanal[] }
  | { ok: false; motivo: "admin" | "servidor" };

/**
 * Salud de los canales de audio, probada DESDE el Worker.
 *
 * El dueño ve qué canal contesta y cuál está caído sin tener que abrir la demo
 * ni adivinar: es la diferencia entre "esa canción no está" y "ese canal no
 * responde" cuando alguien escribe diciendo que no le suena nada.
 */
export const probarCanales = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoCanales> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    try {
      const { probarCanalesDemo } = await import("./rescate");
      return { ok: true, pruebas: await probarCanalesDemo() };
    } catch (e) {
      console.error("[panel] no se pudieron probar los canales:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

type CuentaVerificada = {
  id?: string;
  usuario?: string;
  correo?: string;
  codigo?: string | null;
  codigoLiberado?: string | null;
  correoConfirmado?: boolean;
  origen?: string;
  baneada?: boolean;
  eliminada?: boolean;
  creado?: string;
  ultimaActividad?: string;
  ultimoAcceso?: string;
  premiumPedido?: string;
};

type PedidoVerificado = {
  folio?: string;
  nombre?: string;
  correo?: string;
  codigo?: string | null;
  estado?: string;
  cantidad?: number;
  total?: number;
  creado?: string;
};

/** Estados del registro de la app → vocabulario del panel. */
const ESTADOS_REGISTRO: Record<string, EstadoCodigoPanel> = {
  activo: "activo",
  usado: "usado",
  cancelado: "cancelado",
  libre: "liberado",
};

const normalizar = (v: unknown): string => String(v ?? "").trim().toLowerCase();

export const buscarEnPanel = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; consulta?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoBusquedaPanel> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    const consulta = String(data?.consulta ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 140);
    if (consulta.length < 2) return { ok: false, motivo: "datos" };
    const q = consulta.toLowerCase();

    try {
      const [cuentasCrudas, pedidosCrudos] = await Promise.all([
        getJson<CuentaVerificada[]>("datos", ARCHIVO_CUENTAS, []),
        getJson<PedidoVerificado[]>("datos", ARCHIVO_PEDIDOS, []),
      ]);
      const { usuarioDe } = await import("./cuentas");

      const todas = (Array.isArray(cuentasCrudas) ? cuentasCrudas : []).filter(
        (c): c is CuentaVerificada => Boolean(c) && typeof c.id === "string",
      );
      const cuentas: CuentaHallada[] = todas
        .map((c) => ({
          id: String(c.id),
          usuario: usuarioDe(c as CuentaGuardada),
          correo: normalizar(c.correo),
          premium: Boolean(c.codigo),
          codigo: c.codigo ?? null,
          correoConfirmado: Boolean(c.correoConfirmado ?? true),
          invitada: c.origen === "invitada",
          baneada: Boolean(c.baneada),
          eliminada: Boolean(c.eliminada),
          creado: String(c.creado ?? ""),
          ultimaActividad: String(c.ultimaActividad || c.ultimoAcceso || ""),
        }))
        .filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.usuario.toLowerCase().includes(q) ||
            c.correo.includes(q) ||
            normalizar(c.codigo).includes(q),
        )
        .sort((a, b) => (a.creado < b.creado ? 1 : -1));

      const pedidos: PedidoHallado[] = (Array.isArray(pedidosCrudos) ? pedidosCrudos : [])
        .filter(
          (p) =>
            Boolean(p) &&
            (normalizar(p.folio).includes(q) ||
              normalizar(p.nombre).includes(q) ||
              normalizar(p.correo).includes(q) ||
              normalizar(p.codigo).includes(q)),
        )
        .map((p) => ({
          folio: String(p.folio ?? ""),
          nombre: String(p.nombre ?? ""),
          correo: normalizar(p.correo),
          estado: normalizar(p.estado),
          cantidad: Number(p.cantidad) || 1,
          total: Number(p.total) || 0,
          creado: String(p.creado ?? ""),
        }))
        .slice(0, 12);

      // Candidatos a código: lo que se escribió (si tiene pinta de código), los
      // que aparecen en los pedidos/cuentas encontrados y los que emitió el
      // sitio y coinciden con el texto.
      const candidatos = new Set<string>();
      if (consulta.length >= 12) candidatos.add(consulta);
      for (const pedido of pedidosCrudos) {
        if (!pedido) continue;
        const coincide =
          normalizar(pedido.folio).includes(q) ||
          normalizar(pedido.nombre).includes(q) ||
          normalizar(pedido.correo).includes(q) ||
          normalizar(pedido.codigo).includes(q);
        if (coincide && pedido.codigo && candidatos.size < 10) candidatos.add(String(pedido.codigo));
      }
      for (const c of cuentas.slice(0, 6)) {
        if (c.codigo && candidatos.size < 10) candidatos.add(c.codigo);
      }

      const [{ listarEmitidos }, { leerRegistroCodigos }, { codigosAsignados }] = await Promise.all([
        import("./codigos-emitidos"),
        import("@/lib/premium-check"),
        import("./cuentas"),
      ]);

      const emitidos = await listarEmitidos();
      for (const e of emitidos) {
        if (candidatos.size >= 10) break;
        if (normalizar(e.codigo).includes(q)) candidatos.add(e.codigo);
      }

      const registro = await leerRegistroCodigos().catch(() => null);
      const dueños = await codigosAsignados().catch(() => new Map());

      const codigos: CodigoHallado[] = [...candidatos].slice(0, 10).map((codigo) => {
        const emitido = emitidos.find((e) => e.codigo === codigo) ?? null;
        const registroEstado = registro?.get(codigo);
        const estado: EstadoCodigoPanel = registroEstado
          ? (ESTADOS_REGISTRO[registroEstado] ?? "desconocido")
          : emitido
            ? emitido.activo
              ? "activo"
              : "liberado"
            : registro
              ? "no_encontrado"
              : "desconocido";
        const dueño = dueños.get(codigo) ?? null;
        return {
          codigo,
          estado,
          origen: emitido ? "sitio" : registroEstado ? "registro" : null,
          usuario: dueño?.usuario ?? null,
          correo: dueño?.correo ?? null,
          pedido: emitido?.folio ?? null,
          emitido: emitido?.emitido ?? null,
        };
      });

      return {
        ok: true,
        consulta,
        totalCuentas: cuentas.length,
        cuentas: cuentas.slice(0, 12),
        codigos,
        pedidos,
      };
    } catch (e) {
      console.error("[panel] no se pudo verificar:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
