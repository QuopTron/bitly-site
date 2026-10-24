/**
 * Cuentas de usuario del sitio.
 *
 * Viven en `bitly-data` (`data/cuentas.json`), igual que las opiniones y los
 * pedidos: JSON versionado en el repo privado, sin Supabase ni una base aparte.
 * La contraseña NUNCA se guarda en claro: se deriva con PBKDF2-SHA256 y una sal
 * aleatoria por cuenta.
 *
 * La sesión es un token firmado con HMAC (payload + firma) que el navegador
 * guarda en `localStorage` y manda en cada llamada. El servidor no guarda
 * sesiones, así que sobrevive a reinicios y a los distintos isolates del Worker.
 * El secreto sale de `BITLY_SESSION_SECRET`; si no está, se deriva del token de
 * datos que el sitio ya necesita para leer/escribir el repo.
 *
 * Tres orígenes posibles:
 *
 *   propia    la persona se registra en el sitio y confirma su correo con un
 *             código de 6 dígitos antes de poder entrar.
 *   invitada  alguien (el dueño o un comprador) le asigna un código Premium y
 *             el sitio le crea la cuenta con usuario y contraseña por defecto:
 *             el correo con las credenciales ES la confirmación. Al entrar por
 *             primera vez se le pide cambiar la contraseña.
 *
 * El Premium vive en la CUENTA (`codigo`), no en el pedido: así la demo, “Mi
 * cuenta” y el panel ven lo mismo en el acto. Los pedidos se siguen leyendo
 * para el historial y para los códigos que faltan repartir.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, putJson } from "@/server/github-store";
import { obtenerIPCliente } from "@/server/ip";
import { correoAdmin, correoConfigurado, enviarCorreo } from "@/server/correo";
import {
  avisoCuentaEliminada,
  correoCambioCodigo,
  correoConfirmacion,
} from "@/server/correo-cuenta";
import { registrarEmitidos, soltarEmitido, soltarEmitidosDeCuenta } from "@/server/codigos-emitidos";
import { conCerrojo } from "@/server/cerrojo";

const ARCHIVO = "data/cuentas.json";
const ARCHIVO_PEDIDOS = "data/pedidos.json";
const MAX_CUENTAS = 5_000;
/**
 * Iteraciones de PBKDF2.
 *
 * 100.000 es el TOPE del runtime de Cloudflare: por encima responde
 * "Pbkdf2 failed: iteration counts above 100000 are not supported". Con 120.000
 * el alta y el login andaban en Node (y en `wrangler pages dev`), pero en
 * producción cualquier registro terminaba en "no pudimos completar la
 * operación" y cualquier login en "correo o contraseña incorrectos", porque
 * `verificarClave` se come la excepción y devuelve `false`. No subir este número:
 * si algún día hace falta más, hay que cambiar de algoritmo (scrypt/Argon2 vía
 * WASM), no de iteraciones.
 */
const ITERACIONES = 100_000;
/** Cuentas viejas creadas con más iteraciones no se pueden verificar en Workers. */
const ITERACIONES_MAX = 100_000;
const TTL_SESION_MS = 30 * 24 * 60 * 60 * 1000;
/** Un código de confirmación dura 15 minutos. */
const CODIGO_TTL_MS = 15 * 60 * 1000;
/** Intentos por código antes de invalidarlo. */
const MAX_INTENTOS_CODIGO = 8;
/** Cada cuánto se escribe la actividad de una cuenta (un commit por usuario). */
const ACTIVIDAD_ESCRITURA_MS = 5 * 60 * 1000;
/** Una cuenta cuenta como «en línea» si latió en los últimos 6 minutos. */
const EN_LINEA_MS = 6 * 60 * 1000;

export type CuentaPublica = {
  id: string;
  usuario: string;
  nombre: string;
  correo: string;
  creado: string;
  actualizado: string;
};

export type PedidoDeCuenta = {
  folio: string;
  estado: string;
  codigo: string | null;
  nota: string;
  creado: string;
  actualizado: string;
};

/** Lo que la cuenta tiene en Premium, con el folio que lo originó. */
export type PremiumDeCuenta = {
  codigo: string;
  /** Folio del pedido que lo asignó (vacío cuando vino de una invitación). */
  pedido: string;
  estado: string;
  /** ISO: cuándo se asignó el código. */
  desde: string;
};

type Pendiente = {
  tipo: "alta" | "clave" | "usuario";
  hash: string;
  /** Valor propuesto (usuario nuevo) para los cambios que lo necesitan. */
  valor?: string;
  expira: number;
  intentos: number;
};

type CuentaGuardada = CuentaPublica & {
  hash: string;
  salt: string;
  iteraciones: number;
  ultimoAcceso: string;
  /** Último latido de la sesión; con esto el panel mide quién está en línea. */
  ultimaActividad?: string;
  /** El correo se confirmó con el código (o con la invitación). */
  correoConfirmado?: boolean;
  origen?: "propia" | "invitada";
  /** Contraseña generada por el sitio: hay que cambiarla al entrar. */
  clavePorDefecto?: boolean;
  /** Código Premium asignado a la cuenta. */
  codigo?: string | null;
  premiumDesde?: string;
  premiumPedido?: string;
  /** Quién la invitó (id de cuenta) y con qué pedido. */
  invitadaPor?: string | null;
  pedidoOrigen?: string | null;
  /** Confirmación pendiente (alta, cambio de clave o de usuario). */
  pendiente?: Pendiente;
  /**
   * Cuenta dada de baja a mano.
   *
   * Solo se llega acá por el caso extremo (abortar la compra) o cuando la
   * persona borra su cuenta. Una cuenta baneada no puede entrar ni comprar; los
   * pedidos ya hechos no se tocan, para no perder la trazabilidad.
   */
  baneada?: boolean;
  motivoBaneo?: string;
  /** Baja pedida por la propia persona. */
  eliminada?: boolean;
  eliminadaEn?: string;
  /** Código que se liberó al darse de baja (para avisar en el panel). */
  codigoLiberado?: string | null;
};

type ResultadoSesion =
  | { ok: true; token: string; cuenta: CuentaPublica }
  | {
      ok: false;
      motivo: "datos" | "existe" | "limite" | "baneada" | "servidor" | "sin_confirmar" | "codigo" | "expirado";
    };

export type ResultadoRegistro =
  | { ok: true; pendiente: true; correo: string; usuario: string; enviado: boolean }
  | { ok: true; pendiente: false; token: string; cuenta: CuentaPublica }
  | { ok: false; motivo: "datos" | "existe" | "limite" | "baneada" | "servidor" };

type ResultadoMiCuenta =
  | {
      ok: true;
      cuenta: CuentaPublica;
      pedidos: PedidoDeCuenta[];
      premium: PremiumDeCuenta | null;
      debeCambiarClave: boolean;
      correoConfirmado: boolean;
    }
  | { ok: false; motivo: "sesion" | "servidor" };

export type CuentaAdmin = {
  id: string;
  usuario: string;
  correo: string;
  origen: "propia" | "invitada";
  premium: boolean;
  codigo: string | null;
  correoConfirmado: boolean;
  debeCambiarClave: boolean;
  eliminada: boolean;
  baneada: boolean;
  creado: string;
  ultimoAcceso: string;
  ultimaActividad: string;
  enLinea: boolean;
  invitadaPor: string | null;
  pedidoPremium: string | null;
  codigoLiberado: string | null;
};

export type ResumenCuentas = {
  total: number;
  enLinea: number;
  premium: number;
  invitadas: number;
  porConfirmar: number;
  eliminadas: number;
  baneadas: number;
};

type PedidoCrudo = {
  folio?: unknown;
  estado?: unknown;
  codigo?: unknown;
  nota?: unknown;
  creado?: unknown;
  actualizado?: unknown;
  correo?: unknown;
  cuentaId?: unknown;
  ventanaFin?: unknown;
};

/* ── Utilidades ───────────────────────────────────────────────────────── */

function limpiar(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 120;
}

/** Usuario visible y de login: minúsculas, sin espacios, 3 a 20 caracteres. */
function usuarioValido(usuario: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,19}$/.test(usuario);
}

function azar(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Código de confirmación de 6 dígitos (con ceros a la izquierda). */
function codigoAzar(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/** Contraseña por defecto legible: sin 0/O ni 1/l para dictarla por teléfono. */
const CLAVE_ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function clavePorDefecto(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CLAVE_ALFABETO[b % CLAVE_ALFABETO.length]).join("");
}

function b64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

function deB64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function deB64url(texto: string): Uint8Array {
  const normal = texto.replace(/-/g, "+").replace(/_/g, "/");
  return deB64(normal + "=".repeat((4 - (normal.length % 4)) % 4));
}

export async function hashClave(clave: string, salt: Uint8Array, iteraciones: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clave),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: iteraciones, hash: "SHA-256" },
    material,
    256,
  );
  return b64(new Uint8Array(bits));
}

export async function verificarClave(
  clave: string,
  salt: string,
  hash: string,
  iteraciones: number,
): Promise<boolean> {
  // Un registro con más iteraciones que el tope no se puede recalcular acá:
  // `deriveBits` tira antes de comparar. Se rechaza explícito en vez de dejar
  // que la excepción se confunda con "clave incorrecta".
  if (!Number.isFinite(iteraciones) || iteraciones < 1 || iteraciones > ITERACIONES_MAX) return false;
  try {
    const calculado = await hashClave(clave, deB64(salt), iteraciones);
    return mismoTexto(calculado, hash);
  } catch {
    return false;
  }
}

/** Compara sin cortar en el primer byte distinto. */
function mismoTexto(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/**
 * El código de confirmación se guarda hasheado: si alguien lee el JSON del repo
 * no puede usarlo para entrar a una cuenta ajena.
 */
async function hashCodigo(id: string, codigo: string): Promise<string> {
  const bytes = new TextEncoder().encode(`bitly-codigo-v1:${id}:${codigo}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return b64(new Uint8Array(digest));
}

let avisoSecreto = false;

function secretoSesion(): string {
  const dedicado = process.env.BITLY_SESSION_SECRET;
  const base = dedicado || process.env.BITLY_DATA_TOKEN || process.env.BITLY_CODES_TOKEN || "";
  if (!base) throw new Error("Falta BITLY_SESSION_SECRET en el servidor");
  // Usar un PAT de GitHub como clave HMAC funciona, pero mezcla dos secretos con
  // vidas distintas: rotar el token (o revocarlo) cierra todas las sesiones, y
  // el PAT queda expuesto a dos usos. Se avisa una vez por isolate.
  if (!dedicado && !avisoSecreto) {
    avisoSecreto = true;
    console.warn(
      "[cuentas] BITLY_SESSION_SECRET no está definido: las sesiones se firman con el token de GitHub. " +
        "Definí un secreto propio (16+ caracteres) para separar las dos claves.",
    );
  }
  return `bitly-session-v1:${base}`;
}

async function llaveSesion(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretoSesion()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

type CargaSesion = { c: string; e: number };

async function firmarToken(id: string): Promise<string> {
  const carga: CargaSesion = { c: id, e: Date.now() + TTL_SESION_MS };
  const payload = new TextEncoder().encode(JSON.stringify(carga));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", await llaveSesion(), payload));
  return `${b64url(payload)}.${b64url(firma)}`;
}

async function idDeToken(token: string): Promise<string | null> {
  if (!token || token.length > 500) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  try {
    const payload = deB64url(partes[0]);
    const firma = deB64url(partes[1]);
    const valida = await crypto.subtle.verify(
      "HMAC",
      await llaveSesion(),
      firma as BufferSource,
      payload as BufferSource,
    );
    if (!valida) return null;
    const carga = JSON.parse(new TextDecoder().decode(payload)) as CargaSesion;
    if (!carga?.c || !Number.isFinite(carga.e) || carga.e <= Date.now()) return null;
    return carga.c;
  } catch {
    return null;
  }
}

/** Usuario a partir del correo, para cuentas viejas y para las invitaciones. */
function usuarioBase(correo: string): string {
  const local = (correo.split("@")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
  return (local.length >= 3 ? local : `bitly${local}`).slice(0, 20);
}

/** Las cuentas anteriores al login por usuario no tienen `usuario`: se deriva. */
function usuarioDe(c: CuentaGuardada): string {
  const guardado = String(c.usuario ?? "").trim().toLowerCase();
  return guardado || usuarioBase(c.correo);
}

function publica(c: CuentaGuardada): CuentaPublica {
  const usuario = usuarioDe(c);
  return {
    id: c.id,
    usuario,
    nombre: c.nombre?.trim() || usuario,
    correo: c.correo,
    creado: c.creado,
    actualizado: c.actualizado,
  };
}

function buscarPorIdentificador(cuentas: CuentaGuardada[], identificador: string): CuentaGuardada | null {
  const id = identificador.trim().toLowerCase();
  if (!id) return null;
  return (
    cuentas.find((c) => c.correo === id) ??
    cuentas.find((c) => usuarioDe(c) === id) ??
    null
  );
}

function usuarioOcupado(cuentas: CuentaGuardada[], usuario: string, exceptoId?: string): boolean {
  return cuentas.some((c) => c.id !== exceptoId && usuarioDe(c) === usuario);
}

/** Un usuario libre: el pedido, y si ya existe, con un número al final. */
function usuarioLibre(cuentas: CuentaGuardada[], correo: string, exceptoId?: string): string {
  const base = usuarioBase(correo);
  if (!usuarioOcupado(cuentas, base, exceptoId)) return base;
  for (let n = 2; n < 100; n++) {
    const candidato = `${base.slice(0, 16)}${n}`;
    if (!usuarioOcupado(cuentas, candidato, exceptoId)) return candidato;
  }
  return `${base.slice(0, 13)}${azar(3)}`;
}

const intentos = new Map<string, { n: number; t: number }>();
const VENTANA_MS = 10 * 60 * 1000;

/**
 * Tope por IP sumando TODOS los correos.
 *
 * El cupo de `login|<correo>` frena la fuerza bruta contra una cuenta; este
 * frena el caso contrario: probar una clave filtrada contra cientos de correos
 * distintos desde la misma IP (credential stuffing), que el cupo por correo no
 * vería porque cada clave sería la primera.
 */
const porIp = new Map<string, { n: number; t: number }>();
const MAX_INGRESOS_POR_IP = 30;

function hayCupoIp(ip: string): boolean {
  const ahora = Date.now();
  const previo = porIp.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    porIp.set(ip, { n: 1, t: ahora });
    if (porIp.size > 2000) porIp.clear();
    return true;
  }
  previo.n++;
  return previo.n <= MAX_INGRESOS_POR_IP;
}

function hayCupo(clave: string, max: number): boolean {
  const ahora = Date.now();
  const previo = intentos.get(clave);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    intentos.set(clave, { n: 1, t: ahora });
    return true;
  }
  previo.n++;
  return previo.n <= max;
}

async function claveDeIntento(extra: string): Promise<string> {
  let ip = "anonima";
  try {
    ip = await obtenerIPCliente();
  } catch {
    /* fuera de una petición HTTP */
  }
  return `${ip}|${extra}`;
}

async function leerCuentas(): Promise<CuentaGuardada[]> {
  const lista = await getJson<CuentaGuardada[]>("datos", ARCHIVO, []);
  return Array.isArray(lista) ? lista.filter((c) => c && typeof c.id === "string") : [];
}

async function guardar(lista: CuentaGuardada[], mensaje: string): Promise<boolean> {
  return putJson("datos", ARCHIVO, lista, mensaje);
}

/* ── Sesión reutilizable por pedidos ──────────────────────────────────── */

/** Devuelve la cuenta del token o `null` si la firma/vencimiento no valen. */
export async function cuentaDeToken(token: string | null | undefined): Promise<CuentaGuardada | null> {
  const limpio = String(token ?? "").trim();
  if (!limpio) return null;
  const id = await idDeToken(limpio);
  if (!id) return null;
  const cuenta = (await leerCuentas()).find((c) => c.id === id);
  if (!cuenta || cuenta.eliminada) return null;
  return cuenta;
}

/** Cuenta por id (para asignaciones y pedidos). */
export async function cuentaPorId(id: string): Promise<CuentaGuardada | null> {
  if (!id) return null;
  return (await leerCuentas()).find((c) => c.id === id) ?? null;
}

export type CodigoAsignado = {
  cuentaId: string;
  usuario: string;
  correo: string;
  /** La persona ya entró al menos una vez (o cambió la clave por defecto). */
  aceptada: boolean;
};

/** Mapa código → cuenta, para saber qué está entregado y a quién. */
export async function codigosAsignados(): Promise<Map<string, CodigoAsignado>> {
  const mapa = new Map<string, CodigoAsignado>();
  for (const c of await leerCuentas()) {
    if (!c.codigo || c.eliminada) continue;
    mapa.set(c.codigo, {
      cuentaId: c.id,
      usuario: usuarioDe(c),
      correo: c.correo,
      aceptada: !c.clavePorDefecto || Boolean(c.ultimoAcceso),
    });
  }
  return mapa;
}

/** Cuenta activa por correo (para reasignar un código a alguien que ya la tiene). */
export async function cuentaPorCorreo(correo: string): Promise<CuentaGuardada | null> {
  const buscado = String(correo ?? "").trim().toLowerCase();
  if (!buscado) return null;
  return (await leerCuentas()).find((c) => c.correo === buscado && !c.eliminada) ?? null;
}

/**
 * Da de baja una cuenta invitada que todavía no entró.
 *
 * Es lo que pasa cuando el comprador revoca una invitación para entregarle el
 * código a otra persona: la cuenta deja de existir (sus credenciales dejan de
 * servir) y el código vuelve a estar libre.
 */
export async function darDeBajaInvitada(cuentaId: string): Promise<string | null> {
  if (!cuentaId) return null;
  try {
    const cuentas = await leerCuentas();
    const indice = cuentas.findIndex((c) => c.id === cuentaId);
    if (indice < 0) return null;
    const codigo = cuentas[indice].codigo ?? null;
    const siguiente = cuentas.slice();
    siguiente[indice] = {
      ...cuentas[indice],
      eliminada: true,
      eliminadaEn: new Date().toISOString(),
      codigo: null,
      codigoLiberado: codigo,
      premiumPedido: undefined,
      premiumDesde: undefined,
      pendiente: undefined,
      actualizado: new Date().toISOString(),
    };
    const ok = await guardar(siguiente, `cuenta ${cuentaId}: invitación revocada`);
    if (!ok) return null;
    await soltarEmitidosDeCuenta(cuentaId).catch(() => false);
    return codigo;
  } catch {
    return null;
  }
}

/**
 * Baja de una cuenta por abuso (ver `baneada` en `CuentaGuardada`).
 *
 * Se llama desde `abortarCompra`, que es el único camino que llega acá. No se
 * borra la cuenta: se marca, así queda el rastro y el dueño puede revertirlo
 * editando el JSON del repo.
 */
export async function banearCuenta(id: string, motivo: string): Promise<boolean> {
  if (!id) return false;
  try {
    const cuentas = await leerCuentas();
    const indice = cuentas.findIndex((c) => c.id === id);
    if (indice < 0) return false;
    const actualizada: CuentaGuardada = {
      ...cuentas[indice],
      baneada: true,
      motivoBaneo: limpiar(motivo, 200),
      actualizado: new Date().toISOString(),
    };
    const siguiente = cuentas.slice();
    siguiente[indice] = actualizada;
    return guardar(siguiente, `cuenta ${id}: baja por abuso`);
  } catch (e) {
    console.error("[cuentas] no se pudo dar de baja:", e instanceof Error ? e.message : e);
    return false;
  }
}

/* ── Premium de la cuenta ─────────────────────────────────────────────── */

/**
 * Asigna un código Premium a una cuenta, si todavía no tiene uno.
 *
 * La llama el panel al validar un pedido (el primer código va a la cuenta del
 * comprador) y el reparto de códigos al invitar a alguien. No pisa un Premium
 * existente: la cuenta tiene un solo código vigente.
 */
export async function asignarPremiumACuenta(
  cuentaId: string,
  codigo: string,
  folio: string,
): Promise<{ ok: boolean; codigoAnterior?: string | null }> {
  if (!cuentaId || !codigo) return { ok: false };
  try {
    const cuentas = await leerCuentas();
    const indice = cuentas.findIndex((c) => c.id === cuentaId);
    if (indice < 0) return { ok: false };
    const actual = cuentas[indice];
    if (actual.eliminada) return { ok: false };
    if (actual.codigo === codigo) {
      // Ya lo tiene: se reafirma el dueño en la lista de emitidos (una compra
      // anterior lo registró sin cuenta y así la baja no lo liberaba).
      await registrarEmitidos([codigo], folio || actual.premiumPedido || "", cuentaId).catch(() => false);
      return { ok: true };
    }
    if (actual.codigo) return { ok: false, codigoAnterior: actual.codigo };

    const ahora = new Date().toISOString();
    const siguiente = cuentas.slice();
    siguiente[indice] = {
      ...actual,
      codigo,
      premiumDesde: ahora,
      premiumPedido: folio,
      actualizado: ahora,
    };
    const ok = await guardar(siguiente, `cuenta ${cuentaId}: premium ${folio || "invitación"}`);
    // El código firmado ya estaba en la lista, pero sin dueño: se le asigna la
    // cuenta para que una baja lo libere de verdad en la demo.
    if (ok) await registrarEmitidos([codigo], folio, cuentaId).catch(() => false);
    return ok ? { ok: true } : { ok: false };
  } catch (e) {
    console.error("[cuentas] no se pudo asignar el premium:", e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/** Suelta el Premium que vino de un pedido (al volver atrás o cancelarlo). */
export async function soltarPremiumDePedido(folio: string): Promise<boolean> {
  if (!folio) return false;
  try {
    const cuentas = await leerCuentas();
    const liberados = cuentas.filter((c) => c.premiumPedido === folio && c.codigo);
    if (liberados.length === 0) return true;
    const siguiente = cuentas.map((c) =>
      c.premiumPedido === folio
        ? { ...c, codigo: null, premiumPedido: undefined, premiumDesde: undefined, actualizado: new Date().toISOString() }
        : c,
    );
    const ok = await guardar(siguiente, `premium liberado del pedido ${folio}`);
    // El código deja de acreditar en la demo, aunque haya quedado en el correo.
    if (ok) for (const c of liberados) await soltarEmitido(c.codigo ?? "").catch(() => false);
    return ok;
  } catch (e) {
    console.error("[cuentas] no se pudo soltar el premium:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Quita el Premium de una cuenta (al revocar una invitación o darla de baja). */
export async function quitarPremiumDeCuenta(cuentaId: string): Promise<string | null> {
  if (!cuentaId) return null;
  try {
    const cuentas = await leerCuentas();
    const indice = cuentas.findIndex((c) => c.id === cuentaId);
    if (indice < 0) return null;
    const codigo = cuentas[indice].codigo ?? null;
    const siguiente = cuentas.slice();
    siguiente[indice] = {
      ...cuentas[indice],
      codigo: null,
      premiumPedido: undefined,
      premiumDesde: undefined,
      actualizado: new Date().toISOString(),
    };
    const ok = await guardar(siguiente, `cuenta ${cuentaId}: premium liberado`);
    if (ok && codigo) await soltarEmitido(codigo).catch(() => false);
    return codigo;
  } catch {
    return null;
  }
}

/* ── Envío de códigos ─────────────────────────────────────────────────── */

async function enviarCodigo(
  cuenta: CuentaGuardada,
  tipo: "alta" | "clave" | "usuario",
  codigo: string,
): Promise<boolean> {
  if (!correoConfigurado()) return false;
  try {
    const cuerpo =
      tipo === "alta"
        ? correoConfirmacion({ usuario: usuarioDe(cuenta), codigo })
        : correoCambioCodigo({ usuario: usuarioDe(cuenta), codigo, tipo });
    const envio = await enviarCorreo({
      to: cuenta.correo,
      subject: cuerpo.subject,
      text: cuerpo.text,
      html: cuerpo.html,
      replyTo: correoAdmin(),
    });
    return envio.ok;
  } catch (e) {
    console.error("[cuentas] no se pudo enviar el código:", e instanceof Error ? e.message : e);
    return false;
  }
}

/* ── Registro, confirmación e inicio de sesión ────────────────────────── */

export const registrarCuenta = createServerFn({ method: "POST" })
  .validator((d: { nombre?: unknown; usuario?: unknown; correo?: unknown; clave?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoRegistro> => {
    const correo = limpiar(data?.correo, 120).toLowerCase();
    const clave = String(data?.clave ?? "");
    const pedidoUsuario = limpiar(data?.usuario, 20).toLowerCase();
    if (!correoValido(correo) || clave.length < 8 || clave.length > 200) {
      return { ok: false, motivo: "datos" };
    }
    if (pedidoUsuario && !usuarioValido(pedidoUsuario)) return { ok: false, motivo: "datos" };
    if (!hayCupo(await claveDeIntento("registro"), 5)) return { ok: false, motivo: "limite" };

    // Dos llamadas simultáneas leerían el mismo estado y se pisarían:
    // esta entra en fila con las demás que tocan la misma cuenta.
    return conCerrojo(`alta:${correo}`, async () => {
      try {
        const cuentas = await leerCuentas();
        // Un correo dado de baja no se puede volver a registrar: si no, el baneo
        // se esquiva creando la cuenta de nuevo con el mismo correo.
        const previa = cuentas.find((c) => c.correo === correo && !c.eliminada);
        if (previa?.baneada) return { ok: false, motivo: "baneada" };
        if (previa) return { ok: false, motivo: "existe" };
        if (cuentas.length >= MAX_CUENTAS) return { ok: false, motivo: "limite" };

        const usuario = pedidoUsuario || usuarioLibre(cuentas, correo);
        if (usuarioOcupado(cuentas, usuario)) return { ok: false, motivo: "existe" };

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hash = await hashClave(clave, salt, ITERACIONES);
        const ahora = new Date().toISOString();
        const id = azar(12);
        const nombre = limpiar(data?.nombre, 60) || usuario;
        const confirmado = !correoConfigurado();
        const codigo = codigoAzar();
        const cuenta: CuentaGuardada = {
          id,
          usuario,
          nombre,
          correo,
          hash,
          salt: b64(salt),
          iteraciones: ITERACIONES,
          creado: ahora,
          actualizado: ahora,
          ultimoAcceso: ahora,
          ultimaActividad: ahora,
          correoConfirmado: confirmado,
          origen: "propia",
          clavePorDefecto: false,
          codigo: null,
          pendiente: confirmado
            ? undefined
            : {
                tipo: "alta",
                hash: await hashCodigo(id, codigo),
                expira: Date.now() + CODIGO_TTL_MS,
                intentos: 0,
              },
        };

        const ok = await guardar([cuenta, ...cuentas], `cuenta ${id}: alta`);
        if (!ok) return { ok: false, motivo: "servidor" };

        if (confirmado) {
          return { ok: true, pendiente: false, token: await firmarToken(id), cuenta: publica(cuenta) };
        }

        const enviado = await enviarCodigo(cuenta, "alta", codigo);
        return { ok: true, pendiente: true, correo, usuario, enviado };
      } catch (e) {
        console.error("[cuentas] no se pudo registrar:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });

/** Reenvía el código de confirmación de un alta que quedó a medias. */
export const reenviarConfirmacion = createServerFn({ method: "POST" })
  .validator((d: { correo?: unknown }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; motivo?: "datos" | "limite" | "servidor" }> => {
    const correo = limpiar(data?.correo, 120).toLowerCase();
    if (!correoValido(correo)) return { ok: false, motivo: "datos" };
    if (!hayCupo(await claveDeIntento(`reenviar|${correo}`), 4)) return { ok: false, motivo: "limite" };

    try {
      const cuentas = await leerCuentas();
      const indice = cuentas.findIndex((c) => c.correo === correo && !c.eliminada);
      if (indice < 0) return { ok: true };
      const cuenta = cuentas[indice];
      if (cuenta.correoConfirmado || cuenta.baneada) return { ok: true };

      const codigo = codigoAzar();
      const actualizada: CuentaGuardada = {
        ...cuenta,
        pendiente: {
          tipo: "alta",
          hash: await hashCodigo(cuenta.id, codigo),
          expira: Date.now() + CODIGO_TTL_MS,
          intentos: 0,
        },
        actualizado: new Date().toISOString(),
      };
      const siguiente = cuentas.slice();
      siguiente[indice] = actualizada;
      await guardar(siguiente, `cuenta ${cuenta.id}: confirmación reenviada`);
      await enviarCodigo(actualizada, "alta", codigo);
      return { ok: true };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

export const confirmarCuenta = createServerFn({ method: "POST" })
  .validator((d: { identificador?: unknown; correo?: unknown; codigo?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoSesion> => {
    const identificador = limpiar(data?.identificador ?? data?.correo, 120).toLowerCase();
    const codigo = limpiar(data?.codigo, 10);
    if (!identificador || !/^\d{6}$/.test(codigo)) return { ok: false, motivo: "datos" };
    if (!hayCupo(await claveDeIntento(`confirmar|${identificador}`), 8)) {
      return { ok: false, motivo: "limite" };
    }

    try {
      const cuentas = await leerCuentas();
      const indice = cuentas.findIndex((c) => c.correo === identificador || usuarioDe(c) === identificador);
      if (indice < 0) return { ok: false, motivo: "datos" };
      const cuenta = cuentas[indice];
      if (cuenta.eliminada) return { ok: false, motivo: "datos" };
      if (cuenta.baneada) return { ok: false, motivo: "baneada" };
      if (cuenta.correoConfirmado) return { ok: true, token: await firmarToken(cuenta.id), cuenta: publica(cuenta) };

      const pendiente = cuenta.pendiente;
      if (!pendiente || pendiente.tipo !== "alta") return { ok: false, motivo: "expirado" };
      if (pendiente.expira <= Date.now()) return { ok: false, motivo: "expirado" };
      if (pendiente.intentos >= MAX_INTENTOS_CODIGO) return { ok: false, motivo: "expirado" };

      const esperado = await hashCodigo(cuenta.id, codigo);
      if (!mismoTexto(esperado, pendiente.hash)) {
        const siguiente = cuentas.slice();
        siguiente[indice] = {
          ...cuenta,
          pendiente: { ...pendiente, intentos: pendiente.intentos + 1 },
        };
        await guardar(siguiente, `cuenta ${cuenta.id}: código incorrecto`);
        return { ok: false, motivo: "codigo" };
      }

      const ahora = new Date().toISOString();
      const actualizada: CuentaGuardada = {
        ...cuenta,
        correoConfirmado: true,
        pendiente: undefined,
        actualizado: ahora,
        ultimoAcceso: ahora,
        ultimaActividad: ahora,
      };
      const siguiente = cuentas.slice();
      siguiente[indice] = actualizada;
      const ok = await guardar(siguiente, `cuenta ${cuenta.id}: correo confirmado`);
      if (!ok) return { ok: false, motivo: "servidor" };
      return { ok: true, token: await firmarToken(cuenta.id), cuenta: publica(actualizada) };
    } catch (e) {
      console.error("[cuentas] no se pudo confirmar:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const iniciarSesion = createServerFn({ method: "POST" })
  .validator((d: { identificador?: unknown; correo?: unknown; clave?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoSesion> => {
    const identificador = limpiar(data?.identificador ?? data?.correo, 120).toLowerCase();
    const clave = String(data?.clave ?? "");
    if (!identificador || clave.length < 1 || clave.length > 200) {
      return { ok: false, motivo: "datos" };
    }
    const ip = await obtenerIPCliente();
    if (!hayCupoIp(ip)) return { ok: false, motivo: "limite" };
    if (!hayCupo(await claveDeIntento(`login|${identificador}`), 8)) return { ok: false, motivo: "limite" };

    try {
      const cuentas = await leerCuentas();
      const indice = cuentas.findIndex(
        (c) => (c.correo === identificador || usuarioDe(c) === identificador) && !c.eliminada,
      );
      if (indice < 0) {
        // Misma demora que una clave incorrecta: sin esto, un correo sin cuenta
        // contesta al instante y uno registrado tarda lo que tarda PBKDF2, así
        // que cualquiera podría averiguar quién tiene cuenta en el sitio.
        await hashClave(clave, new Uint8Array(16), ITERACIONES);
        return { ok: false, motivo: "datos" };
      }
      const cuenta = cuentas[indice];
      if (!(await verificarClave(clave, cuenta.salt, cuenta.hash, cuenta.iteraciones))) {
        return { ok: false, motivo: "datos" };
      }
      // La baja se avisa DESPUÉS de verificar la clave: si se contestara antes,
      // cualquiera podría averiguar qué cuentas están baneadas probando claves.
      if (cuenta.baneada) return { ok: false, motivo: "baneada" };
      // `false` explícito, no `!campo`: las cuentas anteriores a la confirmación
      // por correo no tienen el campo y tienen que poder entrar.
      if (cuenta.correoConfirmado === false) {
        return { ok: false, motivo: "sin_confirmar" };
      }

      const ahora = Date.now();
      const ahoraIso = new Date(ahora).toISOString();
      const previo = Date.parse(cuenta.ultimoAcceso || "");
      let actualizada = cuenta;
      if (!Number.isFinite(previo) || ahora - previo > 24 * 60 * 60 * 1000) {
        actualizada = { ...cuenta, ultimoAcceso: ahoraIso, ultimaActividad: ahoraIso };
        const siguiente = cuentas.slice();
        siguiente[indice] = actualizada;
        await guardar(siguiente, `cuenta ${cuenta.id}: acceso`);
      }
      return { ok: true, token: await firmarToken(cuenta.id), cuenta: publica(actualizada) };
    } catch (e) {
      console.error("[cuentas] no se pudo iniciar sesión:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Mi cuenta ────────────────────────────────────────────────────────── */

export const miCuenta = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoMiCuenta> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };

    try {
      const crudos = await getJson<PedidoCrudo[]>("datos", ARCHIVO_PEDIDOS, []);
      const ahoraMs = Date.now();
      const pedidos: PedidoDeCuenta[] = (Array.isArray(crudos) ? crudos : [])
        .filter((p) => p.cuentaId === cuenta.id && typeof p.folio === "string")
        .sort((a, b) => (String(a.creado) < String(b.creado) ? 1 : -1))
        .slice(0, 25)
        .map((p) => {
          const crudo = String(p.estado ?? "pendiente");
          // La ventana se resuelve también acá: «Mi cuenta» es lo primero que
          // mira el comprador, y ver «Pendiente» un pedido que ya venció lo
          // deja esperando una anulación que ya no existe.
          const fin = Date.parse(String(p.ventanaFin ?? ""));
          const vencido = crudo === "pendiente" && Number.isFinite(fin) && fin <= ahoraMs;
          return {
            folio: String(p.folio),
            estado: vencido ? "revision" : crudo,
            codigo: typeof p.codigo === "string" && p.codigo ? p.codigo : null,
            nota: String(p.nota ?? ""),
            creado: String(p.creado ?? ""),
            actualizado: String(p.actualizado ?? ""),
          };
        });

      // El Premium de la CUENTA manda. Si es una cuenta vieja que todavía no
      // tiene uno asignado, se cae al pedido (compatibilidad).
      const conCodigo = pedidos.find((p) => p.codigo && p.estado !== "cancelado");
      const premium: PremiumDeCuenta | null = cuenta.codigo
        ? {
            codigo: cuenta.codigo,
            pedido: cuenta.premiumPedido ?? "",
            estado: "activo",
            desde: cuenta.premiumDesde ?? cuenta.actualizado,
          }
        : conCodigo?.codigo
          ? {
              codigo: conCodigo.codigo,
              pedido: conCodigo.folio,
              estado: conCodigo.estado,
              desde: conCodigo.actualizado || conCodigo.creado,
            }
          : null;

      // Latido de actividad: se escribe como mucho cada 5 minutos (cada guardado
      // es un commit en el repo de datos). Con eso el panel distingue en línea.
      const ultima = Date.parse(cuenta.ultimaActividad ?? cuenta.ultimoAcceso ?? "");
      if (!Number.isFinite(ultima) || ahoraMs - ultima > ACTIVIDAD_ESCRITURA_MS) {
        const cuentas = await leerCuentas();
        const indice = cuentas.findIndex((c) => c.id === cuenta.id);
        if (indice >= 0) {
          const siguiente = cuentas.slice();
          siguiente[indice] = { ...cuentas[indice], ultimaActividad: new Date(ahoraMs).toISOString() };
          await guardar(siguiente, `cuenta ${cuenta.id}: actividad`);
        }
      }

      return {
        ok: true,
        cuenta: publica(cuenta),
        pedidos,
        premium,
        debeCambiarClave: Boolean(cuenta.clavePorDefecto),
        correoConfirmado: cuenta.correoConfirmado !== false,
      };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });

/* ── Cambios de contraseña y de usuario (con código al correo) ────────── */

export type ResultadoSolicitud =
  | { ok: true; enviado: boolean }
  | { ok: false; motivo: "sesion" | "datos" | "clave" | "ocupado" | "limite" | "servidor" };

export const solicitarCambio = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown; tipo?: unknown; valor?: unknown; claveActual?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoSolicitud> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };
    const tipo = limpiar(data?.tipo, 10);
    if (tipo !== "clave" && tipo !== "usuario") return { ok: false, motivo: "datos" };
    if (!hayCupo(await claveDeIntento(`cambio|${cuenta.id}|${tipo}`), 5)) {
      return { ok: false, motivo: "limite" };
    }

    // Dos llamadas simultáneas leerían el mismo estado y se pisarían:
    // esta entra en fila con las demás que tocan la misma cuenta.
    return conCerrojo(`cuenta:${cuenta.id}`, async () => {
      try {
        const cuentas = await leerCuentas();
        const indice = cuentas.findIndex((c) => c.id === cuenta.id);
        if (indice < 0) return { ok: false, motivo: "sesion" };

        let valor: string | undefined;
        if (tipo === "clave") {
          const actual = String(data?.claveActual ?? "");
          if (!(await verificarClave(actual, cuenta.salt, cuenta.hash, cuenta.iteraciones))) {
            return { ok: false, motivo: "clave" };
          }
        } else {
          valor = limpiar(data?.valor, 20).toLowerCase();
          if (!usuarioValido(valor)) return { ok: false, motivo: "datos" };
          if (usuarioOcupado(cuentas, valor, cuenta.id)) return { ok: false, motivo: "ocupado" };
          if (valor === usuarioDe(cuenta)) return { ok: false, motivo: "datos" };
        }

        const codigo = codigoAzar();
        const actualizada: CuentaGuardada = {
          ...cuenta,
          pendiente: {
            tipo,
            hash: await hashCodigo(cuenta.id, codigo),
            ...(valor ? { valor } : {}),
            expira: Date.now() + CODIGO_TTL_MS,
            intentos: 0,
          },
          actualizado: new Date().toISOString(),
        };
        const siguiente = cuentas.slice();
        siguiente[indice] = actualizada;
        const ok = await guardar(siguiente, `cuenta ${cuenta.id}: código de ${tipo}`);
        if (!ok) return { ok: false, motivo: "servidor" };

        const enviado = await enviarCodigo(actualizada, tipo, codigo);
        return { ok: true, enviado };
      } catch (e) {
        console.error("[cuentas] no se pudo pedir el cambio:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });

export type ResultadoCambio =
  | { ok: true; cuenta: CuentaPublica; token: string }
  | {
      ok: false;
      motivo: "sesion" | "datos" | "codigo" | "expirado" | "ocupado" | "limite" | "servidor";
    };

export const confirmarCambio = createServerFn({ method: "POST" })
  .validator(
    (d: { token?: unknown; tipo?: unknown; codigo?: unknown; claveNueva?: unknown }) => d,
  )
  .handler(async ({ data }): Promise<ResultadoCambio> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };
    const tipo = limpiar(data?.tipo, 10);
    const codigo = limpiar(data?.codigo, 10);
    if ((tipo !== "clave" && tipo !== "usuario") || !/^\d{6}$/.test(codigo)) {
      return { ok: false, motivo: "datos" };
    }
    if (!hayCupo(await claveDeIntento(`confirmar-cambio|${cuenta.id}`), 10)) {
      return { ok: false, motivo: "limite" };
    }

    // Dos llamadas simultáneas leerían el mismo estado y se pisarían:
    // esta entra en fila con las demás que tocan la misma cuenta.
    return conCerrojo(`cuenta:${cuenta.id}`, async () => {
      try {
        const cuentas = await leerCuentas();
        const indice = cuentas.findIndex((c) => c.id === cuenta.id);
        if (indice < 0) return { ok: false, motivo: "sesion" };
        const actual = cuentas[indice];
        const pendiente = actual.pendiente;
        if (!pendiente || pendiente.tipo !== tipo) return { ok: false, motivo: "expirado" };
        if (pendiente.expira <= Date.now() || pendiente.intentos >= MAX_INTENTOS_CODIGO) {
          return { ok: false, motivo: "expirado" };
        }

        const esperado = await hashCodigo(actual.id, codigo);
        if (!mismoTexto(esperado, pendiente.hash)) {
          const siguiente = cuentas.slice();
          siguiente[indice] = {
            ...actual,
            pendiente: { ...pendiente, intentos: pendiente.intentos + 1 },
          };
          await guardar(siguiente, `cuenta ${actual.id}: código incorrecto`);
          return { ok: false, motivo: "codigo" };
        }

        const ahora = new Date().toISOString();
        let actualizada: CuentaGuardada;
        if (tipo === "clave") {
          const nueva = String(data?.claveNueva ?? "");
          if (nueva.length < 8 || nueva.length > 200) return { ok: false, motivo: "datos" };
          const salt = crypto.getRandomValues(new Uint8Array(16));
          actualizada = {
            ...actual,
            hash: await hashClave(nueva, salt, ITERACIONES),
            salt: b64(salt),
            iteraciones: ITERACIONES,
            clavePorDefecto: false,
            pendiente: undefined,
            actualizado: ahora,
          };
        } else {
          const nuevo = limpiar(pendiente.valor, 20).toLowerCase();
          if (!usuarioValido(nuevo)) return { ok: false, motivo: "datos" };
          if (usuarioOcupado(cuentas, nuevo, actual.id)) return { ok: false, motivo: "ocupado" };
          actualizada = {
            ...actual,
            usuario: nuevo,
            // El «nombre» es solo de presentación: se mantiene el que eligió la
            // persona, salvo que nunca haya puesto uno (venía del usuario).
            nombre: actual.nombre && actual.nombre !== usuarioDe(actual) ? actual.nombre : nuevo,
            pendiente: undefined,
            actualizado: ahora,
          };
        }

        const siguiente = cuentas.slice();
        siguiente[indice] = actualizada;
        const ok = await guardar(siguiente, `cuenta ${actual.id}: ${tipo} cambiado`);
        if (!ok) return { ok: false, motivo: "servidor" };
        return { ok: true, cuenta: publica(actualizada), token: await firmarToken(actual.id) };
      } catch (e) {
        console.error("[cuentas] no se pudo confirmar el cambio:", e instanceof Error ? e.message : e);
        return { ok: false, motivo: "servidor" };
      }
    });
  });

/* ── Baja de la propia cuenta ─────────────────────────────────────────── */

export const eliminarCuenta = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown; clave?: unknown }) => d)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; codigoLiberado: string | null }
      | { ok: false; motivo: "sesion" | "clave" | "limite" | "servidor" }
    > => {
      const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
      if (!cuenta) return { ok: false, motivo: "sesion" };
      const clave = String(data?.clave ?? "");
      if (!hayCupo(await claveDeIntento(`baja|${cuenta.id}`), 5)) return { ok: false, motivo: "limite" };

      // Dos bajas simultáneas de la misma cuenta: la segunda ya la encuentra
      // dada de baja y no vuelve a avisar ni a liberar el código.
      return conCerrojo(`cuenta:${cuenta.id}`, async () => {
        try {
          if (!(await verificarClave(clave, cuenta.salt, cuenta.hash, cuenta.iteraciones))) {
            return { ok: false, motivo: "clave" };
          }
          const cuentas = await leerCuentas();
          const indice = cuentas.findIndex((c) => c.id === cuenta.id);
          if (indice < 0) return { ok: false, motivo: "sesion" };
          // Otra baja igual llegó primero: ya está hecha.
          if (cuentas[indice].eliminada) return { ok: false, motivo: "sesion" };

          const ahora = new Date().toISOString();
          const codigoLiberado = cuentas[indice].codigo ?? null;
          const actualizada: CuentaGuardada = {
            ...cuentas[indice],
            eliminada: true,
            eliminadaEn: ahora,
            codigo: null,
            codigoLiberado,
            premiumPedido: undefined,
            premiumDesde: undefined,
            pendiente: undefined,
            actualizado: ahora,
          };
          const siguiente = cuentas.slice();
          siguiente[indice] = actualizada;
          const ok = await guardar(siguiente, `cuenta ${cuenta.id}: baja pedida`);
          if (!ok) return { ok: false, motivo: "servidor" };

          // El código deja de acreditar en la demo y queda libre para reasignar.
          await soltarEmitidosDeCuenta(cuenta.id).catch(() => false);
          if (correoConfigurado()) {
            try {
              await enviarCorreo({
                to: correoAdmin(),
                ...avisoCuentaEliminada({
                  usuario: usuarioDe(cuenta),
                  correo: cuenta.correo,
                  codigo: codigoLiberado,
                  cuando: ahora,
                }),
              });
            } catch {
              // la baja ya está guardada; el aviso es un extra
            }
          }
          return { ok: true, codigoLiberado };
        } catch (e) {
          console.error("[cuentas] no se pudo dar de baja:", e instanceof Error ? e.message : e);
          return { ok: false, motivo: "servidor" };
        }
      });
    },
  );

/* ── Alta invitada (la usa el reparto de códigos) ─────────────────────── */

export type ResultadoInvitada =
  | { ok: true; cuentaId: string; usuario: string; clave: string }
  | { ok: false; motivo: "existe" | "datos" | "limite" | "servidor" };

/**
 * Crea la cuenta de una persona invitada: solo hace falta el correo.
 *
 * El usuario sale del correo (con sufijo si está ocupado), la contraseña es
 * aleatoria y se marca `clavePorDefecto` para que el primer ingreso la cambie.
 * El correo queda confirmado porque la invitación con las credenciales llegó a
 * esa dirección: no tiene sentido pedir un segundo código.
 */
export async function crearCuentaInvitada(datos: {
  correo: string;
  codigo: string;
  folio: string;
  invitadaPor: string | null;
  usuarioSugerido?: string;
}): Promise<ResultadoInvitada> {
  const correo = limpiar(datos.correo, 120).toLowerCase();
  if (!correoValido(correo)) return { ok: false, motivo: "datos" };

  try {
    const cuentas = await leerCuentas();
    const previa = cuentas.find((c) => c.correo === correo && !c.eliminada);
    if (previa) return { ok: false, motivo: "existe" };
    if (cuentas.length >= MAX_CUENTAS) return { ok: false, motivo: "limite" };

    const sugerido = limpiar(datos.usuarioSugerido, 20).toLowerCase();
    const usuario = sugerido && usuarioValido(sugerido) && !usuarioOcupado(cuentas, sugerido)
      ? sugerido
      : usuarioLibre(cuentas, correo);
    const clave = clavePorDefecto();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashClave(clave, salt, ITERACIONES);
    const ahora = new Date().toISOString();
    const id = azar(12);

    const cuenta: CuentaGuardada = {
      id,
      usuario,
      nombre: usuario,
      correo,
      hash,
      salt: b64(salt),
      iteraciones: ITERACIONES,
      creado: ahora,
      actualizado: ahora,
      ultimoAcceso: "",
      ultimaActividad: "",
      correoConfirmado: true,
      origen: "invitada",
      clavePorDefecto: true,
      codigo: datos.codigo,
      premiumDesde: ahora,
      premiumPedido: datos.folio,
      invitadaPor: datos.invitadaPor,
      pedidoOrigen: datos.folio,
    };

    const ok = await guardar([cuenta, ...cuentas], `cuenta ${id}: invitada`);
    return ok ? { ok: true, cuentaId: id, usuario, clave } : { ok: false, motivo: "servidor" };
  } catch (e) {
    console.error("[cuentas] no se pudo crear la invitada:", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "servidor" };
  }
}

/* ── Panel privado ────────────────────────────────────────────────────── */

export type ResultadoAdminCuentas =
  | { ok: true; cuentas: CuentaAdmin[]; resumen: ResumenCuentas }
  | { ok: false; motivo: "admin" | "servidor" };

export const adminCuentas = createServerFn({ method: "POST" })
  .validator((d: { admin?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoAdminCuentas> => {
    // El panel usa el mismo token que los pedidos; la validación es compartida.
    const { adminValido } = await import("@/server/admin");
    if (!(await adminValido(data?.admin))) return { ok: false, motivo: "admin" };
    try {
      const lista = await leerCuentas();
      const ahora = Date.now();
      const cuentas: CuentaAdmin[] = lista
        .map((c) => {
          const actividad = Date.parse(c.ultimaActividad || c.ultimoAcceso || "");
          return {
            id: c.id,
            usuario: usuarioDe(c),
            correo: c.correo,
            origen: c.origen ?? "propia",
            premium: Boolean(c.codigo),
            codigo: c.codigo ?? null,
            correoConfirmado: Boolean(c.correoConfirmado ?? true),
            debeCambiarClave: Boolean(c.clavePorDefecto),
            eliminada: Boolean(c.eliminada),
            baneada: Boolean(c.baneada),
            creado: c.creado,
            ultimoAcceso: c.ultimoAcceso ?? "",
            ultimaActividad: c.ultimaActividad ?? "",
            enLinea: !c.eliminada && Number.isFinite(actividad) && ahora - actividad < EN_LINEA_MS,
            invitadaPor: c.invitadaPor ?? null,
            pedidoPremium: c.premiumPedido ?? null,
            codigoLiberado: c.codigoLiberado ?? null,
          };
        })
        .sort((a, b) => (a.creado < b.creado ? 1 : -1));

      const resumen: ResumenCuentas = {
        total: cuentas.filter((c) => !c.eliminada).length,
        enLinea: cuentas.filter((c) => c.enLinea).length,
        premium: cuentas.filter((c) => c.premium && !c.eliminada).length,
        invitadas: cuentas.filter((c) => c.origen === "invitada" && !c.eliminada).length,
        porConfirmar: cuentas.filter((c) => !c.correoConfirmado && !c.eliminada).length,
        eliminadas: cuentas.filter((c) => c.eliminada).length,
        baneadas: cuentas.filter((c) => c.baneada && !c.eliminada).length,
      };
      return { ok: true, cuentas, resumen };
    } catch (e) {
      console.error("[cuentas] no se pudo leer el panel:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
