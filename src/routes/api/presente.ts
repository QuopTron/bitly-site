import { createFileRoute } from "@tanstack/react-router";
import { estadoPresente } from "@/server/presente";

/**
 * Latido de presencia.
 *
 * Va como ruta y no como llamada directa a la server function porque el cliente
 * necesita `keepalive`: si la persona cambia de pestaña o cierra justo después
 * del latido, la petición igual llega. El cuerpo es mínimo (un id aleatorio y,
 * si hay, el token de la cuenta) y no se cachea.
 */
export const Route = createFileRoute("/api/presente")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let datos: { visita?: unknown; token?: unknown } = {};
        try {
          datos = (await request.json()) as typeof datos;
        } catch {
          // Sin cuerpo se cuenta sólo lo que ya había: no es un error.
        }

        let estado: Awaited<ReturnType<typeof estadoPresente>> | null = null;
        try {
          estado = await estadoPresente({ data: datos });
        } catch {
          estado = null;
        }

        if (!estado) {
          return new Response(JSON.stringify({ ok: false }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }

        return new Response(JSON.stringify(estado), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
