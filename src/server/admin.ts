/**
 * Acceso al panel del dueño.
 *
 * Antes el panel se abría con un código secreto que se escribía en un diálogo y
 * después viajaba en CADA petición (pedidos, usuarios, estadísticas). Eso tenía
 * dos problemas: el código era la contraseña maestra y quedaba guardado en el
 * navegador, y cualquiera que lo viera podía reusarlo desde cualquier lado.
 *
 * Ahora hay una cuenta de administrador (correo fijo + clave propia) y el
 * servidor devuelve un token firmado con vencimiento. Los demás módulos validan
 * ese token; la clave nunca se vuelve a mandar.
 *
 * Variables:
 *   BITLY_ADMIN_EMAIL  correo del dueño (por defecto floxdev2024@gmail.com)
 *   BITLY_ADMIN_CLAVE  clave del panel (obligatoria; si falta, el panel no abre)
 *   BITLY_ADMIN_SECRET secreto de firma del token (si falta, se deriva de los
 *                      secretos que ya existen en el Worker)
 */

import { createServerFn } from "@tanstack/react-start";

const CORREO_POR_DEFECTO = "floxdev2024@gmail.com";
const TTL_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;

function correoAdmin(): string {
  return (process.env.BITLY_ADMIN_EMAIL || CORREO_POR_DEFECTO).trim().toLowerCase();
}

function claveAdmin(): string {
  // `BITLY_ADMIN_CODE` queda como respaldo para no romper un deploy que ya lo
  // tenga: el mismo valor sirve de clave, pero ya no como código en la URL.
  return (process.env.BITLY_ADMIN_CLAVE || process.env.BITLY_ADMIN_CODE || "").trim();
}

let avisoSecreto = false;

function secretoAdmin(): string {
  const base =
    process.env.BITLY_ADMIN_SECRET ||
    process.env.BITLY_SESSION_SECRET ||
    process.env.BITLY_DATA_TOKEN ||
    process.env.BITLY_CODES_TOKEN ||
    "";
  if (!base) throw new Error("Falta BITLY_ADMIN_CLAVE/BITLY_ADMIN_SECRET en el servidor");
  if (!process.env.BITLY_ADMIN_SECRET && !avisoSecreto) {
    avisoSecreto = true;
    console.warn(
      "[admin] BITLY_ADMIN_SECRET no está definido: el token del panel se firma con otro secreto del sitio. " +
        "Definí uno propio para que rotar las sesiones de clientes no cierre el panel.",
    );
  }
  return `bitly-admin-v1:${base}`;
}

async function llaveAdmin(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretoAdmin()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(texto: string): Uint8Array {
  const normal = texto.replace(/-/g, "+").replace(/_/g, "/");
  const relleno = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  return Uint8Array.from(atob(relleno), (c) => c.charCodeAt(0));
}

/** Compara sin cortar en el primer carácter distinto. */
function mismoTexto(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/**
 * Huella de la clave actual.
 *
 * Va dentro del token: si se cambia `BITLY_ADMIN_CLAVE`, los tokens viejos dejan
 * de servir sin tener que esperar a que venzan.
 */
async function huellaClave(): Promise<string> {
  const bytes = new TextEncoder().encode(`bitly-admin-clave-v1:${claveAdmin()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return b64url(digest).slice(0, 16);
}

type CargaToken = { a: 1; e: number; k: string };

export async function firmarAdmin(): Promise<string> {
  const carga: CargaToken = { a: 1, e: Date.now() + TTL_TOKEN_MS, k: await huellaClave() };
  const payload = new TextEncoder().encode(JSON.stringify(carga));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", await llaveAdmin(), payload));
  return `${b64url(payload)}.${b64url(firma)}`;
}

/** ¿El token es válido, está vigente y corresponde a la clave actual? */
export async function adminValido(token: unknown): Promise<boolean> {
  const dado = String(token ?? "").trim();
  if (!dado || dado.length > 600) return false;
  // El código viejo (texto plano) ya no se acepta: sólo tokens firmados.
  const partes = dado.split(".");
  if (partes.length !== 2) return false;
  try {
    const payload = deB64url(partes[0]);
    const firma = deB64url(partes[1]);
    const valida = await crypto.subtle.verify(
      "HMAC",
      await llaveAdmin(),
      firma as BufferSource,
      payload as BufferSource,
    );
    if (!valida) return false;
    const carga = JSON.parse(new TextDecoder().decode(payload)) as CargaToken;
    if (carga?.a !== 1 || !Number.isFinite(carga.e) || carga.e <= Date.now()) return false;
    return mismoTexto(String(carga.k ?? ""), await huellaClave());
  } catch {
    return false;
  }
}

/** Intentos fallidos por IP: frena la fuerza bruta contra la clave del panel. */
const FALLOS = new Map<string, { n: number; t: number }>();
const VENTANA_MS = 10 * 60 * 1000;
const MAX_FALLOS = 5;

async function ipCliente(): Promise<string> {
  try {
    const { obtenerIPCliente } = await import("@/server/ip");
    return await obtenerIPCliente();
  } catch {
    return "anonima";
  }
}

function hayCupo(ip: string): boolean {
  const ahora = Date.now();
  const previo = FALLOS.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) return true;
  return previo.n < MAX_FALLOS;
}

function anotarFallo(ip: string): void {
  const ahora = Date.now();
  const previo = FALLOS.get(ip);
  if (!previo || ahora - previo.t > VENTANA_MS) FALLOS.set(ip, { n: 1, t: ahora });
  else previo.n++;
  if (FALLOS.size > 2000) FALLOS.clear();
}

export type ResultadoIngreso =
  | { ok: true; token: string; expira: string; correo: string }
  | { ok: false; motivo: "datos" | "clave" | "cupo" | "servidor" };

export const entrarPanel = createServerFn({ method: "POST" })
  .validator((d: { correo?: unknown; clave?: unknown }) => d)
  .handler(async ({ data }): Promise<ResultadoIngreso> => {
    const clave = claveAdmin();
    // Fail closed: sin clave configurada nadie entra. Este repo es público, así
    // que una clave escrita acá sería una clave conocida por todos.
    if (!clave) {
      console.error("[admin] falta BITLY_ADMIN_CLAVE: el panel queda deshabilitado");
      return { ok: false, motivo: "clave" };
    }

    const ip = await ipCliente();
    if (!hayCupo(ip)) return { ok: false, motivo: "cupo" };

    const correo = String(data?.correo ?? "").trim().toLowerCase();
    const dada = String(data?.clave ?? "");
    if (!correo || !dada) return { ok: false, motivo: "datos" };

    const correoOk = mismoTexto(correo, correoAdmin());
    const claveOk = mismoTexto(dada, clave);
    if (!correoOk || !claveOk) {
      anotarFallo(ip);
      // Mismo mensaje para correo y clave: no se revela cuál de los dos falló.
      return { ok: false, motivo: "clave" };
    }

    FALLOS.delete(ip);
    try {
      const token = await firmarAdmin();
      return {
        ok: true,
        token,
        expira: new Date(Date.now() + TTL_TOKEN_MS).toISOString(),
        correo: correoAdmin(),
      };
    } catch (e) {
      console.error("[admin] no se pudo firmar el token:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
