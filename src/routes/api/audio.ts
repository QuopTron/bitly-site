import { createFileRoute } from "@tanstack/react-router";
import { cuentaDeToken } from "@/server/cuentas";
import {
  anotarPedido,
  calidadDe,
  claveDe,
  cubo,
  hay,
  llaveDe,
  MAX_BYTES,
  pedidosDe,
  umbralSembrar,
} from "@/server/audio-cache";

/**
 * API del CACHÉ DE AUDIO opcional en R2.
 *
 * Contrato:
 *
 *   GET  /api/audio?clave&calidad              → el audio cacheado (o 404)
 *   POST { accion:"pedir", clave, calidad }    → { ok, hay, sembrar, pedidos }
 *   PUT  /api/audio?clave&calidad + audio      → { ok } (exige sesión y umbral)
 *
 * `pedir` es público y cuenta el pedido; `sembrar` dice si la canción ya pasó el
 * umbral de «más pedida». El `PUT` vuelve a comprobar ese umbral en el servidor,
 * así un cliente no puede llenar el bucket a voluntad. Sin binding R2 todo
 * contesta `apagado` y la app sigue igual: el caché es una optimización.
 *
 * Solo se sirve la calidad pedida. Si alguien sembró un MP3 y otro pide FLAC,
 * no se entrega el MP3 como si fuera FLAC.
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

export const Route = createFileRoute("/api/audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const clave = claveDe(url.searchParams.get("clave"));
        const calidad = calidadDe(url.searchParams.get("calidad"));
        const bucket = cubo();
        if (!bucket) return json({ ok: false, motivo: "apagado" }, 503);
        const llave = await llaveDe(clave, calidad);
        if (!llave) return json({ ok: false, motivo: "clave" }, 400);

        const objeto = await bucket.get(llave).catch(() => null);
        if (!objeto) return json({ ok: false, motivo: "no_cargado" }, 404);
        return new Response(objeto.body, {
          status: 200,
          headers: {
            "content-type": objeto.httpMetadata?.contentType || "application/octet-stream",
            "content-length": String(objeto.size),
            "cache-control": "public, max-age=86400",
            "x-calidad": calidad,
          },
        });
      },

      POST: async ({ request }) => {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        const accion = String(cuerpo.accion ?? "").toLowerCase();
        if (accion !== "pedir" && accion !== "estado") {
          return json({ ok: false, motivo: "accion" }, 400);
        }
        const clave = claveDe(cuerpo.clave);
        if (!clave) return json({ ok: false, motivo: "clave" }, 400);
        const calidad = calidadDe(cuerpo.calidad);
        // Sin bucket no se cuenta nada: no habría dónde sembrar después.
        if (!cubo()) return json({ ok: true, apagado: true, hay: false, sembrar: false });

        // `pedir` cuenta; `estado` solo consulta (lo usa el aporte, que ya contó
        // el pedido al empezar la descarga).
        const pedidos = accion === "pedir" ? await anotarPedido(clave) : await pedidosDe(clave);
        const cargado = await hay(clave, calidad);
        return json({
          ok: true,
          hay: cargado,
          sembrar: !cargado && pedidos >= umbralSembrar(),
          pedidos,
        });
      },

      PUT: async ({ request }) => {
        const bucket = cubo();
        if (!bucket) return json({ ok: false, motivo: "apagado" }, 503);

        const url = new URL(request.url);
        const clave = claveDe(url.searchParams.get("clave"));
        const calidad = calidadDe(url.searchParams.get("calidad"));
        const llave = await llaveDe(clave, calidad);
        if (!llave) return json({ ok: false, motivo: "clave" }, 400);

        const token = request.headers.get("x-bitly-token") ?? "";
        const cuenta = await cuentaDeToken(token);
        if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);

        // El umbral se revalida acá: el cliente no decide qué se cachea.
        const pedidos = await pedidosDe(clave);
        if (pedidos < umbralSembrar()) {
          return json({ ok: false, motivo: "poco_pedida", pedidos }, 403);
        }

        const largo = Number(request.headers.get("content-length") ?? 0);
        if (!Number.isFinite(largo) || largo <= 0) {
          return json({ ok: false, motivo: "vacio" }, 411);
        }
        if (largo > MAX_BYTES) return json({ ok: false, motivo: "grande" }, 413);
        const tipo = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (!tipo.startsWith("audio/") && tipo !== "application/octet-stream") {
          return json({ ok: false, motivo: "tipo" }, 415);
        }
        if (!request.body) return json({ ok: false, motivo: "vacio" }, 411);

        // El cuerpo va directo al bucket: no se guarda entero en memoria.
        await bucket.put(llave, request.body, {
          httpMetadata: { contentType: tipo },
          customMetadata: { clave, calidad },
        });
        return json({ ok: true, clave, calidad, bytes: largo });
      },

      PATCH: async () => json({ ok: false, motivo: "metodo" }, 405),
      DELETE: async () => json({ ok: false, motivo: "metodo" }, 405),
    },
  },
});
