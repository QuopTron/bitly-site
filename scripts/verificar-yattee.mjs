#!/usr/bin/env node
/**
 * Verifica el servidor de Yattee propio: el canal de YouTube que usa
 * producción para los temas que el catálogo sin pérdida no tiene.
 *
 * Comprueba, en orden, lo que se rompe de verdad:
 *   1. `/health` — el host está despierto (plan free) y cuánto tarda.
 *   2. `/api/settings` — con qué se está extrayendo: POT encendido o no,
 *      proxy de salida, familia de IP, timeout de yt-dlp.
 *   3. `/api/v1/search` — el índice contesta y trae el tema pedido.
 *   4. `/api/v1/videos/:id` — el extractor devuelve formatos de AUDIO (el
 *      síntoma clásico de YouTube bloqueando es 200 con `adaptiveFormats` vacío).
 *   5. el `relay` del formato elegido — que salgan bytes de verdad, que es lo
 *      único que garantiza que el navegador va a poder sonar.
 *
 *   YATTEE_URL=https://yattee-server-2j61.onrender.com \
 *   YATTEE_AUTH='admin:<la-contraseña>' \
 *   node scripts/verificar-yattee.mjs [tema a buscar]
 *
 * `ACTIVAR_POT=1` enciende el proveedor de PO token en caliente (PUT
 * /api/settings) y vuelve a probar la extracción: sirve para confirmar que esa
 * es la causa antes de tocar el panel de Render. El cambio es en memoria de la
 * base: para que sobreviva a un reinicio hay que poner `YT_POT_ENABLED=true`
 * en el entorno del servicio.
 */

const BASE = (process.env.YATTEE_URL ?? "").replace(/\/+$/, "");
const AUTH = (process.env.YATTEE_AUTH ?? "").trim();
const CONSULTA = (process.argv[2] ?? process.env.CONSULTA ?? "Los Thuthanaka").trim();
const VIDEO_ID = (process.env.VIDEO_ID ?? "").trim();
const ACTIVAR_POT = /^(1|true|si|sí)$/i.test(process.env.ACTIVAR_POT ?? "");

if (!BASE) {
  console.error("Falta YATTEE_URL (y YATTEE_AUTH si el servidor pide auth básica).");
  process.exit(2);
}
if (!AUTH) {
  console.error("Falta YATTEE_AUTH (\"usuario:contraseña\"); sin eso todo da 401.");
  process.exit(2);
}

let ok = 0;
let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) {
    ok++;
    console.log(`OK    ${nombre}${detalle ? `  (${detalle})` : ""}`);
  } else {
    fallos++;
    console.log(`FALLA ${nombre}${detalle ? `  (${detalle})` : ""}`);
  }
};

const auth = { Authorization: `Basic ${Buffer.from(AUTH).toString("base64")}` };

async function pedir(ruta, { ms = 60_000, ...init } = {}) {
  const inicio = Date.now();
  const res = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: { Accept: "application/json", ...auth, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(ms),
  });
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = texto.slice(0, 300);
  }
  return { res, cuerpo, ms: Date.now() - inicio };
}

const seg = (ms) => `${(ms / 1000).toFixed(1)} s`;
const audio = (video) => (video?.adaptiveFormats ?? []).filter((f) => f.url && String(f.type ?? "").startsWith("audio/"));

console.log(`${BASE} · ${CONSULTA}${ACTIVAR_POT ? " · activando POT" : ""}\n`);

// ── 1. Salud ──
try {
  const { res, cuerpo, ms } = await pedir("/health", { ms: 90_000 });
  check("la salud responde 200", res.ok, `${res.status} · ${seg(ms)}${ms > 2500 ? " (arranque en frío)" : ""}`);
  check("la salud dice ok", cuerpo?.status === "ok", JSON.stringify(cuerpo));
} catch (e) {
  check("la salud responde 200", false, e.message);
}

// ── 2. Ajustes: la causa se ve acá ──
let potEncendido = null;
try {
  const { res, cuerpo, ms } = await pedir("/api/settings");
  check("los ajustes responden", res.ok, `${res.status} · ${seg(ms)}`);
  if (res.ok && cuerpo && typeof cuerpo === "object") {
    potEncendido = cuerpo.yt_pot_enabled === true;
    console.log(
      `      pot=${cuerpo.yt_pot_enabled} proxy=${cuerpo.yt_egress_proxy ?? "—"} ` +
        `ip=${cuerpo.yt_ip_family ?? "—"} timeout=${cuerpo.ytdlp_timeout ?? "—"}s`,
    );
    check("el proveedor de PO token está encendido", potEncendido, potEncendido ? "" : "yt_pot_enabled=false");
  }
} catch (e) {
  check("los ajustes responden", false, e.message);
}

if (ACTIVAR_POT && potEncendido === false) {
  const { res, cuerpo, ms } = await pedir("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yt_pot_enabled: true }),
  });
  check("se encendió POT en caliente", res.ok && cuerpo?.yt_pot_enabled === true, `${res.status} · ${seg(ms)}`);
  potEncendido = cuerpo?.yt_pot_enabled === true;
}

// ── 3. Búsqueda ──
let candidatos = [];
try {
  const { res, cuerpo, ms } = await pedir(`/api/v1/search?q=${encodeURIComponent(CONSULTA)}&type=video`);
  candidatos = Array.isArray(cuerpo) ? cuerpo.filter((c) => c?.videoId && !c.liveNow) : [];
  check("la búsqueda trae resultados", candidatos.length > 0, `${res.status} · ${seg(ms)} · ${candidatos.length} videos`);
  const primero = candidatos[0];
  if (primero) console.log(`      ${primero.videoId} · ${primero.author ?? "?"} · ${primero.title ?? "?"}`);
  check("algún resultado es del tema pedido", candidatos.some((c) => /thuthanaka|los thuthanaka/i.test(c.title ?? "")), "");
} catch (e) {
  check("la búsqueda trae resultados", false, e.message);
}

// ── 4. Extracción: formatos de audio ──
const objetivos = VIDEO_ID ? [{ videoId: VIDEO_ID, title: "(directo)", author: "" }] : candidatos.slice(0, 3);
let elegido = null;
for (const c of objetivos) {
  const { res, cuerpo, ms } = await pedir(
    `/api/v1/videos/${encodeURIComponent(c.videoId)}?proxy=true&proxy_mode=relay`,
    { ms: 60_000 },
  );
  const formatos = audio(cuerpo);
  check(
    `formatos de audio de ${c.videoId}`,
    formatos.length > 0,
    `${res.status} · ${seg(ms)} · ${formatos.length} formatos`,
  );
  if (formatos.length === 0) {
    const pista = typeof cuerpo === "object" ? JSON.stringify(cuerpo).slice(0, 220) : String(cuerpo).slice(0, 220);
    console.log(`      respuesta: ${pista}`);
    continue;
  }
  const universales = formatos.filter((f) => /mp4|m4a/.test(String(f.type ?? "")));
  elegido = (universales.length ? universales : formatos).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  console.log(`      elegido: ${elegido.type} · ${Math.round((elegido.bitrate ?? 0) / 1000)} kbps`);
  break;
}

// ── 5. Bytes del relay ──
if (elegido?.url) {
  const url = new URL(String(elegido.url), BASE).toString();
  const inicio = Date.now();
  const res = await fetch(url, {
    headers: { ...auth, Range: "bytes=0-262143" },
    signal: AbortSignal.timeout(60_000),
  });
  const trozo = await res.arrayBuffer();
  check("el relay devuelve audio", res.ok && trozo.byteLength > 0, `${res.status} · ${seg(Date.now() - inicio)} · ${trozo.byteLength} bytes`);
  check("el relay sirve con Range", res.status === 206 || trozo.byteLength > 0, String(res.status));
  check("el tipo es de audio", /audio|octet-stream|video\/mp4/.test(res.headers.get("content-type") ?? ""), res.headers.get("content-type") ?? "—");
} else {
  check("el relay devuelve audio", false, "sin formato que pedir");
}

console.log(`\n${ok} OK · ${fallos} fallas`);
if (fallos > 0 && potEncendido === false) {
  console.log(
    "\nPista: con yt_pot_enabled=false yt-dlp sale con `fetch_pot=never` y YouTube contesta\n" +
      "«Sign in to confirm you're not a bot»: 200 sin formatos. Probá ACTIVAR_POT=1, y si\n" +
      "arregla, poné YT_POT_ENABLED=true en el entorno del servicio para que dure.",
  );
}
process.exit(fallos > 0 ? 1 : 0);
