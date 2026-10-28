import { leerTokenCuenta } from "@/lib/cuentas-cliente";

/**
 * Configuración del RESCATE (canales sin pérdida) desde el sitio.
 *
 * El dueño de la cuenta la define acá y la app la aplica al sincronizar
 * (Ajustes → Descargas → Rescate). El contrato es el de
 * `go_backend/internal/cuenta/rescate.go`, y cada campo es OPCIONAL a
 * propósito: un campo ausente significa «no lo toquen», que NO es lo mismo que
 * `false` (apagado). Por eso no se mandan valores por defecto: sólo lo que el
 * usuario definió.
 *
 * Nunca viaja un secreto (token de la instancia arcod, config firmada del
 * relay, claves de Qobuz): viven sólo en la app y la ruta los descarta.
 */
export type RescateGuardado = {
  mirrors?: string[];
  arcodBase?: string;
  monochromeBase?: string;
  arcod?: boolean;
  monochrome?: boolean;
  espejos?: boolean;
  stashRelay?: boolean;
};

export type ResultadoRescate =
  | { ok: true; config: RescateGuardado }
  | { ok: false; motivo: "sesion" | "datos" | "servidor" | "red" };

function jsonDe(respuesta: Response): Promise<Record<string, unknown>> {
  return respuesta.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/**
 * Habla con `/api/rescate`. El token de sesión viaja en la cabecera (nunca en
 * la URL, que queda en los registros del servidor).
 *
 * Sin `config` en el cuerpo el servidor BORRA lo guardado y la app vuelve a lo
 * suyo; es lo que hace `borrarRescate`.
 */
async function pedir(
  metodo: "GET" | "POST",
  config?: RescateGuardado,
): Promise<ResultadoRescate> {
  const token = leerTokenCuenta();
  if (!token) return { ok: false, motivo: "sesion" };

  let respuesta: Response;
  try {
    respuesta = await fetch("/api/rescate", {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        ...(metodo === "POST" ? { "content-type": "application/json" } : {}),
      },
      // Sin `config` el cuerpo va VACÍO pero presente: la ruta lee el JSON del
      // pedido y un POST sin cuerpo corta antes con "datos" (400), así que el
      // borrado no llegaba a ejecutarse nunca.
      body: metodo === "POST" ? JSON.stringify(config ? { config } : {}) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, motivo: "red" };
  }

  const datos = await jsonDe(respuesta);
  if (respuesta.status === 401 || datos.motivo === "sesion") {
    return { ok: false, motivo: "sesion" };
  }
  if (datos.ok !== true) {
    return { ok: false, motivo: respuesta.status >= 500 ? "servidor" : "datos" };
  }
  return { ok: true, config: (datos.config ?? {}) as RescateGuardado };
}

/** La configuración que la cuenta tiene guardada (vacía si nunca se tocó). */
export function leerRescate(): Promise<ResultadoRescate> {
  return pedir("GET");
}

/** Guarda la configuración definida en el panel. */
export function guardarRescate(config: RescateGuardado): Promise<ResultadoRescate> {
  return pedir("POST", config);
}

/** Borra la configuración de la cuenta: la app vuelve a usar la suya. */
export function borrarRescate(): Promise<ResultadoRescate> {
  return pedir("POST");
}
