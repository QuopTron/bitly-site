import { createFileRoute } from "@tanstack/react-router";
import { cuentaDeToken } from "@/server/cuentas";
import {
  borrarRescateDeCuenta,
  guardarRescateDeCuenta,
  rescateDeCuenta,
} from "@/server/rescate-cuenta";

/**
 * API del RESCATE para la APP (backend Go de Bitly).
 *
 * Por qué existe: la app tiene el panel de canales sin pérdida (espejos,
 * arcod, monochrome, relay) en Ajustes → Descargas → Rescate, y el sitio no
 * tenía nada. Esta ruta guarda ESA configuración por cuenta y la sirve, así se
 * puede administrar una cuenta desde la web y la app la aplica al
 * sincronizar.
 *
 * Contrato (la sesión va en `Authorization: Bearer` o en `{ token }`):
 *
 *   GET  /api/rescate            → { ok, config }   la de esa cuenta
 *   POST /api/rescate  {config}  → { ok, config }   la guarda
 *   POST /api/rescate  {}        → { ok }           la borra (vuelve a la app)
 *
 * Nunca devuelve ni acepta SECRETOS (token de arcod, configs firmadas del
 * relay, claves de Qobuz): esos viven solo en la app. Ver
 * `src/server/rescate-cuenta.ts`.
 */

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

/** El token de sesión viaja en el cuerpo o como `Authorization: Bearer`. */
function tokenDe(request: Request, datos: Record<string, unknown>): string {
  const cuerpo = String(datos.token ?? "").trim();
  if (cuerpo) return cuerpo;
  const cabecera = request.headers.get("authorization") ?? "";
  return cabecera.toLowerCase().startsWith("bearer ")
    ? cabecera.slice(7).trim()
    : "";
}

/** La cuenta de la sesión, o null si el token no sirve. */
async function cuentaDe(request: Request, datos: Record<string, unknown>) {
  const token = tokenDe(request, datos);
  if (!token) return null;
  try {
    return await cuentaDeToken(token);
  } catch {
    // Sin el repo de datos disponible no se puede autenticar: 401, no 500,
    // porque para el cliente el problema es la sesión.
    return null;
  }
}

export const Route = createFileRoute("/api/rescate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const datos: Record<string, unknown> = {
          token: url.searchParams.get("token") ?? "",
        };
        const cuenta = await cuentaDe(request, datos);
        if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);
        try {
          return json({ ok: true, config: await rescateDeCuenta(cuenta.id) });
        } catch {
          return json({ ok: false, motivo: "servidor" }, 500);
        }
      },

      POST: async ({ request }) => {
        let datos: Record<string, unknown>;
        try {
          datos = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        if (!datos || typeof datos !== "object") {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        const cuenta = await cuentaDe(request, datos);
        if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);

        try {
          const config = datos.config;
          // Sin `config` (o vacía) se borra: la app vuelve a lo que tenga.
          if (config === undefined || config === null) {
            const borrado = await borrarRescateDeCuenta(cuenta.id);
            return json(
              borrado.ok
                ? { ok: true, config: {} }
                : { ok: false, motivo: borrado.motivo ?? "servidor" },
              borrado.ok ? 200 : 500,
            );
          }
          const guardado = await guardarRescateDeCuenta(cuenta.id, config);
          if (!guardado.ok) {
            return json(
              { ok: false, motivo: guardado.motivo ?? "servidor" },
              guardado.motivo === "datos" ? 400 : 500,
            );
          }
          return json({ ok: true, config: guardado.config });
        } catch {
          return json({ ok: false, motivo: "servidor" }, 500);
        }
      },
    },
  },
});
