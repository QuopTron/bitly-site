import { createFileRoute } from "@tanstack/react-router";
import { cuentaDeToken } from "@/server/cuentas";
import { consumirDescarga, LIMITE_DESCARGAS } from "@/server/descargas-cuenta";
import { esCodigoPremiumActivo } from "@/lib/premium-check";
import { resolverAudio } from "@/server/rescate";

const TIPOS: Record<string, string> = {
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/webm": "webm",
};

function jsonError(error: string, status: number, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function limpiarNombre(valor: string): string {
  return valor
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

type PeticionAudio = Parameters<typeof resolverAudio>[0];

/**
 * Resuelve el audio y abre el stream, sin decidir todavía si se entrega.
 *
 * Devuelve también el `audio` cuando el enlace existía pero el host no lo
 * sirvió: con eso quien llama puede pedir OTRO canal en vez de contestar que la
 * pista no tiene audio (429 del catálogo, 403 del relay, enlace vencido).
 */
async function traerAudio(peticion: PeticionAudio, signal: AbortSignal) {
  const audio = await resolverAudio(peticion).catch(() => null);
  if (!audio) return { audio: null, upstream: null, tipo: null };

  const upstream = await fetch(audio.url, {
    headers: {
      Accept: "audio/*,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    signal,
    redirect: "follow",
  }).catch(() => null);
  const tipo = upstream?.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (!upstream?.ok || !upstream.body || (tipo && tipo.startsWith("text/"))) {
    await upstream?.body?.cancel().catch(() => undefined);
    return { audio, upstream: null, tipo };
  }
  return { audio, upstream, tipo };
}

function extensionDe(url: string, tipo: string | null, calidad: "flac" | "estandar"): string {
  try {
    const extension = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (extension && ["flac", "mp3", "m4a", "aac", "ogg", "opus", "wav", "webm"].includes(extension)) {
      return extension;
    }
  } catch {
    // URL sin forma reconocible: se decide por el content-type.
  }
  if (tipo && TIPOS[tipo]) return TIPOS[tipo];
  return calidad === "flac" ? "flac" : "m4a";
}

export const Route = createFileRoute("/api/descargar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = request.headers.get("x-bitly-token") ?? url.searchParams.get("token");
        const cuenta = await cuentaDeToken(token);
        const codigo = url.searchParams.get("codigo") ?? cuenta?.codigo ?? null;
        const premium = await esCodigoPremiumActivo(codigo).catch(() => false);
        if (!cuenta && !premium) return jsonError("sesion", 401);

        const titulo = (url.searchParams.get("titulo") ?? "").trim();
        const artista = (url.searchParams.get("artista") ?? "").trim();
        if (!titulo || !artista) return jsonError("datos", 400);

        const calidad = premium ? "flac" : "estandar";

        const peticion: PeticionAudio = {
          titulo,
          artista,
          album: url.searchParams.get("album") ?? undefined,
          duracionMs: Number(url.searchParams.get("duracionMs")) || undefined,
          isrc: url.searchParams.get("isrc"),
          ext: url.searchParams.get("ext"),
          id: url.searchParams.get("id"),
          videoId: url.searchParams.get("videoId"),
          calidad,
        };

        let traido = await traerAudio(peticion, request.signal);
        // El enlace se resolvió pero el host no lo abrió: se pide otro canal.
        // Sin esto, un 429 del catálogo hacía que la descarga contestara «no
        // hay audio» aunque la misma pista estuviera en el relay o YouTube.
        if (!traido.upstream && traido.audio && !request.signal.aborted) {
          traido = await traerAudio(
            { ...peticion, evitar: [traido.audio.canal] },
            request.signal,
          );
        }
        if (!traido.audio || !traido.upstream) return jsonError("sin_audio", 404);

        const audio = traido.audio;
        const upstream = traido.upstream;
        const cuerpo = upstream.body;
        if (!cuerpo) return jsonError("sin_audio", 404);
        const tipoCrudo = traido.tipo;

        let restantes: number | null = null;
        if (!premium) {
          if (!cuenta) return jsonError("sesion", 401);
          const consumo = await consumirDescarga(cuenta.id, {
            titulo,
            artista,
            calidad,
            canal: audio.canal,
          });
          if (!consumo.ok) {
            await cuerpo.cancel().catch(() => undefined);
            if (consumo.motivo === "limite") {
              return jsonError("limite", 429, { "x-descargas-restantes": "0", "x-descargas-limite": String(LIMITE_DESCARGAS) });
            }
            return jsonError("servidor", 503);
          }
          restantes = consumo.restantes;
        }

        const extension = extensionDe(audio.url, tipoCrudo, calidad);
        const base = limpiarNombre(`${artista} - ${titulo}`) || "bitly-audio";
        const nombre = `${base}.${extension}`;
        const ascii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
        const tipo = tipoCrudo && !tipoCrudo.startsWith("text/") ? tipoCrudo : "application/octet-stream";

        const headers = new Headers({
          "content-type": tipo,
          "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
          "cache-control": "no-store",
          "x-calidad": calidad,
          "x-canal": audio.canal,
          "x-descargas-limite": String(LIMITE_DESCARGAS),
        });
        if (restantes !== null) headers.set("x-descargas-restantes", String(restantes));
        const largo = upstream.headers.get("content-length");
        if (largo) headers.set("content-length", largo);

        return new Response(cuerpo, { status: 200, headers });
      },
    },
  },
});
