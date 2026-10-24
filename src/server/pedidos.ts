/**
 * Pedidos de Premium con comprobante de pago.
 *
 * El sitio no cobra ni valida transferencias: recibe el comprobante, lo guarda
 * en el repo privado de datos y deja el pedido en estado `pendiente`. El dueño
 * lo revisa desde el panel admin, asigna un código y se lo envía al comprador
 * (o usa el envío opcional por Resend/webhook).
 *
 * Todo lo privado vive en el servidor: el comprobante se guarda como archivo
 * binario en `data/comprobantes/` y los pedidos en `data/pedidos.json`. El
 * navegador solo recibe el folio + un token de seguimiento, que se guarda en
 * localStorage para que el comprador vea su estado y su código al volver.
 */

import { createServerFn } from "@tanstack/react-start";
import { codigoAdminValido } from "@/server/analytics";
import { correoAdmin, correoConfigurado, enviarCorreo } from "@/server/correo";
import { getArchivo, getJson, putArchivo, putJson } from "@/server/github-store";
import { obtenerIPCliente } from "@/server/ip";
import { cuentaDeToken } from "@/server/cuentas";
import { leerRegistroCodigos } from "@/lib/premium-check";
import { avisoNuevoPedido, correoDePrueba, cuerpoCorreo } from "@/server/correo-compra";

const ARCHIVO = "data/pedidos.json";
const CARPETA = "data/comprobantes";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PEDIDOS = 800;

export type EstadoPedido = "pendiente" | "pagado" | "enviado" | "cancelado";

type PedidoGuardado = {
  folio: string;
  token: string;
  nombre: string;
  correo: string;
  celular: string;
  comprobante: string;
  tipoComprobante: string;
  estado: EstadoPedido;
  codigo: string | null;
  nota: string;
  /** Cuenta del sitio que hizo el pedido (null en compras de invitado). */
  cuentaId: string | null;
  creado: string;
  actualizado: string;
};

export type PedidoPublico = {
  folio: string;
  nombre: string;
  estado: EstadoPedido;
  codigo: string | null;
  nota: string;
  creado: string;
  actualizado: string;
  correo: string;
  celular: string;
};

type ResultadoCrear =
  | { ok: true; folio: string; token: string; pedido: PedidoPublico }
  | { ok: false; motivo: "datos" | "archivo" | "limite" | "servidor" };

type ResultadoConsulta =
  | { ok: true; pedido: PedidoPublico }
  | { ok: false; motivo: "datos" | "no_encontrado" | "limite" | "servidor" };

type ResultadoRecuperar =
  | { ok: true; token: string; pedido: PedidoPublico }
  | { ok: false; motivo: "datos" | "no_encontrado" | "limite" | "servidor" };

type ResultadoAdmin =
  | {
      ok: true;
      pedidos: Array<PedidoPublico & { comprobante: string; tipoComprobante: string }>;
    }
  | { ok: false; motivo: "admin" | "servidor" };

export type ResumenCodigos = {
  total: number;
  activos: number;
  usados: number;
  cancelados: number;
  libres: number;
  otros: number;
  codigosActivos: string[];
  correoConfigurado: boolean;
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function azar(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let salida = "";
  for (const b of bytes) salida += ALFABETO[b % ALFABETO.length];
  return salida;
}

function limpiar(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 120;
}

function celularValido(celular: string): boolean {
  return /^\+?\d{6,20}$/.test(celular.replace(/[\s().-]/g, ""));
}

function normalizarCelular(celular: string): string {
  const limpio = celular.replace(/[\s().-]/g, "");
  return limpio.startsWith("+") ? limpio : `+${limpio}`;
}

function telefonoDigitos(celular: string): string {
  return celular.replace(/\D/g, "");
}

function mismoContacto(p: PedidoGuardado, contacto: string): boolean {
  const c = contacto.trim().toLowerCase();
  if (c.includes("@")) return p.correo.toLowerCase() === c;
  const digitos = telefonoDigitos(c);
  return digitos.length >= 6 && telefonoDigitos(p.celular).endsWith(digitos.slice(-10));
}

function publico(p: PedidoGuardado): PedidoPublico {
  return {
    folio: p.folio,
    nombre: p.nombre,
    estado: p.estado,
    codigo: p.codigo,
    nota: p.nota,
    creado: p.creado,
    actualizado: p.actualizado,
    correo: p.correo,
    celular: p.celular,
  };
}

function archivoValido(entrada: string): { tipo: string; ext: string } | null {
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(entrada)) return null;
  const b64 = entrada.replace(/\s+/g, "");
  if (b64.length < 32 || b64.length > Math.ceil((MAX_BYTES / 3) * 4) + 8) return null;
  if (b64.startsWith("iVBORw0KGgo")) return { tipo: "image/png", ext: "png" };
  if (b64.startsWith("/9j/")) return { tipo: "image/jpeg", ext: "jpg" };
  if (b64.startsWith("UklGR")) return { tipo: "image/webp", ext: "webp" };
  if (b64.startsWith("JVBERi0")) return { tipo: "application/pdf", ext: "pdf" };
  return null;
}

/** Cupo simple por IP para no llenar el repo de pedidos basura. */
const intentos = new Map<string, { n: number; t: number }>();
const VENTANA_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 6;

async function hayCupo(): Promise<boolean> {
  const ip = await obtenerIPCliente();
  const ahora = Date.now();
  const previo = intentos.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    intentos.set(ip, { n: 1, t: ahora });
    return true;
  }
  previo.n++;
  return previo.n <= MAX_INTENTOS;
}

async function leerPedidos(): Promise<PedidoGuardado[]> {
  const lista = await getJson<PedidoGuardado[]>("datos", ARCHIVO, []);
  return Array.isArray(lista) ? lista.filter((p) => p && typeof p.folio === "string") : [];
}

function ordenarNuevos(lista: PedidoGuardado[]): PedidoGuardado[] {
  return lista.slice().sort((a, b) => (a.creado < b.creado ? 1 : -1)).slice(0, MAX_PEDIDOS);
}

/* ── Comprador ─────────────────────────────────────────────────────────── */

export const crearPedido = createServerFn({ method: "POST" })
  .validator(
    (d: {
      nombre?: unknown;
      correo?: unknown;
      celular?: unknown;
      comprobante?: unknown;
      web?: unknown;
      sesionCuenta?: unknown;
    }) => d,
  )
  .handler(async ({ data }): Promise<ResultadoCrear> => {
    // Honeypot: los bots rellenan el campo oculto; el humano nunca lo ve.
    if (limpiar(data?.web, 10)) return { ok: false, motivo: "datos" };

    const nombre = limpiar(data?.nombre, 60);
    const correo = limpiar(data?.correo, 120).toLowerCase();
    const celularCrudo = limpiar(data?.celular, 30);
    const comprobante = String(data?.comprobante ?? "").replace(/\s+/g, "");
    const cuenta = await cuentaDeToken(limpiar(data?.sesionCuenta, 500));

    if (!correoValido(correo)) return { ok: false, motivo: "datos" };
    if (!celularValido(celularCrudo)) return { ok: false, motivo: "datos" };
    const tipo = archivoValido(comprobante);
    if (!tipo) return { ok: false, motivo: "archivo" };
    if (!(await hayCupo())) return { ok: false, motivo: "limite" };

    const folio = `FLX-${azar(8)}`;
    const token = azar(28);
    const ahora = new Date().toISOString();
    const ruta = `${CARPETA}/${folio}.${tipo.ext}`;

    try {
      const guardado = await putArchivo(
        "datos",
        ruta,
        comprobante,
        `pedido ${folio}: comprobante`,
      );
      if (!guardado) return { ok: false, motivo: "servidor" };

      const pedido: PedidoGuardado = {
        folio,
        token,
        nombre,
        correo,
        celular: normalizarCelular(celularCrudo),
        comprobante: ruta,
        tipoComprobante: tipo.tipo,
        estado: "pendiente",
        codigo: null,
        nota: "",
        cuentaId: cuenta?.id ?? null,
        creado: ahora,
        actualizado: ahora,
      };

      const lista = await leerPedidos();
      const ok = await putJson(
        "datos",
        ARCHIVO,
        ordenarNuevos([pedido, ...lista]),
        `pedido ${folio}: nuevo`,
      );
      if (!ok) return { ok: false, motivo: "servidor" };

      // Aviso al dueño: si el correo falla, el pedido igual queda guardado y
      // visible en el panel. Nunca se pierde una compra por un problema de SMTP.
      try {
        const aviso = avisoNuevoPedido(pedido);
        await enviarCorreo({ to: correoAdmin(), ...aviso });
      } catch (e) {
        console.error("[pedidos] aviso al admin falló:", e instanceof Error ? e.message : e);
      }

      return { ok: true, folio, token, pedido: publico(pedido) };
    } catch (e) {
      console.error("[pedidos] no se pudo crear:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const consultarPedido = createServerFn({ method: "POST" })
  .validator((d: { folio?: unknown; token?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoConsulta> => {
    const folio = limpiar(data?.folio, 20).toUpperCase();
    const token = limpiar(data?.token, 64);
    if (!folio || !token) return { ok: false, motivo: "datos" };
    try {
      const pedido = (await leerPedidos()).find((p) => p.folio === folio);
      if (!pedido || pedido.token !== token) return { ok: false, motivo: "no_encontrado" };
      return { ok: true, pedido: publico(pedido) };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

export const recuperarPedido = createServerFn({ method: "POST" })
  .validator((d: { folio?: unknown; contacto?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoRecuperar> => {
    const folio = limpiar(data?.folio, 20).toUpperCase();
    const contacto = limpiar(data?.contacto, 120);
    if (!folio || !contacto) return { ok: false, motivo: "datos" };
    if (!(await hayCupo())) return { ok: false, motivo: "limite" };
    try {
      const pedido = (await leerPedidos()).find((p) => p.folio === folio);
      if (!pedido || !mismoContacto(pedido, contacto)) return { ok: false, motivo: "no_encontrado" };
      return { ok: true, token: pedido.token, pedido: publico(pedido) };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Admin ─────────────────────────────────────────────────────────────── */

export const adminPedidos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoAdmin> => {
    if (!codigoAdminValido(data?.admin)) return { ok: false, motivo: "admin" };
    try {
      const lista = ordenarNuevos(await leerPedidos());
      return {
        ok: true,
        pedidos: lista.map((p) => ({
          ...publico(p),
          comprobante: p.comprobante,
          tipoComprobante: p.tipoComprobante,
        })),
      };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

export const resumenCodigos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResumenCodigos | null> => {
    if (!codigoAdminValido(data?.admin)) return null;
    try {
      const registro = await leerRegistroCodigos();
      const resumen: ResumenCodigos = {
        total: registro.size,
        activos: 0,
        usados: 0,
        cancelados: 0,
        libres: 0,
        otros: 0,
        codigosActivos: [],
        correoConfigurado: correoConfigurado(),
      };
      for (const [codigo, estado] of registro) {
        if (estado === "activo") {
          resumen.activos++;
          if (resumen.codigosActivos.length < 300) resumen.codigosActivos.push(codigo);
        } else if (estado === "usado") resumen.usados++;
        else if (estado === "cancelado") resumen.cancelados++;
        else if (estado === "libre") resumen.libres++;
        else resumen.otros++;
      }
      return resumen;
    } catch (e) {
      console.error("[pedidos] no se pudo leer el registro de códigos:", e);
      return null;
    }
  });

/**
 * Espeja el registro real de códigos (`bitly_codes_premium`) dentro de
 * `bitly-data` para que la cuenta del sitio y la app compartan una vista.
 *
 * La fuente de verdad sigue siendo `bitly_codes_premium` (la app ya lee ese
 * repo); esto sólo deja un índice versionado en la base del sitio. Se escribe a
 * pedido del admin, no en cada carga, para no gastar commits ni rate limit.
 */
export const sincronizarCodigos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: true; total: number } | { ok: false; motivo: string }> => {
    if (!codigoAdminValido(data?.admin)) return { ok: false, motivo: "admin" };
    try {
      const registro = await leerRegistroCodigos();
      const estados: Record<string, string> = {};
      const conteo = { activos: 0, usados: 0, cancelados: 0, libres: 0, otros: 0 };
      for (const [codigo, estado] of registro) {
        estados[codigo] = estado;
        if (estado === "activo") conteo.activos++;
        else if (estado === "usado") conteo.usados++;
        else if (estado === "cancelado") conteo.cancelados++;
        else if (estado === "libre") conteo.libres++;
        else conteo.otros++;
      }
      const ok = await putJson(
        "datos",
        "data/codigos.json",
        {
          actualizado: new Date().toISOString(),
          fuente: "QuopTron/bitly_codes_premium",
          total: registro.size,
          ...conteo,
          estados,
        },
        `códigos: espejo de ${registro.size} códigos`,
      );
      if (!ok) return { ok: false, motivo: "servidor" };
      return { ok: true, total: registro.size };
    } catch (e) {
      console.error("[pedidos] no se pudo espejar códigos:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const leerComprobante = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; folio?: unknown }) => d)
  .handler(async ({ data }): Promise<{ tipo: string; base64: string } | null> => {
    if (!codigoAdminValido(data?.admin)) return null;
    const folio = limpiar(data?.folio, 20).toUpperCase();
    if (!folio) return null;
    try {
      const pedido = (await leerPedidos()).find((p) => p.folio === folio);
      if (!pedido) return null;
      const base64 = await getArchivo("datos", pedido.comprobante);
      if (!base64) return null;
      return { tipo: pedido.tipoComprobante, base64 };
    } catch {
      return null;
    }
  });

export const actualizarPedido = createServerFn({ method: "POST" })
  .validator(
    (d: {
      admin?: unknown;
      folio?: unknown;
      estado?: unknown;
      codigoPremium?: unknown;
      nota?: unknown;
    }) => d,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; pedido: PedidoPublico } | { ok: false; motivo: string }> => {
      if (!codigoAdminValido(data?.admin)) return { ok: false, motivo: "admin" };
      const folio = limpiar(data?.folio, 20).toUpperCase();
      const codigoPremium = limpiar(data?.codigoPremium, 500);
      const nota = limpiar(data?.nota, 600);
      const estado = limpiar(data?.estado, 20) as EstadoPedido;
      const estados: EstadoPedido[] = ["pendiente", "pagado", "enviado", "cancelado"];
      if (!folio) return { ok: false, motivo: "datos" };
      if (codigoPremium && codigoPremium.length < 20) return { ok: false, motivo: "codigo" };
      if (estado && !estados.includes(estado)) return { ok: false, motivo: "datos" };

      try {
        const lista = await leerPedidos();
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0) return { ok: false, motivo: "no_encontrado" };

        if (
          codigoPremium &&
          lista.some((p, i) => i !== indice && p.codigo === codigoPremium)
        ) {
          return { ok: false, motivo: "codigo_repetido" };
        }

        const actual = lista[indice];
        const actualizado: PedidoGuardado = {
          ...actual,
          estado: estado || (codigoPremium ? "enviado" : actual.estado),
          codigo: codigoPremium || actual.codigo,
          nota: nota || actual.nota,
          actualizado: new Date().toISOString(),
        };
        const siguiente = lista.slice();
        siguiente[indice] = actualizado;
        const ok = await putJson(
          "datos",
          ARCHIVO,
          ordenarNuevos(siguiente),
          `pedido ${folio}: ${actualizado.estado}`,
        );
        if (!ok) return { ok: false, motivo: "servidor" };
        return { ok: true, pedido: publico(actualizado) };
      } catch (e) {
        console.error("[pedidos] no se pudo actualizar:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    },
  );

export const enviarCodigoPedido = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; folio?: unknown }) => d)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true } | { ok: false; motivo: "admin" | "datos" | "sin_codigo" | "sin_configurar" | "envio" | "servidor" }
    > => {
      if (!codigoAdminValido(data?.admin)) return { ok: false, motivo: "admin" };
      const folio = limpiar(data?.folio, 20).toUpperCase();
      if (!folio) return { ok: false, motivo: "datos" };

      try {
        const lista = await leerPedidos();
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0) return { ok: false, motivo: "datos" };
        const pedido = lista[indice];
        if (!pedido.codigo) return { ok: false, motivo: "sin_codigo" };
        if (!correoValido(pedido.correo)) return { ok: false, motivo: "datos" };
        if (!correoConfigurado()) return { ok: false, motivo: "sin_configurar" };

        const cuerpo = cuerpoCorreo(pedido);
        const envio = await enviarCorreo({
          to: pedido.correo,
          subject: cuerpo.subject,
          text: cuerpo.text,
          html: cuerpo.html,
          replyTo: correoAdmin(),
        });
        if (!envio.ok) {
          return { ok: false, motivo: envio.motivo === "sin_configurar" ? "sin_configurar" : "envio" };
        }

        const actualizado: PedidoGuardado = {
          ...pedido,
          estado: "enviado",
          actualizado: new Date().toISOString(),
        };
        const siguiente = lista.slice();
        siguiente[indice] = actualizado;
        await putJson("datos", ARCHIVO, ordenarNuevos(siguiente), `pedido ${folio}: correo enviado`);
        return { ok: true };
      } catch (e) {
        console.error("[pedidos] no se pudo enviar el correo:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    },
  );

/** Prueba de configuración del correo. Sólo el admin puede dispararla. */
export const probarCorreo = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; para?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; motivo?: string }> => {
    if (!codigoAdminValido(data?.admin)) return { ok: false, motivo: "admin" };
    // Se puede probar contra otro buzón (el propio admin elige), pero nunca
    // contra una dirección arbitraria que venga del navegador sin validar.
    const pedido = limpiar(data?.para, 120).toLowerCase();
    const destino = pedido && correoValido(pedido) ? pedido : correoAdmin();
    const envio = await enviarCorreo({ to: destino, ...correoDePrueba() });
    return envio.ok ? { ok: true } : { ok: false, motivo: envio.motivo };
  });