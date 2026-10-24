/**
 * Pedidos de Premium con comprobante de pago.
 *
 * El sitio no cobra ni valida transferencias: recibe el comprobante, lo guarda
 * en el repo privado de datos y deja el pedido en estado `pendiente`.
 *
 * Ciclo de vida:
 *
 *   pendiente  el comprador acaba de subir el comprobante y tiene una ventana
 *              corta para arrepentirse (10 min en producción, 1 en local).
 *              En este estado puede anular el pedido él mismo.
 *   revision   la ventana se cerró sin anular: recién ahí se avisa al dueño y
 *              el comprador ve «el equipo está revisando el comprobante». Los
 *              códigos todavía NO existen.
 *   pagado     el dueño validó el pago: se emiten los códigos (cantidad de
 *              códigos comprados) y se entregan en el sitio y por correo.
 *   enviado    el correo salió.
 *   cancelado  anulado por el comprador, abortado o dado de baja por el dueño.
 *
 * Volver un pedido a `pendiente` o `revision` suelta los códigos asignados: al
 * comprador no se le puede «quitar» el correo que ya recibió, pero el pedido
 * deja de figurar como entregado y se pueden emitir códigos nuevos.
 *
 * Todo lo privado vive en el servidor: el comprobante se guarda como archivo
 * binario en `data/comprobantes/` y los pedidos en `data/pedidos.json`. El
 * navegador solo recibe el folio + un token de seguimiento, que se guarda en
 * localStorage para que el comprador vea su estado y su código al volver.
 */

import { createServerFn } from "@tanstack/react-start";
import { adminValido } from "@/server/analytics";
import { correoAdmin, correoConfigurado, enviarCorreo } from "@/server/correo";
import { borrarArchivo, getArchivo, getJson, putArchivo, putJson } from "@/server/github-store";
import { obtenerIPCliente } from "@/server/ip";
import { banearCuenta, cuentaDeToken } from "@/server/cuentas";
import { leerRegistroCodigos } from "@/lib/premium-check";
import { getFaseActual } from "@/lib/pricing";
import { MAX_CODIGOS, emitirCodigos, firmaConfigurada } from "@/server/codigos";
import { avisoNuevoPedido, correoDePrueba, cuerpoCorreo } from "@/server/correo-compra";

const ARCHIVO = "data/pedidos.json";
const CARPETA = "data/comprobantes";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PEDIDOS = 800;

/**
 * Ventana para anular una compra recién subida.
 *
 * En producción son 10 minutos; en local 1, para poder probar el vencimiento
 * sin esperar. Se puede fijar con `BITLY_VENTANA_PEDIDO_MIN` (minutos).
 */
const VENTANA_MIN = (() => {
  const propio = Number(process.env.BITLY_VENTANA_PEDIDO_MIN);
  if (Number.isFinite(propio) && propio > 0) return propio;
  return process.env.NODE_ENV === "production" ? 10 : 1;
})();
const VENTANA_ANULACION_MS = VENTANA_MIN * 60_000;

/** Precio por código, en Bs. El total del pedido es esto × cantidad. */
const PRECIO_UNIDAD = getFaseActual().precio;

export type EstadoPedido = "pendiente" | "revision" | "pagado" | "enviado" | "cancelado";

/** Estados en los que el pedido sigue vivo (bloquea comprar de nuevo). */
const ABIERTOS: EstadoPedido[] = ["pendiente", "revision"];

type PedidoGuardado = {
  folio: string;
  token: string;
  nombre: string;
  correo: string;
  celular: string;
  comprobante: string;
  tipoComprobante: string;
  estado: EstadoPedido;
  /** Cuántos códigos compró (el precio es por unidad). */
  cantidad: number;
  /** Total en Bs que declaró el sitio al crear el pedido. */
  total: number;
  /** Códigos emitidos; el primero también queda en `codigo` por compatibilidad. */
  codigos: string[];
  /** Primer código, para lo que ya leía un solo código (`miCuenta`, correos). */
  codigo: string | null;
  /** ISO: fin de la ventana para anular sin consecuencias. */
  ventanaFin: string;
  /** Quién lo anuló, para poder distinguir una anulación de un abuso. */
  anuladoPor?: "comprador" | "abortado" | "admin" | "vencido";
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
  cantidad: number;
  total: number;
  codigos: string[];
  codigo: string | null;
  /** ISO: hasta cuándo se puede anular. */
  ventanaFin: string;
  nota: string;
  creado: string;
  actualizado: string;
  correo: string;
  celular: string;
};

type ResultadoCrear =
  | { ok: true; folio: string; token: string; pedido: PedidoPublico }
  | {
      ok: false;
      motivo: "datos" | "archivo" | "limite" | "servidor" | "pendiente" | "baneado";
    };

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
  /** ¿Hay clave Ed25519 para emitir códigos nuevos? */
  firmaConfigurada: boolean;
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
  // Los pedidos viejos no tienen los campos nuevos: se normalizan al leer, así
  // el panel y el comprador no ven `undefined` en un pedido de ayer.
  const codigos = Array.isArray(p.codigos) && p.codigos.length ? p.codigos : p.codigo ? [p.codigo] : [];
  const cantidad = Number.isFinite(p.cantidad) && p.cantidad > 0 ? p.cantidad : Math.max(1, codigos.length);
  return {
    folio: p.folio,
    nombre: p.nombre,
    estado: p.estado,
    cantidad,
    total: Number.isFinite(p.total) ? p.total : cantidad * PRECIO_UNIDAD,
    codigos,
    codigo: codigos[0] ?? null,
    ventanaFin: p.ventanaFin ?? p.creado,
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

/**
 * Cupo por IP + tope global para no llenar el repo de pedidos basura.
 *
 * El cupo por IP frena a una persona; el global frena a una botnet rotando IPs
 * que, si no, podría subir 4 MB de comprobantes por pedido y llenar el repo
 * (cada pedido es un commit, y el archivo queda para siempre).
 */
const intentos = new Map<string, { n: number; t: number }>();
const global = { n: 0, t: 0 };
const VENTANA_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 6;
const MAX_GLOBAL = 40;

async function hayCupo(): Promise<boolean> {
  const ip = await obtenerIPCliente();
  const ahora = Date.now();
  if (ahora - global.t > VENTANA_MS) {
    global.t = ahora;
    global.n = 0;
  }
  if (++global.n > MAX_GLOBAL) return false;

  const previo = intentos.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    intentos.set(ip, { n: 1, t: ahora });
    if (intentos.size > 2000) intentos.clear();
    return true;
  }
  previo.n++;
  return previo.n <= MAX_INTENTOS;
}

/**
 * Cupo de LECTURA de pedidos: más holgado que el de creación (consultar el
 * estado es normal y hasta se recarga), pero corta el escaneo masivo de folios,
 * que no tiene otro costo que una llamada a la API de GitHub por intento.
 */
const lecturas = new Map<string, { n: number; t: number }>();
const MAX_LECTURAS = 30;

async function hayCupoLectura(): Promise<boolean> {
  const ip = await obtenerIPCliente();
  const ahora = Date.now();
  const previo = lecturas.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    lecturas.set(ip, { n: 1, t: ahora });
    if (lecturas.size > 2000) lecturas.clear();
    return true;
  }
  previo.n++;
  return previo.n <= MAX_LECTURAS;
}

/** Compara secretos sin cortar en el primer byte distinto (token de pedido). */
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

async function leerPedidos(): Promise<PedidoGuardado[]> {
  const lista = await getJson<PedidoGuardado[]>("datos", ARCHIVO, []);
  return Array.isArray(lista) ? lista.filter((p) => p && typeof p.folio === "string") : [];
}

function ordenarNuevos(lista: PedidoGuardado[]): PedidoGuardado[] {
  return lista.slice().sort((a, b) => (a.creado < b.creado ? 1 : -1)).slice(0, MAX_PEDIDOS);
}

/** Códigos ya entregados en cualquier pedido: nunca se entregan dos veces. */
function codigosEnUso(lista: PedidoGuardado[]): Set<string> {
  const enUso = new Set<string>();
  for (const p of lista) {
    if (p.codigo) enUso.add(p.codigo);
    if (Array.isArray(p.codigos)) for (const c of p.codigos) enUso.add(c);
  }
  return enUso;
}

/** Pedido que hoy impide comprar de nuevo (misma cuenta o mismo correo). */
function pedidoAbierto(
  lista: PedidoGuardado[],
  cuentaId: string | null,
  correo: string,
): PedidoGuardado | undefined {
  return lista.find(
    (p) =>
      ABIERTOS.includes(p.estado) &&
      ((cuentaId && p.cuentaId === cuentaId) || p.correo.toLowerCase() === correo),
  );
}

/**
 * Cierra la ventana de los pedidos vencidos y avisa al dueño.
 *
 * Los Workers no tienen reloj propio ni cron: la transición se resuelve cuando
 * alguien mira los pedidos (el comprador recargando el estado o el dueño
 * abriendo el panel). Es el mismo criterio que usa la cuota de la demo y evita
 * un cron que habría que pagar aparte.
 *
 * Si el correo falla, el pedido igual cambia de estado: el aviso es un extra,
 * el estado es la verdad.
 */
async function cerrarVencidos(lista: PedidoGuardado[]): Promise<PedidoGuardado[]> {
  const ahora = Date.now();
  const vencidos = lista.filter((p) => {
    if (p.estado !== "pendiente") return false;
    const fin = Date.parse(p.ventanaFin ?? "");
    return Number.isFinite(fin) && fin <= ahora;
  });
  if (vencidos.length === 0) return lista;

  const marca = new Date(ahora).toISOString();
  const cerrados = new Set(vencidos.map((p) => p.folio));
  const siguiente = lista.map((p) =>
    cerrados.has(p.folio)
      ? { ...p, estado: "revision" as EstadoPedido, actualizado: marca }
      : p,
  );

  // Se guarda antes de avisar: si el guardado falla, no se manda un correo que
  // después no coincide con lo que muestra el panel.
  const ok = await putJson("datos", ARCHIVO, ordenarNuevos(siguiente), `pedidos: ${cerrados.size} a revisión`);
  if (!ok) return lista;

  if (correoConfigurado()) {
    for (const p of vencidos) {
      try {
        await enviarCorreo({ to: correoAdmin(), ...avisoNuevoPedido(p) });
      } catch (e) {
        console.error("[pedidos] aviso al admin falló:", e instanceof Error ? e.message : e);
      }
    }
  }
  return siguiente;
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
      cantidad?: unknown;
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
    // `Number(null)` es 0 y `Number(undefined)` es NaN: los dos caen en 1, que es
    // el comportamiento de siempre para quien no manda cantidad.
    const cantidadCruda = Math.trunc(Number(data?.cantidad));
    const cantidad = Number.isFinite(cantidadCruda) && cantidadCruda > 0
      ? Math.min(cantidadCruda, MAX_CODIGOS)
      : 1;

    if (cuenta?.baneada) return { ok: false, motivo: "baneado" };
    if (!correoValido(correo)) return { ok: false, motivo: "datos" };
    if (!celularValido(celularCrudo)) return { ok: false, motivo: "datos" };
    const tipo = archivoValido(comprobante);
    if (!tipo) return { ok: false, motivo: "archivo" };
    if (!(await hayCupo())) return { ok: false, motivo: "limite" };

    const folio = `FLX-${azar(8)}`;
    const token = azar(28);
    const ahoraMs = Date.now();
    const ahora = new Date(ahoraMs).toISOString();
    const ruta = `${CARPETA}/${folio}.${tipo.ext}`;

    try {
      // Un pedido abierto por cuenta o por correo bloquea la compra: sin esto
      // se podía subir otro comprobante y terminar con dos pedidos y dos
      // códigos por el mismo pago.
      // Se resuelven las ventanas vencidas antes de mirar: si no, alguien con un
      // pedido que venció hace un minuto sigue bloqueado como «pendiente».
      const existentes = await cerrarVencidos(await leerPedidos());
      const abierto = pedidoAbierto(existentes, cuenta?.id ?? null, correo);
      if (abierto) {
        return { ok: false, motivo: "pendiente" };
      }

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
        cantidad,
        total: PRECIO_UNIDAD * cantidad,
        codigos: [],
        codigo: null,
        ventanaFin: new Date(ahoraMs + VENTANA_ANULACION_MS).toISOString(),
        nota: "",
        cuentaId: cuenta?.id ?? null,
        creado: ahora,
        actualizado: ahora,
      };

      const ok = await putJson(
        "datos",
        ARCHIVO,
        ordenarNuevos([pedido, ...existentes]),
        `pedido ${folio}: nuevo`,
      );
      if (!ok) return { ok: false, motivo: "servidor" };

      // El aviso al dueño NO sale acá: sale cuando se cierra la ventana de
      // anulación (`cerrarVencidos`). Si el comprador se arrepiente a los dos
      // minutos, el correo nunca llega y el panel no tiene ruido que limpiar.
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
    if (!(await hayCupoLectura())) return { ok: false, motivo: "limite" };
    try {
      // Se cierran TODOS los vencidos y después se busca el folio: el pedido que
      // el comprador está mirando es justamente el que puede haber vencido.
      const lista = await cerrarVencidos(await leerPedidos());
      const pedido = lista.find((p) => p.folio === folio);
      if (!pedido || !igualSeguro(pedido.token, token)) return { ok: false, motivo: "no_encontrado" };
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
      const lista = await cerrarVencidos(await leerPedidos());
      const pedido = lista.find((p) => p.folio === folio);
      if (!pedido || !mismoContacto(pedido, contacto)) return { ok: false, motivo: "no_encontrado" };
      return { ok: true, token: pedido.token, pedido: publico(pedido) };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

/**
 * Anulación normal del comprador, sólo dentro de la ventana.
 *
 * Después de la ventana el pedido ya está en revisión y la anulación pasa a ser
 * una decisión del dueño (`actualizarPedido` → cancelado).
 */
export const anularPedido = createServerFn({ method: "POST" })
  .validator((d: { folio?: unknown; token?: unknown }) => d)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; pedido: PedidoPublico } | { ok: false; motivo: "datos" | "no_encontrado" | "fuera_de_tiempo" | "servidor" }
    > => {
      const folio = limpiar(data?.folio, 20).toUpperCase();
      const token = limpiar(data?.token, 64);
      if (!folio || !token) return { ok: false, motivo: "datos" };

      try {
        const lista = await cerrarVencidos(await leerPedidos());
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0 || !igualSeguro(lista[indice].token, token)) {
          return { ok: false, motivo: "no_encontrado" };
        }
        const actual = lista[indice];
        if (actual.estado !== "pendiente") return { ok: false, motivo: "fuera_de_tiempo" };

        const actualizado: PedidoGuardado = {
          ...actual,
          estado: "cancelado",
          anuladoPor: "comprador",
          nota: actual.nota || "Anulado por el comprador dentro del plazo",
          actualizado: new Date().toISOString(),
        };
        const siguiente = lista.slice();
        siguiente[indice] = actualizado;
        const ok = await putJson(
          "datos",
          ARCHIVO,
          ordenarNuevos(siguiente),
          `pedido ${folio}: anulado por el comprador`,
        );
        if (!ok) return { ok: false, motivo: "servidor" };
        return { ok: true, pedido: publico(actualizado) };
      } catch (e) {
        console.error("[pedidos] no se pudo anular:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    },
  );

/**
 * Abortar una compra: el caso extremo.
 *
 * No es la anulación normal. Acá el comprador ya usó el sistema para subir un
 * comprobante y después decide que no quiere nada: se cancela el pedido Y se da
 * de baja la cuenta, para que no pueda volver a hacer el mismo circuito. La
 * anulación normal (dentro de la ventana, sin consecuencias) es `anularPedido`.
 */
export const abortarCompra = createServerFn({ method: "POST" })
  .validator((d: { folio?: unknown; token?: unknown }) => d)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; baneada: boolean }
      | { ok: false; motivo: "datos" | "no_encontrado" | "no_es_tu_pedido" | "fuera_de_tiempo" | "servidor" }
    > => {
      const folio = limpiar(data?.folio, 20).toUpperCase();
      const token = limpiar(data?.token, 64);
      if (!folio || !token) return { ok: false, motivo: "datos" };

      try {
        const lista = await cerrarVencidos(await leerPedidos());
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0 || !igualSeguro(lista[indice].token, token)) {
          return { ok: false, motivo: "no_encontrado" };
        }
        const actual = lista[indice];
        // Abortar sólo tiene sentido mientras la ventana sigue abierta: si ya
        // pasó, el pedido es del dueño y la baja de la cuenta no corresponde.
        if (actual.estado !== "pendiente") return { ok: false, motivo: "fuera_de_tiempo" };

        const actualizado: PedidoGuardado = {
          ...actual,
          estado: "cancelado",
          anuladoPor: "abortado",
          codigos: [],
          codigo: null,
          nota: "Compra abortada por el comprador (cuenta dada de baja)",
          actualizado: new Date().toISOString(),
        };
        const siguiente = lista.slice();
        siguiente[indice] = actualizado;
        const ok = await putJson("datos", ARCHIVO, ordenarNuevos(siguiente), `pedido ${folio}: abortado`);
        if (!ok) return { ok: false, motivo: "servidor" };

        const baneada = actual.cuentaId
          ? await banearCuenta(actual.cuentaId, `abortó la compra ${folio}`)
          : false;
        return { ok: true, baneada };
      } catch (e) {
        console.error("[pedidos] no se pudo abortar:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    },
  );

/* ── Admin ─────────────────────────────────────────────────────────────── */

export const adminPedidos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoAdmin> => {
    if (!await adminValido(data?.admin)) return { ok: false, motivo: "admin" };
    try {
      // Abrir el panel es también lo que cierra las ventanas vencidas y manda
      // los avisos: así el dueño ve el pedido ya en revisión desde el minuto 10.
      const lista = ordenarNuevos(await cerrarVencidos(await leerPedidos()));
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
    if (!await adminValido(data?.admin)) return null;
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
        firmaConfigurada: firmaConfigurada(),
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
 * Espeja el CONTEO del registro real de códigos (`bitly_codes_premium`) dentro
 * de `bitly-data`.
 *
 * La fuente de verdad sigue siendo `bitly_codes_premium` (la app ya lee ese
 * repo); esto sólo deja un resumen versionado en la base del sitio. Se escriben
 * los conteos, NUNCA los códigos: antes este espejo guardaba el registro
 * completo, así que una filtración de `bitly-data` regalaba todos los códigos
 * válidos y duplicaba la superficie de un dato sensible sin que nada lo leyera.
 * Se escribe a pedido del admin, no en cada carga, para no gastar commits.
 */
export const sincronizarCodigos = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: true; total: number } | { ok: false; motivo: string }> => {
    if (!await adminValido(data?.admin)) return { ok: false, motivo: "admin" };
    try {
      const registro = await leerRegistroCodigos();
      const conteo = { activos: 0, usados: 0, cancelados: 0, libres: 0, otros: 0 };
      for (const [, estado] of registro) {
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
    if (!await adminValido(data?.admin)) return null;
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
      cantidad?: unknown;
    }) => d,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; pedido: PedidoPublico; aviso: boolean } | { ok: false; motivo: string }> => {
      if (!await adminValido(data?.admin)) return { ok: false, motivo: "admin" };
      const folio = limpiar(data?.folio, 20).toUpperCase();
      // Se pueden pegar VARIOS códigos separados por coma, espacio o salto de
      // línea: así reasignar a mano un pedido de tres códigos no son tres viajes.
      const pegados = limpiar(data?.codigoPremium, 4000)
        .split(/[\s,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const nota = limpiar(data?.nota, 600);
      const estado = limpiar(data?.estado, 20) as EstadoPedido;
      const estados: EstadoPedido[] = ["pendiente", "revision", "pagado", "enviado", "cancelado"];
      const cantidadCruda = Math.trunc(Number(data?.cantidad));
      if (!folio) return { ok: false, motivo: "datos" };
      if (pegados.some((c) => c.length < 20 || c.length > 500)) return { ok: false, motivo: "codigo" };
      if (estado && !estados.includes(estado)) return { ok: false, motivo: "datos" };

      try {
        const lista = await cerrarVencidos(await leerPedidos());
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0) return { ok: false, motivo: "no_encontrado" };

        const actual = lista[indice];
        const cantidad = Number.isFinite(cantidadCruda) && cantidadCruda > 0
          ? Math.min(cantidadCruda, MAX_CODIGOS)
          : publico(actual).cantidad;
        const nuevoEstado: EstadoPedido = estado || actual.estado;

        // Códigos que ya tiene el pedido (incluye pedidos viejos con uno solo).
        let codigos = Array.isArray(actual.codigos) && actual.codigos.length
          ? [...actual.codigos]
          : actual.codigo
            ? [actual.codigo]
            : [];

        // Códigos de otros pedidos: no se pueden repetir.
        const enUso = codigosEnUso(lista.filter((_, i) => i !== indice));

        if (pegados.length > 0) {
          for (const codigo of pegados) {
            if (enUso.has(codigo)) return { ok: false, motivo: "codigo_repetido" };
            enUso.add(codigo);
          }
          codigos = pegados;
        }

        // Volver atrás (pendiente / revisión) o cancelar SUELTA los códigos: el
        // pedido deja de estar entregado y esos códigos no quedan colgados acá.
        const suelta = nuevoEstado === "pendiente" || nuevoEstado === "revision" || nuevoEstado === "cancelado";
        if (suelta && pegados.length === 0) codigos = [];

        // La cantidad es la que manda: si el dueño la baja, sobran códigos y se
        // descartan los últimos (los que no llegó a usar).
        if (codigos.length > cantidad) codigos = codigos.slice(0, cantidad);

        // Validar el pago es lo que emite los códigos: la cantidad comprada, ni
        // una más ni una menos. Si ya había códigos pegados a mano, se completan.
        if ((nuevoEstado === "pagado" || nuevoEstado === "enviado") && codigos.length < cantidad) {
          const emision = await emitirCodigos(cantidad - codigos.length, folio, enUso);
          if (!emision.ok) {
            return {
              ok: false,
              motivo: emision.motivo === "sin_stock" ? "sin_stock" : "sin_clave",
            };
          }
          codigos = [...codigos, ...emision.codigos];
        }

        const ahora = new Date().toISOString();
        const actualizado: PedidoGuardado = {
          ...actual,
          estado: nuevoEstado,
          cantidad,
          total: PRECIO_UNIDAD * cantidad,
          codigos,
          codigo: codigos[0] ?? null,
          // Reabrir un pedido reinicia el plazo: «dame tiempo» no puede
          // significar un plazo que ya venció hace tres días.
          ventanaFin:
            nuevoEstado === "pendiente"
              ? new Date(Date.now() + VENTANA_ANULACION_MS).toISOString()
              : actual.ventanaFin,
          anuladoPor: nuevoEstado === "cancelado" ? actual.anuladoPor ?? "admin" : undefined,
          nota: nota || actual.nota,
          actualizado: ahora,
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

        // Aviso automático al comprador: antes había que acordarse de apretar
        // «Enviar por correo». Un fallo de correo no revierte el guardado, sólo
        // deja `aviso: false` para que el panel lo muestre.
        let aviso = false;
        const cambio =
          actualizado.estado !== actual.estado ||
          actualizado.codigos.join("|") !== (actual.codigos ?? []).join("|") ||
          actualizado.codigo !== actual.codigo;
        if (
          cambio &&
          actualizado.estado !== "cancelado" &&
          actualizado.codigo &&
          correoValido(actualizado.correo) &&
          correoConfigurado()
        ) {
          try {
            const cuerpo = cuerpoCorreo(actualizado);
            const envio = await enviarCorreo({
              to: actualizado.correo,
              subject: cuerpo.subject,
              text: cuerpo.text,
              html: cuerpo.html,
              replyTo: correoAdmin(),
            });
            aviso = envio.ok;
            if (!envio.ok) console.error("[pedidos] aviso al comprador falló:", envio.motivo);
          } catch (e) {
            console.error("[pedidos] aviso al comprador falló:", e instanceof Error ? e.message : e);
          }
        }

        return { ok: true, pedido: publico(actualizado), aviso };
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
      if (!await adminValido(data?.admin)) return { ok: false, motivo: "admin" };
      const folio = limpiar(data?.folio, 20).toUpperCase();
      if (!folio) return { ok: false, motivo: "datos" };

      try {
        const lista = await leerPedidos();
        const indice = lista.findIndex((p) => p.folio === folio);
        if (indice < 0) return { ok: false, motivo: "datos" };
        const pedido = lista[indice];
        const codigos = Array.isArray(pedido.codigos) && pedido.codigos.length
          ? pedido.codigos
          : pedido.codigo
            ? [pedido.codigo]
            : [];
        if (codigos.length === 0) return { ok: false, motivo: "sin_codigo" };
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

/**
 * Elimina un pedido y su comprobante.
 *
 * Sirve para la retención de datos: un comprobante de transferencia no tiene
 * por qué vivir para siempre en el repo. Primero se borra el archivo (si ya no
 * está, sigue), después la fila del pedido: así un fallo a mitad de camino se
 * puede reintentar sin dejar huérfanos.
 */
export const eliminarPedido = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; folio?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; motivo: "admin" | "datos" | "servidor" }> => {
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    const folio = limpiar(data?.folio, 20).toUpperCase();
    if (!folio) return { ok: false, motivo: "datos" };

    try {
      const lista = await leerPedidos();
      const pedido = lista.find((p) => p.folio === folio);
      if (!pedido) return { ok: false, motivo: "datos" };

      // Sólo se borra dentro de la carpeta de comprobantes: el campo viene del
      // repo, pero no queremos que un dato manipulado borre otro archivo.
      if (pedido.comprobante.startsWith(`${CARPETA}/`)) {
        const borrado = await borrarArchivo(
          "datos",
          pedido.comprobante,
          `pedido ${folio}: comprobante eliminado`,
        );
        if (!borrado) return { ok: false, motivo: "servidor" };
      }

      const ok = await putJson(
        "datos",
        ARCHIVO,
        lista.filter((p) => p.folio !== folio),
        `pedido ${folio}: eliminado`,
      );
      if (!ok) return { ok: false, motivo: "servidor" };
      return { ok: true };
    } catch (e) {
      console.error("[pedidos] no se pudo eliminar:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

/** Prueba de configuración del correo. Sólo el admin puede dispararla. */
export const probarCorreo = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown; para?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; motivo?: string }> => {
    if (!await adminValido(data?.admin)) return { ok: false, motivo: "admin" };
    // Se puede probar contra otro buzón (el propio admin elige), pero nunca
    // contra una dirección arbitraria que venga del navegador sin validar.
    const pedido = limpiar(data?.para, 120).toLowerCase();
    const destino = pedido && correoValido(pedido) ? pedido : correoAdmin();
    const envio = await enviarCorreo({ to: destino, ...correoDePrueba() });
    return envio.ok ? { ok: true } : { ok: false, motivo: envio.motivo };
  });