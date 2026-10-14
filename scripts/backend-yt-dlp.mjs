#!/usr/bin/env node
/**
 * Backend local de yt-dlp para el rescate de audio de la demo.
 *
 * Patrón Kordia: un proceso en la máquina con `yt-dlp` (y ffmpeg) que busca la
 * pista en YouTube, resuelve la URL de googlevideo y la PROXYA: el navegador
 * nunca ve ese dominio —que además amarra la URL a la IP que la pidió— y el
 * audio llega COMPLETO (el cliente `web_embedded` sirve el archivo entero, no
 * los primeros ~60 s que exigen un PO token los clientes de app).
 *
 * El servidor de la demo lo usa con la env `YT_DLP_BACKEND_URL` (p.ej.
 * `http://127.0.0.1:8787`); sin esa env el canal YouTube no existe.
 *
 * Rutas:
 *   GET /salud                     → estado del proceso y del binario
 *   GET /buscar?consulta=&limite=  → búsqueda plana en YouTube (catálogo):
 *     · sirve cuando ni la extensión elegida ni el respaldo de Deezer tienen
 *       la canción (folklore de nicho, re-subidos): la demo la muestra igual y
 *       el audio se rescata con este mismo backend;
 *     · responde { items: [{ id, tipo, titulo, artista, caratula, duracionMs }] }.
 *   GET /resolver?titulo=&artista=&duracion=
 *                                  → JSON { videoId, titulo, duracion, stream }
 *     · busca `ytsearch3:título artista`, elige el primer resultado cuya
 *       duración coincide (±40 s) con la del catálogo; si ninguno coincide,
 *       usa el primero;
 *     · `stream` es la ruta del proxy (`/audio/<token>`), nunca la URL cruda.
 *   GET /audio/<token>             → el stream de googlevideo con Range
 *
 * Uso:  node scripts/backend-yt-dlp.mjs [--puerto 8787]
 * Solo escucha en 127.0.0.1: es una herramienta de desarrollo, no un servicio
 * público. Para eso existe la fase Docker (ver el plan del proyecto).
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { puerto: { type: "string", default: "8787" } },
});
const PUERTO = Number(values.puerto) || 8787;

/** Clientes de YouTube, en orden: `web_embedded` sirve audio COMPLETO sin PO. */
const CLIENTES = ["web_embedded", "mweb"];
const MARGEN_DURACION_S = 40;
const TIMEOUT_BUSQUEDA_MS = 20_000;
const TIMEOUT_URL_MS = 15_000;
const TTL_RESOLUCION_MS = 10 * 60 * 1000;
const TTL_TOKEN_MS = 60 * 60 * 1000;
const MAX_TOKENS = 200;

/** token → { url, expira } — el proxy solo acepta tokens que salieron de acá. */
const tokens = new Map();
/** consulta normalizada → { valor, expira } — evita repetir yt-dlp al saltar. */
const resoluciones = new Map();
/** consulta normalizada → { valor, expira } — caché de la búsqueda de catálogo. */
const busquedas = new Map();

function ytDlp(args, ms) {
  return new Promise((ok, mal) => {
    execFile(
      "yt-dlp",
      ["--no-warnings", "--no-playlist", ...args],
      { timeout: ms, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) mal(new Error(`yt-dlp falló (${err.code ?? err.signal ?? err.message}): ${String(stderr || stdout).slice(0, 400)}`));
        else ok(String(stdout));
      },
    );
  });
}

function normalizar(s) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Busca la pista y devuelve { videoId, titulo, duracion, url } o null. */
async function buscarPista(titulo, artista, duracionS) {
  const consulta = `${titulo} ${artista}`.replace(/\s+/g, " ").trim();
  if (!consulta) return null;

  for (const cliente of CLIENTES) {
    let salida;
    try {
      // `--flat-playlist` no extrae cada video del resultado (eso costaba
      // ~12 s): la búsqueda plana trae duración+id+título en ~3 s, y la
      // extracción completa se hace UNA sola vez sobre el video elegido.
      salida = await ytDlp(
        [
          `--extractor-args=youtube:player-client=${cliente}`,
          "--flat-playlist",
          "--playlist-end",
          "3",
          "--print",
          "%(duration)s|%(id)s|%(title)s",
          `ytsearch3:${consulta}`,
        ],
        TIMEOUT_BUSQUEDA_MS,
      );
    } catch (e) {
      console.error(`[yt-dlp] búsqueda con ${cliente}: ${e.message}`);
      continue;
    }

    const filas = salida
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [d, id, ...resto] = l.split("|");
        const dur = Number(d);
        return { duracion: Number.isFinite(dur) ? dur : 0, videoId: id ?? "", tituloVideo: resto.join("|") };
      })
      .filter((f) => f.videoId);

    if (filas.length === 0) continue;
    const elegida =
      (duracionS > 0 && filas.find((f) => f.duracion > 0 && Math.abs(f.duracion - duracionS) <= MARGEN_DURACION_S)) ||
      filas[0];
    if (elegida.duracion > 0 && duracionS > 0 && Math.abs(elegida.duracion - duracionS) > MARGEN_DURACION_S) {
      console.error(
        `[yt-dlp] "${elegida.tituloVideo}" dura ${elegida.duracion}s y se pidieron ${duracionS}s: puede no ser la misma grabación`,
      );
    }

    for (const cli of CLIENTES) {
      try {
        const url = (
          await ytDlp(
            ["-f", "bestaudio/best", "--get-url", `--extractor-args=youtube:player-client=${cli}`, `https://www.youtube.com/watch?v=${elegida.videoId}`],
            TIMEOUT_URL_MS,
          )
        )
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("https://"));
        if (url) return { ...elegida, url };
      } catch (e) {
        console.error(`[yt-dlp] -g con ${cli}: ${e.message}`);
      }
    }
  }
  return null;
}

const DURACION_MINIMA_S = 60;
/** Canciones, no sesiones en vivo ni mixes: 20 minutos es un techo generoso. */
const DURACION_MAXIMA_S = 20 * 60;
const TTL_BUSQUEDA_MS = 10 * 60 * 1000;

/**
 * Búsqueda PLANA en YouTube (`--flat-playlist`): una sola petición trae
 * título/canal/duración sin extraer cada video, así sirve de catálogo cuando
 * ni la extensión ni Deezer tienen la canción. Ojo: un resultado de YouTube no
 * trae ISRC — el rescate de audio igual funciona porque el backend resuelve la
 * pista por título+artista.
 */
async function buscarCatalogoYouTube(consulta, limite) {
  const ahora = Date.now();
  podar(busquedas, ahora);
  const clave = normalizar(consulta);
  const cacheado = busquedas.get(clave);
  if (cacheado && cacheado.expira > ahora) return cacheado.valor;

  const n = Math.max(1, Math.min(12, limite));
  let salida = null;
  for (const cliente of CLIENTES) {
    try {
      salida = await ytDlp(
        [
          "--flat-playlist",
          `--extractor-args=youtube:player-client=${cliente}`,
          "--playlist-end",
          String(n),
          "--print",
          "%(duration)s|%(id)s|%(title)s|%(channel)s",
          `ytsearch${n}:${consulta}`,
        ],
        TIMEOUT_BUSQUEDA_MS,
      );
      break;
    } catch (e) {
      console.error(`[yt-dlp] búsqueda de catálogo con ${cliente}: ${e.message}`);
    }
  }
  if (salida == null) return null;

  const items = [];
  for (const linea of salida.split("\n")) {
    const l = linea.trim();
    if (!l) continue;
    const partes = l.split("|");
    if (partes.length < 4) continue;
    const dur = Number(partes[0]);
    const id = partes[1];
    const canal = partes[partes.length - 1];
    const titulo = partes.slice(2, partes.length - 1).join("|");
    if (!id || id === "NA" || !titulo || titulo === "NA") continue;
    if (!Number.isFinite(dur) || dur < DURACION_MINIMA_S || dur > DURACION_MAXIMA_S) continue;
    items.push({
      id,
      tipo: "track",
      titulo,
      artista: canal && canal !== "NA" ? canal : "",
      album: "",
      caratula: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duracionMs: Math.round(dur * 1000),
      isrc: null,
    });
  }
  busquedas.set(clave, { valor: items, expira: ahora + TTL_BUSQUEDA_MS });
  return items;
}

function json(res, estado, cuerpo) {
  const cuerpoTexto = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(cuerpoTexto);
}

function podar(mapa, ahora) {
  for (const [k, v] of mapa) if (v.expira <= ahora) mapa.delete(k);
  while (mapa.size > MAX_TOKENS) mapa.delete(mapa.keys().next().value);
}

async function manejarResolver(res, url) {
  const titulo = (url.searchParams.get("titulo") ?? "").trim();
  const artista = (url.searchParams.get("artista") ?? "").trim();
  const duracionS = Math.max(0, Number(url.searchParams.get("duracion") ?? 0) || 0);
  if (!titulo) return json(res, 400, { error: "falta titulo" });

  const ahora = Date.now();
  podar(resoluciones, ahora);
  const clave = `${normalizar(titulo)}|${normalizar(artista)}|${duracionS}`;
  let r = resoluciones.get(clave)?.valor ?? null;
  if (!r) {
    r = await buscarPista(titulo, artista, duracionS);
    if (!r) return json(res, 404, { error: "sin resultado en youtube" });
    resoluciones.set(clave, { valor: r, expira: ahora + TTL_RESOLUCION_MS });
  }

  const token = randomBytes(9).toString("base64url");
  podar(tokens, ahora);
  tokens.set(token, { url: r.url, expira: ahora + TTL_TOKEN_MS });
  json(res, 200, {
    videoId: r.videoId,
    titulo: r.tituloVideo,
    duracion: r.duracion,
    stream: `/audio/${token}`,
  });
}

async function manejarBuscar(res, url) {
  const consulta = (url.searchParams.get("consulta") ?? url.searchParams.get("q") ?? "").trim();
  const limite = Math.max(1, Math.min(24, Number(url.searchParams.get("limite") ?? 12) || 12));
  if (!consulta) return json(res, 400, { error: "falta consulta" });
  const items = await buscarCatalogoYouTube(consulta, limite);
  if (!items) return json(res, 502, { error: "youtube no respondió" });
  json(res, 200, { items });
}

async function manejarAudio(res, token) {
  const entrada = tokens.get(token);
  if (!entrada || entrada.expira <= Date.now()) return json(res, 404, { error: "token vencido" });

  const cabeceras = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" };
  if (res.req.headers.range) cabeceras.range = res.req.headers.range;

  let upstream;
  try {
    upstream = await fetch(entrada.url, { headers: cabeceras, redirect: "follow" });
  } catch (e) {
    return json(res, 502, { error: `googlevideo no respondió: ${e.message}` });
  }

  const passthrough = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];
  const cabecerasRes = { "access-control-allow-origin": "*" };
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) cabecerasRes[h] = v;
  }
  res.writeHead(upstream.status, cabecerasRes);

  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "range",
        "access-control-expose-headers": "content-length, content-range, accept-ranges",
      });
      return res.end();
    }
    if (url.pathname === "/salud") return json(res, 200, { ok: true });
    if (url.pathname === "/buscar") return await manejarBuscar(res, url);
    if (url.pathname === "/resolver") return await manejarResolver(res, url);
    const m = /^\/audio\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (m) return await manejarAudio(res, m[1]);
    json(res, 404, { error: "ruta desconocida" });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`backend yt-dlp en http://127.0.0.1:${PUERTO}`);
  console.log(`  habilitar en la demo: YT_DLP_BACKEND_URL=http://127.0.0.1:${PUERTO}`);
  console.log("  (Ctrl+C para cerrar)");
});
