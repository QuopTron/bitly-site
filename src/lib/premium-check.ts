/**
 * Canje de código Premium contra el registro real.
 *
 * Réplica de la validación que hace la app en
 * `go_backend/internal/premium/registro_github.go`: se descarga `codes.json`
 * del repo privado y se lee el estado de la clave.
 *
 *   activo    → válido
 *   usado     → ya fue canjeado
 *   cancelado → dado de baja
 *   libre     → liberado por el usuario
 *
 * Solo LECTURA: el sitio nunca marca un código como usado. Si lo hiciera,
 * cualquiera que visitara la landing podría quemar un código válido. Quien
 * marca "usado" sigue siendo la app.
 *
 * El token de GitHub se lee de una variable de entorno SOLO en el servidor
 * (mismo patrón que `src/server/github-store.ts` usa con BITLY_DATA_TOKEN), por
 * eso esto va dentro de `createServerFn`: nunca viaja al cliente.
 */

import { createServerFn } from "@tanstack/react-start";
import type { EstadoCodigo } from "@/lib/demo-cuota";
import { codigoEmitidoActivo } from "@/server/codigos-emitidos";

/** Mismo repo que usa la app, para que ambos lean la misma fuente. */
const REGISTRO = "https://api.github.com/repos/QuopTron/bitly_codes_premium/contents/codes.json";

/** Cuántos intentos se aceptan antes de cortar, para frenar fuerza bruta. */
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;

type Intentos = Map<string, { n: number; t: number }>;

/**
 * Los intentos viven en el módulo del worker. Es una red floja —con un reinicio
 * se pierde— pero frena el fuerza bruta normal, que es lo que importa: los
 * códigos duran 365 días y se adivinan por longitud de prefijo.
 */
const intentos: Intentos = new Map();

function sinIntentos(clave: string, max = MAX_INTENTOS) {
  const ahora = Date.now();
  const previo = intentos.get(clave);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    intentos.set(clave, { n: 1, t: ahora });
    if (intentos.size > 2000) intentos.clear();
    return true;
  }
  previo.n++;
  return previo.n <= max;
}

/**
 * Caché del registro completo.
 *
 * `codes.json` pesa y cada lectura es una descarga entera a la API de GitHub.
 * Sin caché, cualquiera podía disparar una descarga por request (el canje y la
 * revalidación no tenían freno), lo que agotaba el cupo del token y frenaba el
 * sitio entero. Cinco minutos alcanzan: la app es la que marca los códigos.
 */
const CACHE_REGISTRO_MS = 5 * 60 * 1000;
let cacheRegistro: { registro: Map<string, string>; expira: number } | null = null;
let registroEnCurso: Promise<Map<string, string>> | null = null;

export async function leerRegistroCodigos(): Promise<Map<string, string>> {
  if (cacheRegistro && cacheRegistro.expira > Date.now()) return cacheRegistro.registro;
  // Varias peticiones simultáneas comparten una sola descarga.
  if (registroEnCurso) return registroEnCurso;
  registroEnCurso = descargarRegistro()
    .then((registro) => {
      cacheRegistro = { registro, expira: Date.now() + CACHE_REGISTRO_MS };
      return registro;
    })
    .finally(() => {
      registroEnCurso = null;
    });
  return registroEnCurso;
}

async function ipCliente(): Promise<string> {
  try {
    const { obtenerIPCliente } = await import("@/server/ip");
    return await obtenerIPCliente();
  } catch {
    return "anonima";
  }
}

async function descargarRegistro(): Promise<Map<string, string>> {
  const token = process.env.BITLY_CODES_TOKEN;
  if (!token) throw new Error("Falta BITLY_CODES_TOKEN en el servidor");

  const res = await fetch(REGISTRO, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3.raw",
      // GitHub RECHAZA con 403 cualquier request sin User-Agent
      // ("Request forbidden by administrative rules"). El `fetch` de Workers
      // no manda uno, así que en producción el registro siempre fallaba aunque
      // el token estuviera bien: el síntoma era "El registro no respondió".
      "User-Agent": "bitly-site",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`El registro respondió ${res.status}`);

  const crudo = (await res.json()) as Record<string, unknown>;
  // La app también salta la clave "_NOTA" que el propio archivo trae.
  const registro = new Map<string, string>();
  for (const [codigo, estado] of Object.entries(crudo)) {
    if (codigo === "_NOTA" || typeof estado !== "string") continue;
    registro.set(codigo, estado);
  }
  return registro;
}

/**
 * ¿El código acredita Premium AHORA? Lo usa el servidor de la demo para decidir
 * si sirve FLAC o calidad estándar: el cliente manda el código que tenga y acá
 * se verifica, así un `calidad: "flac"` inventado no abre nada.
 *
 * Se cachea unos minutos porque esto corre en CADA resolución de audio y leer el
 * registro es una descarga entera de GitHub. Si el registro no responde se
 * respeta lo último que se supo del código: un corte de red no debe degradar a
 * quien ya estaba escuchando en FLAC (ni ascender a quien nunca acreditó).
 */
const CACHE_PREMIUM_MS = 5 * 60 * 1000;
const acreditados = new Map<string, { ok: boolean; expira: number }>();

export async function esCodigoPremiumActivo(codigo: string | null | undefined): Promise<boolean> {
  const limpio = (codigo ?? "").trim();
  if (limpio.length < 20) return false;

  // Los códigos firmados por el sitio no están en el registro de la app: se
  // acreditan por la lista de emitidos, que se consulta PRIMERO y sin la caché
  // del registro. Si se revoca un código, tiene que dejar de servir en el acto
  // (esa lista se actualiza cuando se libera).
  if (await codigoEmitidoActivo(limpio).catch(() => false)) return true;

  const ahora = Date.now();
  const previo = acreditados.get(limpio);
  if (previo && previo.expira > ahora) return previo.ok;

  try {
    const registro = await leerRegistroCodigos();
    const ok = registro.get(limpio) === "activo";
    if (acreditados.size > 500) acreditados.clear();
    acreditados.set(limpio, { ok, expira: ahora + CACHE_PREMIUM_MS });
    return ok;
  } catch {
    return previo?.ok ?? false;
  }
}

/** Traduce el estado del registro al mismo vocabulario que usa la app. */
function traducir(estado: string): EstadoCodigo {
  switch (estado) {
    case "activo":
      return "ok";
    case "usado":
      return "usado";
    case "cancelado":
      return "cancelado";
    case "libre":
      return "liberado";
    default:
      return "desconocido";
  }
}

type Resultado = {
  estado: EstadoCodigo;
  /** Plan del código (la app lo lleva dentro de la carga del propio token). */
  etiqueta?: string | null;
  dias?: number | null;
  /** Motivo por el que no se pudo llegar al registro. */
  aviso?: "registro" | "intentos";
};

export const canjearCodigo = createServerFn({ method: "POST" })
  .validator((d: { codigo: string }) => d)
  .handler(async ({ data }): Promise<Resultado> => {
    const codigo = (data.codigo ?? "").trim();
    if (codigo.length < 20 || codigo.length > 500) return { estado: "no_encontrado" };
    // Por IP: antes era una clave fija ("canje"), así que ocho intentos en todo
    // el mundo dejaban el canje bloqueado para todos.
    if (!sinIntentos(`canje|${await ipCliente()}`)) return { estado: "desconocido", aviso: "intentos" };

    let registro: Map<string, string>;
    try {
      registro = await leerRegistroCodigos();
    } catch (e) {
      console.error("[Bitly] No se pudo leer el registro de códigos:", e);
      // Un código firmado acá sigue siendo válido aunque el registro de la app
      // no responda: la lista de emitidos vive en el repo del sitio.
      if (await codigoEmitidoActivo(codigo)) return { estado: "ok" };
      return { estado: "desconocido", aviso: "registro" };
    }

    const estadoCrudo = registro.get(codigo);
    if (!estadoCrudo) {
      return { estado: (await codigoEmitidoActivo(codigo)) ? "ok" : "no_encontrado" };
    }

    const estado = traducir(estadoCrudo);
    if (estado !== "ok") return { estado };

    // La carga del código lleva {p, u, d} + firma. NO se valida la firma acá
    // (es trabajo de la app con su clave pública): solo se lee la etiqueta
    // para poder saludar al usuario en la interfaz.
    let etiqueta: string | null = null;
    let dias: number | null = null;
    try {
      const carga = codigo.split(".")[0];
      if (carga) {
        const datos = JSON.parse(atob(carga.replace(/-/g, "+").replace(/_/g, "/"))) as {
          p?: string;
          d?: number;
        };
        etiqueta = datos.p ?? null;
        dias = typeof datos.d === "number" ? datos.d : null;
      }
    } catch {
      // Codo mal formado: que el registro diga "activo" ya es la respuesta útil.
    }

    return { estado, etiqueta, dias };
  });

/**
 * Revalida un canje ya guardado al recargar la página. Silencioso a propósito:
 * si el registro no se puede leer devuelve "desconocido" y la interfaz no
 * desmonta nada, solo deja de confiar en el desbloqueo local.
 */
export const revalidarPremium = createServerFn({ method: "POST" })
  .validator((d: { codigo: string }) => d)
  .handler(async ({ data }): Promise<{ estado: EstadoCodigo }> => {
    const codigo = (data.codigo ?? "").trim();
    if (!codigo || codigo.length > 500) return { estado: "no_encontrado" };
    // Freno propio: esta función la dispara cada visita con código guardado y
    // no tenía ningún límite.
    if (!sinIntentos(`revalidar|${await ipCliente()}`, 20)) return { estado: "desconocido" };
    try {
      const registro = await leerRegistroCodigos();
      const estado = registro.get(codigo);
      if (estado) return { estado: traducir(estado) };
      return { estado: (await codigoEmitidoActivo(codigo)) ? "ok" : "no_encontrado" };
    } catch {
      return { estado: (await codigoEmitidoActivo(codigo)) ? "ok" : "desconocido" };
    }
  });