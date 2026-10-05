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
 * (mismo patrón que `integrations/supabase/client.ts` usa con SUPABASE_*), por
 * eso esto va dentro de `createServerFn`: nunca viaja al cliente.
 */

import { createServerFn } from "@tanstack/react-start";
import type { EstadoCodigo } from "@/lib/demo-cuota";

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

function sinIntentos(clave: string) {
  const ahora = Date.now();
  const previo = intentos.get(clave);
  if (!previo || ahora - previo.t > VENTANA_MS) {
    intentos.set(clave, { n: 1, t: ahora });
    return true;
  }
  previo.n++;
  return previo.n <= MAX_INTENTOS;
}

async function descargarRegistro(): Promise<Map<string, string>> {
  const token = process.env.BITLY_CODES_TOKEN;
  if (!token) throw new Error("Falta BITLY_CODES_TOKEN en el servidor");

  const res = await fetch(REGISTRO, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3.raw",
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
    if (codigo.length < 20) return { estado: "no_encontrado" };
    if (!sinIntentos("canje")) return { estado: "desconocido", aviso: "intentos" };

    let registro: Map<string, string>;
    try {
      registro = await descargarRegistro();
    } catch (e) {
      console.error("[Bitly] No se pudo leer el registro de códigos:", e);
      return { estado: "desconocido", aviso: "registro" };
    }

    const estadoCrudo = registro.get(codigo);
    if (!estadoCrudo) return { estado: "no_encontrado" };

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
    if (!codigo) return { estado: "no_encontrado" };
    try {
      const registro = await descargarRegistro();
      const estado = registro.get(codigo);
      return { estado: estado ? traducir(estado) : "no_encontrado" };
    } catch {
      return { estado: "desconocido" };
    }
  });