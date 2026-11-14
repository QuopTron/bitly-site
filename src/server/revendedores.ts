/**
 * Revendedores: panel propio, atribución de ventas y baneo en cascada.
 *
 * Un revendedor es una cuenta normal del sitio que el dueño inscribe en
 * `data/revendedores.json`. Su enlace es `/?ref=<slug>`: lo que llegue por ahí
 * queda marcado con `revendedorId` en el pedido y en la cuenta, así el dueño
 * sabe exactamente a quién le vendió.
 *
 * El revendedor NUNCA ve el código Premium completo. Su panel sólo muestra
 * pedidos, estados y clientes; los códigos los emite y entrega el sistema al
 * validar el pago. Así no puede repartirlos "a lo pendejo" ni venderlos por
 * fuera sin que el dueño lo vea.
 *
 * El baneo es en cascada: marca al revendedor, da de baja a todas las cuentas
 * que llegaron por él (o que él invitó), les quita el Premium, suelta los
 * códigos emitidos y, cuando el código existe en el registro de la app, lo deja
 * en `cancelado` para que también deje de servir dentro de Bitly.
 */

import { createServerFn } from "@tanstack/react-start";
import { adminValido } from "@/server/admin";
import { conCerrojo } from "@/server/cerrojo";
import { getJson, putJson } from "@/server/github-store";
import { soltarEmitidosDeCuentas } from "@/server/codigos-emitidos";
import {
  cuentaDeToken,
  cuentaPorCorreo,
  type CuentaGuardada,
} from "@/server/cuentas";
import {
  guardarRevendedores,
  leerRevendedores,
  limpiar,
  normalizarSlug,
  nuevoIdRevendedor,
  revendedorPorCuenta,
  revendedorPorId,
  revendedorPorSlug,
  slugValido,
  type EstadoRevendedor,
  type RevendedorGuardado,
} from "@/server/revendedores-store";

const ARCHIVO_PEDIDOS = "data/pedidos.json";
const ARCHIVO_CUENTAS = "data/cuentas.json";
const MAX_MOTIVO = 240;

type PedidoCrudo = {
  folio?: unknown;
  nombre?: unknown;
  correo?: unknown;
  celular?: unknown;
  estado?: unknown;
  cantidad?: unknown;
  total?: unknown;
  codigos?: unknown;
  codigo?: unknown;
  cuentaId?: unknown;
  revendedorId?: unknown;
  creado?: unknown;
  actualizado?: unknown;
};

function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 120;
}

function telefono(valor: unknown): string {
  return limpiar(valor, 30);
}

async function leerPedidos(): Promise<PedidoCrudo[]> {
  const lista = await getJson<PedidoCrudo[]>("datos", ARCHIVO_PEDIDOS, []);
  return Array.isArray(lista) ? lista.filter((p) => p && typeof p.folio === "string") : [];
}

async function leerCuentas(): Promise<CuentaGuardada[]> {
  const lista = await getJson<CuentaGuardada[]>("datos", ARCHIVO_CUENTAS, []);
  return Array.isArray(lista) ? lista.filter((c) => c && typeof c.id === "string") : [];
}

function codigosDe(p: PedidoCrudo): string[] {
  if (Array.isArray(p.codigos)) {
    return p.codigos.filter((c): c is string => typeof c === "string" && c.length > 0);
  }
  return typeof p.codigo === "string" && p.codigo ? [p.codigo] : [];
}

function entregado(p: PedidoCrudo): boolean {
  const estado = String(p.estado ?? "");
  return (estado === "pagado" || estado === "enviado") && codigosDe(p).length > 0;
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/* ── Panel del revendedor ─────────────────────────────────────────────── */

export type PedidoRevendedor = {
  folio: string;
  cliente: string;
  correo: string;
  celular: string;
  estado: string;
  cantidad: number;
  total: number;
  entregado: boolean;
  creado: string;
  actualizado: string;
};

export type ClienteRevendedor = {
  usuario: string;
  correo: string;
  premium: boolean;
  baneada: boolean;
  eliminada: boolean;
  creado: string;
};

export type ResultadoPanelRevendedor =
  | {
      ok: true;
      revendedor: {
        id: string;
        slug: string;
        nombre: string;
        comision: number;
        estado: EstadoRevendedor;
      };
      resumen: {
        pedidos: number;
        ventas: number;
        clientes: number;
        premiumActivos: number;
      };
      pedidos: PedidoRevendedor[];
      clientes: ClienteRevendedor[];
    }
  | {
      ok: false;
      motivo: "sesion" | "no_revendedor" | "inactivo" | "servidor";
      estado?: EstadoRevendedor;
    };

export const panelRevendedor = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoPanelRevendedor> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };

    try {
      const rev = await revendedorPorCuenta(cuenta.id);
      if (!rev) return { ok: false, motivo: "no_revendedor" };
      if (rev.estado !== "activo") {
        return { ok: false, motivo: "inactivo", estado: rev.estado };
      }

      const [pedidosCrudos, cuentas] = await Promise.all([leerPedidos(), leerCuentas()]);
      const mios = pedidosCrudos
        .filter((p) => p.revendedorId === rev.id)
        .sort((a, b) => String(b.creado ?? "") < String(a.creado ?? "") ? -1 : 1);

      const pedidos: PedidoRevendedor[] = mios.map((p) => ({
        folio: String(p.folio ?? ""),
        cliente: String(p.nombre ?? ""),
        correo: String(p.correo ?? ""),
        celular: telefono(p.celular),
        estado: String(p.estado ?? "pendiente"),
        cantidad: Math.max(1, numero(p.cantidad) || codigosDe(p).length || 1),
        total: numero(p.total),
        entregado: entregado(p),
        creado: String(p.creado ?? ""),
        actualizado: String(p.actualizado ?? ""),
      }));

      // Clientes: cuentas atribuidas al revendedor + compradores sin cuenta de
      // los pedidos que llegaron por su enlace. Se agrupa por correo.
      const porCorreo = new Map<string, ClienteRevendedor>();
      for (const c of cuentas) {
        if (c.revendedorId !== rev.id) continue;
        porCorreo.set(c.correo.toLowerCase(), {
          usuario: c.usuario,
          correo: c.correo,
          premium: Boolean(c.codigo) && !c.baneada && !c.eliminada,
          baneada: Boolean(c.baneada),
          eliminada: Boolean(c.eliminada),
          creado: c.creado,
        });
      }
      for (const p of mios) {
        const correo = String(p.correo ?? "").toLowerCase();
        if (!correo || porCorreo.has(correo)) continue;
        porCorreo.set(correo, {
          usuario: String(p.nombre ?? ""),
          correo,
          premium: entregado(p),
          baneada: false,
          eliminada: false,
          creado: String(p.creado ?? ""),
        });
      }
      const clientes = [...porCorreo.values()].sort((a, b) =>
        a.creado < b.creado ? 1 : -1,
      );

      const ventas = pedidos
        .filter((p) => p.estado === "pagado" || p.estado === "enviado")
        .reduce((suma, p) => suma + p.total, 0);

      return {
        ok: true,
        revendedor: {
          id: rev.id,
          slug: rev.slug,
          nombre: rev.nombre,
          comision: rev.comision,
          estado: rev.estado,
        },
        resumen: {
          pedidos: pedidos.length,
          ventas,
          clientes: clientes.length,
          premiumActivos: clientes.filter((c) => c.premium && !c.baneada && !c.eliminada).length,
        },
        pedidos,
        clientes,
      };
    } catch (e) {
      console.error("[revendedores] no se pudo abrir el panel:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Panel del dueño ──────────────────────────────────────────────────── */

export type RevendedorAdmin = RevendedorGuardado & {
  pedidos: number;
  ventas: number;
  clientes: number;
  premiumActivos: number;
};

export type ResultadoAdminRevendedores =
  | { ok: true; revendedores: RevendedorAdmin[] }
  | { ok: false; motivo: "admin" | "servidor" };

export const adminRevendedores = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoAdminRevendedores> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    try {
      const [revendedores, pedidos, cuentas] = await Promise.all([
        leerRevendedores(),
        leerPedidos(),
        leerCuentas(),
      ]);
      const lista: RevendedorAdmin[] = revendedores
        .map((rev) => {
          const mios = pedidos.filter((p) => p.revendedorId === rev.id);
          const clientes = cuentas.filter((c) => c.revendedorId === rev.id);
          return {
            ...rev,
            pedidos: mios.length,
            ventas: mios
              .filter((p) => p.estado === "pagado" || p.estado === "enviado")
              .reduce((suma, p) => suma + numero(p.total), 0),
            clientes: clientes.length,
            premiumActivos: clientes.filter(
              (c) => c.codigo && !c.baneada && !c.eliminada,
            ).length,
          };
        })
        .sort((a, b) => (a.creado < b.creado ? 1 : -1));
      return { ok: true, revendedores: lista };
    } catch (e) {
      console.error("[revendedores] no se pudo listar:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export type ResultadoCrearRevendedor =
  | { ok: true; revendedor: RevendedorGuardado }
  | {
      ok: false;
      motivo:
        | "admin"
        | "datos"
        | "sin_cuenta"
        | "ya_es_revendedor"
        | "slug_ocupado"
        | "servidor";
    };

export const crearRevendedor = createServerFn({ method: "POST" })
  .validator(
    (d: {
      admin?: unknown;
      correo?: unknown;
      slug?: unknown;
      nombre?: unknown;
      comision?: unknown;
    }) => d,
  )
  .handler(async ({ data }): Promise<ResultadoCrearRevendedor> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };

    const correo = limpiar(data?.correo, 120).toLowerCase();
    if (!correoValido(correo)) return { ok: false, motivo: "datos" };
    const nombre = limpiar(data?.nombre, 60);
    const comisionCruda = Number(data?.comision);
    const comision = Number.isFinite(comisionCruda)
      ? Math.min(100, Math.max(0, comisionCruda))
      : 0;

    try {
      const cuenta = await cuentaPorCorreo(correo);
      if (!cuenta) return { ok: false, motivo: "sin_cuenta" };
      if (cuenta.baneada || cuenta.eliminada) return { ok: false, motivo: "sin_cuenta" };

      return await conCerrojo(`revendedor:${cuenta.id}`, async () => {
        const revendedores = await leerRevendedores();
        if (revendedores.some((r) => r.cuentaId === cuenta.id)) {
          return { ok: false, motivo: "ya_es_revendedor" };
        }

        const pedidoSlug = normalizarSlug(data?.slug);
        let base = pedidoSlug || normalizarSlug(correo.split("@")[0]) || "revendedor";
        if (!pedidoSlug && base.length < 3) base = "revendedor";
        let slug = base;
        let intento = 1;
        while (revendedores.some((r) => r.slug === slug)) {
          slug = `${base.slice(0, 26)}-${intento++}`;
          if (intento > 99) return { ok: false, motivo: "slug_ocupado" };
        }
        if (!slugValido(slug)) return { ok: false, motivo: "datos" };

        const ahora = new Date().toISOString();
        const revendedor: RevendedorGuardado = {
          id: nuevoIdRevendedor(),
          cuentaId: cuenta.id,
          slug,
          nombre: nombre || cuenta.nombre || cuenta.usuario,
          correo: cuenta.correo,
          comision,
          estado: "activo",
          creado: ahora,
          actualizado: ahora,
        };
        const ok = await guardarRevendedores(
          [revendedor, ...revendedores],
          `revendedor ${slug}: alta`,
        );
        return ok ? { ok: true, revendedor } : { ok: false, motivo: "servidor" };
      });
    } catch (e) {
      console.error("[revendedores] no se pudo crear:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export type ResultadoEstadoRevendedor =
  | { ok: true; revendedor: RevendedorGuardado }
  | { ok: false; motivo: "admin" | "datos" | "no_encontrado" | "servidor" };

/** Activa o suspende. Banear va por `banearRevendedor` (hace la cascada). */
export const cambiarEstadoRevendedor = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; id?: unknown; estado?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoEstadoRevendedor> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    const id = limpiar(data?.id, 40);
    const estado = limpiar(data?.estado, 20) as EstadoRevendedor;
    if (!id || !["activo", "suspendido", "baneado"].includes(estado)) {
      return { ok: false, motivo: "datos" };
    }
    if (estado === "baneado") {
      const baneo = await banearRevendedorInterno(limpiar(data?.admin, 600), id, "", true);
      return baneo.ok
        ? { ok: true, revendedor: baneo.revendedor }
        : { ok: false, motivo: "servidor" };
    }

    try {
      return await conCerrojo(`revendedor:${id}`, async () => {
        const lista = await leerRevendedores();
        const indice = lista.findIndex((r) => r.id === id);
        if (indice < 0) return { ok: false, motivo: "no_encontrado" };
        const actualizado: RevendedorGuardado = {
          ...lista[indice],
          estado,
          actualizado: new Date().toISOString(),
        };
        const siguiente = lista.slice();
        siguiente[indice] = actualizado;
        const ok = await guardarRevendedores(siguiente, `revendedor ${actualizado.slug}: ${estado}`);
        return ok ? { ok: true, revendedor: actualizado } : { ok: false, motivo: "servidor" };
      });
    } catch (e) {
      console.error("[revendedores] no se pudo cambiar el estado:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export type ResultadoBaneo =
  | {
      ok: true;
      revendedor: RevendedorGuardado;
      cuentasBaneadas: number;
      pedidosCancelados: number;
      codigosRevocados: number;
      registroApp: number;
    }
  | { ok: false; motivo: "admin" | "datos" | "no_encontrado" | "servidor" };

export const banearRevendedor = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; id?: unknown; motivo?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoBaneo> => {
    return banearRevendedorInterno(
      limpiar(data?.admin, 600),
      limpiar(data?.id, 40),
      limpiar(data?.motivo, MAX_MOTIVO),
      true,
    );
  });

async function banearRevendedorInterno(
  admin: string,
  id: string,
  motivo: string,
  banearReferidos: boolean,
): Promise<ResultadoBaneo> {
  if (!(await adminValido(admin))) return { ok: false, motivo: "admin" };
  if (!id) return { ok: false, motivo: "datos" };

  try {
    return await conCerrojo(`revendedor:${id}`, async () => {
      const [revendedores, pedidos, cuentas] = await Promise.all([
        leerRevendedores(),
        leerPedidos(),
        leerCuentas(),
      ]);
      const indice = revendedores.findIndex((r) => r.id === id);
      if (indice < 0) return { ok: false, motivo: "no_encontrado" };
      const rev = revendedores[indice];

      const pedidosMios = pedidos.filter((p) => p.revendedorId === rev.id);
      const correosMios = new Set(
        pedidosMios.map((p) => String(p.correo ?? "").toLowerCase()).filter(Boolean),
      );

      // Cuentas alcanzadas: las atribuidas por enlace, las que él invitó y las
      // que compraron con su enlace (por id o por correo).
      const cuentasObjetivo = banearReferidos
        ? cuentas.filter(
            (c) =>
              c.revendedorId === rev.id ||
              c.invitadaPor === rev.cuentaId ||
              c.id === rev.cuentaId ||
              (c.correo && correosMios.has(c.correo.toLowerCase())) ||
              pedidosMios.some((p) => p.cuentaId === c.id),
          )
        : cuentas.filter((c) => c.id === rev.cuentaId);

      const ids = new Set(cuentasObjetivo.map((c) => c.id));
      const ahora = new Date().toISOString();
      const motivoFinal = motivo || `Revendedor ${rev.slug} baneado`;

      const cuentasSiguiente = cuentas.map((c) =>
        ids.has(c.id)
          ? {
              ...c,
              baneada: true,
              motivoBaneo: motivoFinal,
              codigo: null,
              premiumPedido: undefined,
              premiumDesde: undefined,
              actualizado: ahora,
            }
          : c,
      );

      const codigos = new Set<string>();
      for (const c of cuentasObjetivo) {
        if (c.codigo) codigos.add(c.codigo);
      }
      for (const p of pedidosMios) {
        for (const codigo of codigosDe(p)) codigos.add(codigo);
      }

      const pedidosSiguiente = pedidos.map((p) => {
        const afectado =
          p.revendedorId === rev.id ||
          (p.cuentaId && ids.has(String(p.cuentaId)));
        if (!afectado) return p;
        const estado = String(p.estado ?? "");
        if (estado !== "pendiente" && estado !== "revision") return p;
        return {
          ...p,
          estado: "cancelado",
          anuladoPor: "admin",
          nota: motivoFinal,
          actualizado: ahora,
        };
      });
      const pedidosCancelados = pedidosSiguiente.filter(
        (p, i) => p.estado === "cancelado" && pedidos[i].estado !== "cancelado",
      ).length;

      const revActualizado: RevendedorGuardado = {
        ...rev,
        estado: "baneado",
        motivoBaneo: motivoFinal,
        baneadoEn: ahora,
        actualizado: ahora,
      };
      const revSiguiente = revendedores.slice();
      revSiguiente[indice] = revActualizado;

      const cuentasCambiadas = cuentasSiguiente.some((c, i) => c !== cuentas[i]);
      const pedidosCambiados = pedidosSiguiente.some((p, i) => p !== pedidos[i]);

      const guardados = await Promise.all([
        guardarRevendedores(revSiguiente, `revendedor ${rev.slug}: baneado`),
        cuentasCambiadas
          ? putJson("datos", ARCHIVO_CUENTAS, cuentasSiguiente, `revendedor ${rev.slug}: baja de referidos`)
          : Promise.resolve(true),
        pedidosCambiados
          ? putJson("datos", ARCHIVO_PEDIDOS, pedidosSiguiente, `revendedor ${rev.slug}: pedidos cancelados`)
          : Promise.resolve(true),
      ]);
      if (guardados.some((ok) => !ok)) return { ok: false, motivo: "servidor" };

      await soltarEmitidosDeCuentas([...ids], [...codigos]).catch(() => false);
      const registroApp = await revocarEnRegistroApp([...codigos]);

      return {
        ok: true,
        revendedor: revActualizado,
        cuentasBaneadas: ids.size,
        pedidosCancelados,
        codigosRevocados: codigos.size,
        registroApp,
      };
    });
  } catch (e) {
    console.error("[revendedores] no se pudo banear:", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "servidor" };
  }
}

/* ── Registro de la app ───────────────────────────────────────────────── */

function textoABase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

function base64ATexto(b64: string): string {
  const binario = atob(b64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Marca como `cancelado` los códigos en el registro que lee la app.
 *
 * No basta con los que ya están anotados: los códigos firmados por el sitio
 * (`BITLY2...`) no viven en `codes.json`, pero la app consulta el registro antes
 * de activarlos. Al anotarlos como `cancelado`, también dejan de servir dentro
 * de Bitly, aunque la firma siga siendo válida.
 */
async function revocarEnRegistroApp(codigos: string[]): Promise<number> {
  const token = process.env.BITLY_CODES_TOKEN;
  if (!token || codigos.length === 0) return 0;

  const repo = process.env.BITLY_CODES_REPO || "QuopTron/bitly_codes_premium";
  const api = `https://api.github.com/repos/${repo}/contents/codes.json`;
  const cabeceras: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bitly-site",
  };

  try {
    const lectura = await fetch(api, { headers: cabeceras });
    if (!lectura.ok) return 0;
    const info = (await lectura.json()) as { content?: string; sha?: string };
    if (!info.content || !info.sha) return 0;

    const registro = JSON.parse(base64ATexto(info.content)) as Record<string, unknown>;
    let tocados = 0;
    for (const codigo of codigos) {
      if (registro[codigo] === "cancelado") continue;
      registro[codigo] = "cancelado";
      tocados++;
    }
    if (tocados === 0) return 0;

    const escritura = await fetch(api, {
      method: "PUT",
      headers: { ...cabeceras, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `revendedor: ${tocados} código(s) cancelado(s)`,
        content: textoABase64(JSON.stringify(registro, null, 2) + "\n"),
        sha: info.sha,
      }),
    });
    return escritura.ok ? tocados : 0;
  } catch (e) {
    console.error("[revendedores] no se pudo cancelar en el registro:", e instanceof Error ? e.message : e);
    return 0;
  }
}
