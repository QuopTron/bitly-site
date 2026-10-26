/**
 * Reparto de códigos Premium entre personas.
 *
 * Quien compra varios códigos —o el dueño desde el panel— indica solo el
 * correo: el sitio genera el usuario y una contraseña por defecto, crea la
 * cuenta ya con Premium y manda las credenciales a esa dirección. No hace falta
 * nombre completo ni que la persona se registre antes.
 *
 * La invitación es también la confirmación del correo: si el mensaje llegó a
 * esa dirección, la dirección existe. Por eso esas cuentas nacen confirmadas y
 * con `clavePorDefecto`, que obliga a cambiar la contraseña al entrar.
 *
 * Si alguien borra su cuenta o el comprador revoca una invitación todavía no
 * aceptada, el código vuelve a quedar libre para entregarlo a otra persona. El
 * panel ve las bajas y las invitaciones sin aceptar.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, putJson } from "@/server/github-store";
import { adminValido } from "@/server/admin";
import { conCerrojo } from "@/server/cerrojo";
import { correoConfigurado, enviarCorreo } from "@/server/correo";
import { correoCredenciales } from "@/server/correo-cuenta";
import { registrarEmitidos, soltarEmitido } from "@/server/codigos-emitidos";
import { emitirCodigos } from "@/server/codigos";
import {
  asignarPremiumACuenta,
  codigosAsignados,
  crearCuentaInvitada,
  cuentaDeToken,
  cuentaPorCorreo,
  darDeBajaInvitada,
} from "@/server/cuentas";

const ARCHIVO = "data/asignaciones.json";
const ARCHIVO_PEDIDOS = "data/pedidos.json";
const MAX_POR_VEZ = 10;

type PedidoCrudo = {
  folio?: unknown;
  estado?: unknown;
  codigos?: unknown;
  codigo?: unknown;
  cuentaId?: unknown;
  correo?: unknown;
};

type Asignacion = {
  id: string;
  codigo: string;
  correo: string;
  usuario: string;
  cuentaId: string;
  folio: string;
  por: "admin" | "comprador";
  /** Cuenta que repartió (null cuando fue el dueño). */
  porCuenta: string | null;
  estado: "enviada" | "revocada";
  creado: string;
  /** Salió el correo con las credenciales. */
  enviado: boolean;
};

function limpiar(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 120;
}

function azar(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function leerPedidos(): Promise<PedidoCrudo[]> {
  const lista = await getJson<PedidoCrudo[]>("datos", ARCHIVO_PEDIDOS, []);
  return Array.isArray(lista) ? lista.filter((p) => p && typeof p.folio === "string") : [];
}

async function leerAsignaciones(): Promise<Asignacion[]> {
  const lista = await getJson<Asignacion[]>("datos", ARCHIVO, []);
  return Array.isArray(lista)
    ? lista.filter((a) => a && typeof a.id === "string" && typeof a.codigo === "string")
    : [];
}

/** Códigos del pedido, normalizados (los pedidos viejos tenían uno solo). */
function codigosDe(p: PedidoCrudo): string[] {
  if (Array.isArray(p.codigos) && p.codigos.length) {
    return p.codigos.filter((c): c is string => typeof c === "string" && c.length > 0);
  }
  return typeof p.codigo === "string" && p.codigo ? [p.codigo] : [];
}

async function guardarAsignaciones(lista: Asignacion[], mensaje: string): Promise<boolean> {
  return putJson("datos", ARCHIVO, lista.slice(0, 5_000), mensaje);
}

/* ── Lo que ve el comprador en «Mi cuenta» ────────────────────────────── */

export type CodigoDeComprador = {
  codigo: string;
  estado: "propio" | "asignado" | "libre";
  correo?: string;
  usuario?: string;
  /** La invitación ya fue aceptada (la persona entró). */
  aceptada?: boolean;
  asignacionId?: string;
};

export type ResultadoMisCodigos =
  | {
      ok: true;
      nombre: string;
      grupos: Array<{ folio: string; estado: string; codigos: CodigoDeComprador[] }>;
    }
  | { ok: false; motivo: "sesion" | "servidor" };

export const misCodigos = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoMisCodigos> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };

    try {
      const [pedidos, asignaciones, asignados] = await Promise.all([
        leerPedidos(),
        leerAsignaciones(),
        codigosAsignados(),
      ]);

      const grupos = pedidos
        .filter(
          (p) =>
            p.cuentaId === cuenta.id &&
            (p.estado === "pagado" || p.estado === "enviado"),
        )
        .sort((a, b) => (String(a.folio) < String(b.folio) ? 1 : -1))
        .map((p) => {
          const folio = String(p.folio);
          const codigos = codigosDe(p).map((codigo): CodigoDeComprador => {
            const entrega = asignaciones.find(
              (a) => a.codigo === codigo && a.folio === folio && a.estado !== "revocada",
            );
            const enCuenta = asignados.get(codigo);
            if (codigo === cuenta.codigo) {
              return { codigo, estado: "propio" };
            }
            if (entrega) {
              return {
                codigo,
                estado: "asignado",
                correo: entrega.correo,
                usuario: entrega.usuario,
                aceptada: enCuenta?.aceptada ?? false,
                asignacionId: entrega.id,
              };
            }
            if (enCuenta) {
              return {
                codigo,
                estado: "asignado",
                correo: enCuenta.correo,
                usuario: enCuenta.usuario,
                aceptada: enCuenta.aceptada,
              };
            }
            return { codigo, estado: "libre" };
          });
          return { folio, estado: String(p.estado ?? ""), codigos };
        })
        .filter((g) => g.codigos.length > 0);

      return { ok: true, nombre: cuenta.nombre, grupos };
    } catch (e) {
      console.error("[asignaciones] no se pudieron leer los códigos:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Repartir ─────────────────────────────────────────────────────────── */

export type Asignada = {
  correo: string;
  usuario: string;
  codigo: string;
  /** Contraseña por defecto; solo cuando la cuenta es nueva. */
  clave: string | null;
  enviado: boolean;
  motivo?: "correo" | "ya_tenia_cuenta";
};

export type ResultadoAsignar =
  | {
      ok: true;
      asignadas: Asignada[];
      errores: Array<{ correo: string; motivo: string }>;
      quedan: number;
    }
  | {
      ok: false;
      motivo: "admin" | "sesion" | "datos" | "sin_codigos" | "no_es_tu_pedido" | "servidor";
    };

export const asignarCodigos = createServerFn({ method: "POST" })
  .validator(
    (d: { admin?: unknown; token?: unknown; folio?: unknown; correos?: unknown }) => d,
  )
  .handler(async ({ data }): Promise<ResultadoAsignar> => {
    const folio = limpiar(data?.folio, 20).toUpperCase();
    const esAdmin = await adminValido(data?.admin);
    const cuenta = esAdmin ? null : await cuentaDeToken(limpiar(data?.token, 500));
    if (!esAdmin && !cuenta) return { ok: false, motivo: "sesion" };
    if (!folio) return { ok: false, motivo: "datos" };

    const crudos = Array.isArray(data?.correos) ? data.correos : [];
    const correos = [...new Set(
      crudos
        .map((c) => limpiar(c, 120).toLowerCase())
        .filter((c) => correoValido(c)),
    )].slice(0, MAX_POR_VEZ);
    if (correos.length === 0) return { ok: false, motivo: "datos" };

    // Dos llamadas simultáneas leerían el mismo estado y se pisarían:
    // esta entra en fila con las demás que tocan lo mismo.
    return conCerrojo(`reparto:${folio}`, async () => {
      try {
        const pedidos = await leerPedidos();
        const pedido = pedidos.find((p) => p.folio === folio);
        if (!pedido) return { ok: false, motivo: "datos" };
        if (!esAdmin && pedido.cuentaId !== cuenta?.id) return { ok: false, motivo: "no_es_tu_pedido" };
        if (pedido.estado !== "pagado" && pedido.estado !== "enviado") {
          return { ok: false, motivo: "datos" };
        }

        const codigos = codigosDe(pedido);
        const [asignaciones, asignados] = await Promise.all([leerAsignaciones(), codigosAsignados()]);
        const ocupados = new Set(asignados.keys());
        for (const a of asignaciones) {
          if (a.estado !== "revocada") ocupados.add(a.codigo);
        }
        // El código del comprador ya está en su cuenta: no se reparte.
        if (cuenta?.codigo) ocupados.add(cuenta.codigo);

        const libres = codigos.filter((c) => !ocupados.has(c));
        if (libres.length === 0) return { ok: false, motivo: "sin_codigos" };

        const de = cuenta?.nombre?.trim() || "El equipo de Bitly";
        const asignadas: Asignada[] = [];
        const errores: Array<{ correo: string; motivo: string }> = [];
        const nuevas: Asignacion[] = [];
        let indice = 0;

        for (const correo of correos) {
          const codigo = libres[indice];
          if (!codigo) {
            errores.push({ correo, motivo: "sin_codigos" });
            continue;
          }

          // Si la persona ya tiene cuenta, el código se le suma a ESA cuenta:
          // no se le crea otra con una contraseña nueva.
          const existente = await cuentaPorCorreo(correo);
          if (existente) {
            if (existente.codigo) {
              errores.push({ correo, motivo: "ya_premium" });
              continue;
            }
            const okPremium = await asignarPremiumACuenta(existente.id, codigo, folio);
            if (!okPremium.ok) {
              errores.push({ correo, motivo: "servidor" });
              continue;
            }
            await registrarEmitidos([codigo], folio, existente.id);
            const asignacion: Asignacion = {
              id: azar(8),
              codigo,
              correo,
              usuario: existente.usuario || existente.correo.split("@")[0],
              cuentaId: existente.id,
              folio,
              por: esAdmin ? "admin" : "comprador",
              porCuenta: cuenta?.id ?? null,
              estado: "enviada",
              creado: new Date().toISOString(),
              enviado: false,
            };
            nuevas.push(asignacion);
            asignadas.push({
              correo,
              usuario: asignacion.usuario,
              codigo,
              clave: null,
              enviado: false,
              motivo: "ya_tenia_cuenta",
            });
            indice++;
            continue;
          }

          const creada = await crearCuentaInvitada({
            correo,
            codigo,
            folio,
            invitadaPor: cuenta?.id ?? null,
          });
          if (!creada.ok) {
            errores.push({ correo, motivo: creada.motivo });
            continue;
          }

          let enviado = false;
          if (correoConfigurado()) {
            try {
              const cuerpo = correoCredenciales({
                usuario: creada.usuario,
                correo,
                clave: creada.clave,
                codigo,
                folio,
                de,
              });
              const envio = await enviarCorreo({
                to: correo,
                subject: cuerpo.subject,
                text: cuerpo.text,
                html: cuerpo.html,
              });
              enviado = envio.ok;
            } catch (e) {
              console.error("[asignaciones] no salió el correo:", e instanceof Error ? e.message : e);
            }
          }

          await registrarEmitidos([codigo], folio, creada.cuentaId);

          nuevas.push({
            id: azar(8),
            codigo,
            correo,
            usuario: creada.usuario,
            cuentaId: creada.cuentaId,
            folio,
            por: esAdmin ? "admin" : "comprador",
            porCuenta: cuenta?.id ?? null,
            estado: "enviada",
            creado: new Date().toISOString(),
            enviado,
          });
          asignadas.push({
            correo,
            usuario: creada.usuario,
            codigo,
            clave: creada.clave,
            enviado,
            ...(enviado ? {} : { motivo: "correo" as const }),
          });
          indice++;
        }

        if (nuevas.length > 0) {
          const ok = await guardarAsignaciones([...nuevas, ...asignaciones], `reparto ${folio}: ${nuevas.length}`);
          if (!ok) return { ok: false, motivo: "servidor" };
        }

        return {
          ok: true,
          asignadas,
          errores,
          quedan: Math.max(0, libres.length - asignadas.length),
        };
      } catch (e) {
        console.error("[asignaciones] no se pudo repartir:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });

/* ── Regalar Premium desde el panel ───────────────────────────────────── */

export type ResultadoRegalo =
  | { ok: true; codigo: string; usuario: string }
  | {
      ok: false;
      motivo: "admin" | "datos" | "sin_cuenta" | "ya_premium" | "sin_codigos" | "servidor";
    };

/**
 * Le da Premium a una cuenta que ya existe, sin compra de por medio.
 *
 * Lo usa el botón «Regalar Premium» del panel de usuarios. Emite UN código con
 * la misma firma que una compra y se lo asigna a la cuenta; si la persona no
 * tiene código, la demo y «Mi cuenta» lo ven en el acto. Los códigos ya
 * repartidos (pedidos, invitaciones y cuentas) no se repiten.
 */
export const regalarPremium = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; correo?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoRegalo> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    const correo = limpiar(data?.correo, 120).toLowerCase();
    if (!correoValido(correo)) return { ok: false, motivo: "datos" };

    // Dos regalos simultáneos a la misma persona emitirían dos códigos para una
    // sola cuenta (y quedaría uno libre sin dueño): entran en fila.
    return conCerrojo(`regalo:${correo}`, async () => {
      try {
        const cuenta = await cuentaPorCorreo(correo);
        if (!cuenta) return { ok: false, motivo: "sin_cuenta" };
        if (cuenta.codigo) return { ok: false, motivo: "ya_premium" };

        const [pedidos, asignaciones, asignados] = await Promise.all([
          leerPedidos(),
          leerAsignaciones(),
          codigosAsignados(),
        ]);
        const enUso = new Set(asignados.keys());
        for (const a of asignaciones) {
          if (a.estado !== "revocada") enUso.add(a.codigo);
        }
        for (const p of pedidos) {
          for (const codigo of codigosDe(p)) enUso.add(codigo);
        }

        // Folio propio del regalo: no hay pedido, y así el panel y «Mi cuenta»
        // pueden distinguir un Premium regalado de uno comprado.
        const folio = `REGALO-${cuenta.id.slice(0, 6).toUpperCase()}`;
        const emision = await emitirCodigos(1, folio, enUso);
        if (!emision.ok) return { ok: false, motivo: "sin_codigos" };
        const codigo = emision.codigos[0];

        const asignado = await asignarPremiumACuenta(cuenta.id, codigo, folio);
        if (!asignado.ok) {
          // No quedó en ninguna cuenta: se apaga para no dejar un código suelto
          // que acredite Premium sin dueño.
          await soltarEmitido(codigo).catch(() => false);
          return { ok: false, motivo: "servidor" };
        }

        return {
          ok: true,
          codigo,
          usuario: cuenta.usuario || correo.split("@")[0],
        };
      } catch (e) {
        console.error("[asignaciones] no se pudo regalar el premium:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });

/* ── Revocar para reasignar ───────────────────────────────────────────── */

export type ResultadoRevocar =
  | { ok: true; codigo: string }
  | { ok: false; motivo: "admin" | "sesion" | "datos" | "aceptada" | "no_encontrada" | "servidor" };

export const revocarAsignacion = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; token?: unknown; id?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoRevocar> => {
    const id = limpiar(data?.id, 20);
    if (!id) return { ok: false, motivo: "datos" };
    const esAdmin = await adminValido(data?.admin);
    const cuenta = esAdmin ? null : await cuentaDeToken(limpiar(data?.token, 500));
    if (!esAdmin && !cuenta) return { ok: false, motivo: "sesion" };

    // Dos llamadas simultáneas leerían el mismo estado y se pisarían:
    // esta entra en fila con las demás que tocan lo mismo.
    return conCerrojo(`reparto-id:${id}`, async () => {
      try {
        const asignaciones = await leerAsignaciones();
        const indice = asignaciones.findIndex((a) => a.id === id);
        if (indice < 0) return { ok: false, motivo: "no_encontrada" };
        const asignacion = asignaciones[indice];

        if (!esAdmin) {
          const pedidos = await leerPedidos();
          const pedido = pedidos.find((p) => p.folio === asignacion.folio);
          if (!pedido || pedido.cuentaId !== cuenta?.id) return { ok: false, motivo: "datos" };
          const enCuenta = (await codigosAsignados()).get(asignacion.codigo);
          // Si la persona ya entró, el código es suyo: revocarlo sería dejarla
          // sin lo que ya recibió. Solo el dueño puede deshacer eso.
          if (enCuenta?.aceptada) return { ok: false, motivo: "aceptada" };
        }

        if (asignacion.estado === "revocada") {
          return { ok: true, codigo: asignacion.codigo };
        }

        const siguiente = asignaciones.slice();
        siguiente[indice] = { ...asignacion, estado: "revocada" };
        const ok = await guardarAsignaciones(siguiente, `reparto ${asignacion.folio}: revocada`);
        if (!ok) return { ok: false, motivo: "servidor" };

        await darDeBajaInvitada(asignacion.cuentaId).catch(() => null);
        await soltarEmitido(asignacion.codigo).catch(() => false);
        return { ok: true, codigo: asignacion.codigo };
      } catch (e) {
        console.error("[asignaciones] no se pudo revocar:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });
