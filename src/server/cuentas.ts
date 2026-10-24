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
 * sesiones, así que sobrevive a reinicios y a los distintos isolates del
 * Worker. El secreto sale de `BITLY_SESSION_SECRET`; si no está, se deriva del
 * token de datos que el sitio ya necesita para leer/escribir el repo.
 *
 * La cuenta se vincula a los pedidos por `cuentaId`, así el comprador ve en su
 * cuenta el código premium que le asignó el admin sin crear otra base de datos.
 * No se filtra por correo: no hay verificación de email, y cualquiera podría
 * registrarse con el correo de otra persona y leer sus pedidos.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, putJson } from "@/server/github-store";
import { obtenerIPCliente } from "@/server/ip";

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

export type CuentaPublica = {
  id: string;
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

/**
 * Lo que la cuenta ya tiene en Premium, sacado del pedido que lo originó.
 *
 * El sitio NO inventa códigos ni estados: esto es un resumen del pedido que el
 * admin marcó, con el mismo `codigo` que después valida el registro. La app y la
 * web leen la misma fuente (`bitly_codes_premium`), así que el código que se ve
 * acá es el mismo que sirve en la app.
 */
export type PremiumDeCuenta = {
  codigo: string;
  /** Folio del pedido que lo asignó. */
  pedido: string;
  estado: string;
  /** ISO: cuándo se cargó el código (última actualización del pedido). */
  desde: string;
};

type CuentaGuardada = CuentaPublica & {
  hash: string;
  salt: string;
  iteraciones: number;
  ultimoAcceso: string;
};

type ResultadoSesion =
  | { ok: true; token: string; cuenta: CuentaPublica }
  | { ok: false; motivo: "datos" | "existe" | "limite" | "servidor" };

type ResultadoMiCuenta =
  | {
      ok: true;
      cuenta: CuentaPublica;
      pedidos: PedidoDeCuenta[];
      premium: PremiumDeCuenta | null;
    }
  | { ok: false; motivo: "sesion" | "servidor" };

type PedidoCrudo = {
  folio?: unknown;
  estado?: unknown;
  codigo?: unknown;
  nota?: unknown;
  creado?: unknown;
  actualizado?: unknown;
  correo?: unknown;
  cuentaId?: unknown;
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

function azar(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    if (calculado.length !== hash.length) return false;
    let diferencia = 0;
    for (let i = 0; i < calculado.length; i++) {
      diferencia |= calculado.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    return diferencia === 0;
  } catch {
    return false;
  }
}

function secretoSesion(): string {
  const base =
    process.env.BITLY_SESSION_SECRET ||
    process.env.BITLY_DATA_TOKEN ||
    process.env.BITLY_CODES_TOKEN ||
    "";
  if (!base) throw new Error("Falta BITLY_SESSION_SECRET en el servidor");
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

async function leerCuentas(): Promise<CuentaGuardada[]> {
  const lista = await getJson<CuentaGuardada[]>("datos", ARCHIVO, []);
  return Array.isArray(lista) ? lista.filter((c) => c && typeof c.id === "string") : [];
}

function publica(c: CuentaGuardada): CuentaPublica {
  return {
    id: c.id,
    nombre: c.nombre,
    correo: c.correo,
    creado: c.creado,
    actualizado: c.actualizado,
  };
}

const intentos = new Map<string, { n: number; t: number }>();
const VENTANA_MS = 10 * 60 * 1000;

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

/* ── Sesión reutilizable por pedidos ──────────────────────────────────── */

/** Devuelve la cuenta del token o `null` si la firma/vencimiento no valen. */
export async function cuentaDeToken(token: string | null | undefined): Promise<CuentaGuardada | null> {
  const limpio = String(token ?? "").trim();
  if (!limpio) return null;
  const id = await idDeToken(limpio);
  if (!id) return null;
  const cuenta = (await leerCuentas()).find((c) => c.id === id);
  return cuenta ?? null;
}

/* ── Registro e inicio de sesión ──────────────────────────────────────── */

export const registrarCuenta = createServerFn({ method: "POST" })
  .validator((d: { nombre?: unknown; correo?: unknown; clave?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoSesion> => {
    const nombre = limpiar(data?.nombre, 60);
    const correo = limpiar(data?.correo, 120).toLowerCase();
    const clave = String(data?.clave ?? "");
    if (nombre.length < 2 || !correoValido(correo) || clave.length < 8 || clave.length > 200) {
      return { ok: false, motivo: "datos" };
    }
    if (!hayCupo(await claveDeIntento("registro"), 5)) return { ok: false, motivo: "limite" };

    try {
      const cuentas = await leerCuentas();
      if (cuentas.some((c) => c.correo === correo)) return { ok: false, motivo: "existe" };
      if (cuentas.length >= MAX_CUENTAS) return { ok: false, motivo: "limite" };

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await hashClave(clave, salt, ITERACIONES);
      const ahora = new Date().toISOString();
      const cuenta: CuentaGuardada = {
        id: azar(12),
        nombre,
        correo,
        hash,
        salt: b64(salt),
        iteraciones: ITERACIONES,
        creado: ahora,
        actualizado: ahora,
        ultimoAcceso: ahora,
      };

      const ok = await putJson("datos", ARCHIVO, [cuenta, ...cuentas], `cuenta ${cuenta.id}: alta`);
      if (!ok) return { ok: false, motivo: "servidor" };
      return { ok: true, token: await firmarToken(cuenta.id), cuenta: publica(cuenta) };
    } catch (e) {
      console.error("[cuentas] no se pudo registrar:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const iniciarSesion = createServerFn({ method: "POST" })
  .validator((d: { correo?: unknown; clave?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoSesion> => {
    const correo = limpiar(data?.correo, 120).toLowerCase();
    const clave = String(data?.clave ?? "");
    if (!correoValido(correo) || clave.length < 1 || clave.length > 200) {
      return { ok: false, motivo: "datos" };
    }
    if (!hayCupo(await claveDeIntento(`login|${correo}`), 8)) return { ok: false, motivo: "limite" };

    try {
      const cuentas = await leerCuentas();
      const indice = cuentas.findIndex((c) => c.correo === correo);
      if (indice < 0) return { ok: false, motivo: "datos" };
      const cuenta = cuentas[indice];
      if (!(await verificarClave(clave, cuenta.salt, cuenta.hash, cuenta.iteraciones))) {
        return { ok: false, motivo: "datos" };
      }

      // `ultimoAcceso` es informativo: no vale un commit en cada login. Se
      // actualiza como mucho una vez al día para no inflar el historial.
      const ahora = Date.now();
      const previo = Date.parse(cuenta.ultimoAcceso || "");
      let actualizada = cuenta;
      if (!Number.isFinite(previo) || ahora - previo > 24 * 60 * 60 * 1000) {
        actualizada = { ...cuenta, ultimoAcceso: new Date(ahora).toISOString() };
        const siguiente = cuentas.slice();
        siguiente[indice] = actualizada;
        await putJson("datos", ARCHIVO, siguiente, `cuenta ${cuenta.id}: acceso`);
      }
      return { ok: true, token: await firmarToken(cuenta.id), cuenta: publica(actualizada) };
    } catch (e) {
      console.error("[cuentas] no se pudo iniciar sesión:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });

export const miCuenta = createServerFn({ method: "POST" })
  .validator((d: { token?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoMiCuenta> => {
    const cuenta = await cuentaDeToken(limpiar(data?.token, 500));
    if (!cuenta) return { ok: false, motivo: "sesion" };

    try {
      const crudos = await getJson<PedidoCrudo[]>("datos", ARCHIVO_PEDIDOS, []);
      const pedidos: PedidoDeCuenta[] = (Array.isArray(crudos) ? crudos : [])
        .filter((p) => p.cuentaId === cuenta.id && typeof p.folio === "string")
        .sort((a, b) => (String(a.creado) < String(b.creado) ? 1 : -1))
        .slice(0, 25)
        .map((p) => ({
          folio: String(p.folio),
          estado: String(p.estado ?? "pendiente"),
          codigo: typeof p.codigo === "string" && p.codigo ? p.codigo : null,
          nota: String(p.nota ?? ""),
          creado: String(p.creado ?? ""),
          actualizado: String(p.actualizado ?? ""),
        }));
      // El primer pedido con código y sin cancelar es el Premium vigente de la
      // cuenta: los pedidos vienen del más nuevo al más viejo.
      const conCodigo = pedidos.find((p) => p.codigo && p.estado !== "cancelado");
      const premium: PremiumDeCuenta | null = conCodigo?.codigo
        ? {
            codigo: conCodigo.codigo,
            pedido: conCodigo.folio,
            estado: conCodigo.estado,
            desde: conCodigo.actualizado || conCodigo.creado,
          }
        : null;

      return { ok: true, cuenta: publica(cuenta), pedidos, premium };
    } catch {
      return { ok: false, motivo: "servidor" };
    }
  });
