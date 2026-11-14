#!/usr/bin/env node
/**
 * Deja Yattee extrayendo por Invidious y lo verifica.
 *
 * Render puede reiniciar el contenedor y, si no tiene disco persistente, la
 * base de Yattee vuelve a los valores de fabrica: ahi yt-dlp choca con el 429
 * de YouTube y con el solver Deno sin memoria. Este script reaplica los ajustes
 * por la API de administracion y comprueba que una busqueda y un video reales
 * devuelvan audio. Es idempotente: se puede correr despues de cada despliegue.
 *
 *   $env:YATTEE_AUTH="usuario:clave"; pnpm configurar:yattee
 *   $env:INVIDIOUS_INSTANCE="https://otra-instancia"; pnpm configurar:yattee
 */

const BASE = (process.env.YATTEE_URL ?? "https://yattee-server-2j61.onrender.com").replace(/\/+$/, "");
const AUTH = process.env.YATTEE_AUTH ?? "";
const INSTANCE = (process.env.INVIDIOUS_INSTANCE ?? "https://yt.chocolatemoo53.com").replace(/\/+$/, "");
const CONSULTA = process.env.CONSULTA ?? "Meet Los Thuthanaka Pitchfork";

if (!AUTH) {
  console.error("Falta YATTEE_AUTH (usuario:clave).");
  process.exit(1);
}

const cabeceras = {
  Authorization: `Basic ${Buffer.from(AUTH).toString("base64")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

const ajustes = {
  invidious_enabled: true,
  invidious_instance: INSTANCE,
  invidious_timeout: 30,
  invidious_max_retries: 3,
  invidious_retry_delay: 1.0,
  invidious_proxy_channels: true,
  invidious_proxy_channel_tabs: true,
  invidious_proxy_videos: true,
  invidious_proxy_playlists: true,
  invidious_proxy_captions: true,
  invidious_proxy_thumbnails: true,
  invidious_local_streams: true,
};

async function pedir(ruta, opciones = {}, ms = 120_000) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    const res = await fetch(`${BASE}${ruta}`, { ...opciones, headers: cabeceras, signal: control.signal });
    const texto = await res.text();
    let cuerpo = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = texto;
    }
    return { ok: res.ok, status: res.status, cuerpo };
  } finally {
    clearTimeout(reloj);
  }
}

console.log(`Yattee: ${BASE}`);
console.log(`Invidious: ${INSTANCE}`);

let guardado = await pedir("/api/settings", { method: "PUT", body: JSON.stringify(ajustes) });
if (!guardado.ok && guardado.status >= 500) {
  console.log(`Reintentando ajustes (${guardado.status})...`);
  guardado = await pedir("/api/settings", { method: "PUT", body: JSON.stringify(ajustes) });
}
if (!guardado.ok) {
  console.error(`No se pudieron guardar los ajustes: HTTP ${guardado.status}`);
  console.error(guardado.cuerpo);
  process.exit(1);
}

const s = guardado.cuerpo ?? {};
console.log(
  `Ajustes: invidious=${s.invidious_enabled} instancia=${s.invidious_instance} local=${s.invidious_local_streams}`,
);

const busqueda = await pedir(`/api/v1/search?q=${encodeURIComponent(CONSULTA)}&type=video`, {}, 120_000);
const resultados = Array.isArray(busqueda.cuerpo) ? busqueda.cuerpo : [];
console.log(`Busqueda: HTTP ${busqueda.status}, ${resultados.length} resultados`);

const primero = resultados.find((r) => r?.videoId);
if (!primero) {
  console.error("La busqueda no devolvio ningun video: revisar la instancia de Invidious.");
  process.exit(1);
}

const video = await pedir(`/api/v1/videos/${encodeURIComponent(primero.videoId)}`, {}, 120_000);
const v = video.cuerpo ?? {};
const formatos = (v.adaptiveFormats ?? []).filter((f) => f?.url && String(f.type ?? "").startsWith("audio/"));
console.log(
  `Video: HTTP ${video.status}, metodo=${v.extractionMethod ?? "?"}, duracion=${v.lengthSeconds ?? "?"}s, audio=${formatos.length}`,
);

if (!video.ok || formatos.length === 0) {
  console.error("El video no devolvio formatos de audio: yt-dlp/Invidious sigue roto.");
  process.exit(1);
}

console.log("OK: Yattee esta extrayendo por Invidious y devuelve audio.");
