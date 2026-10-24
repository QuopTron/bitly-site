#!/usr/bin/env node
/**
 * Verifica un backend de yt-dlp publicado: salud, token, búsqueda, resolución y
 * audio.
 *
 * Sirve para lo que ninguna suite del sitio puede probar: que el contenedor
 * tenga `yt-dlp` de verdad, que el token esté puesto y que el host (Render free,
 * por ejemplo) deje pasar el audio. También mide cuánto tarda en contestar la
 * primera petición, que es lo que paga el visitante cuando la instancia estaba
 * dormida.
 *
 *   BACKEND_URL=https://mi-backend.onrender.com \
 *   YT_DLP_TOKEN=<el mismo del backend> \
 *   node scripts/verificar-backend.mjs
 *
 * Sin `YT_DLP_TOKEN` sólo se prueban las rutas abiertas (`/salud`).
 */

const BASE = (process.env.BACKEND_URL ?? process.env.YT_DLP_BACKEND_URL ?? "").replace(/\/+$/, "");
const TOKEN = (process.env.YT_DLP_TOKEN ?? "").trim();

if (!BASE) {
  console.error("Falta BACKEND_URL (o YT_DLP_BACKEND_URL).");
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

const cabeceras = () => (TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {});

async function pedir(ruta, { timeout = 60_000, headers = {} } = {}) {
  const inicio = Date.now();
  const res = await fetch(`${BASE}${ruta}`, {
    headers: { "User-Agent": "bitly-verificar", ...headers, ...cabeceras() },
    signal: AbortSignal.timeout(timeout),
  });
  return { res, ms: Date.now() - inicio };
}

console.log(`${BASE} · backend de yt-dlp${TOKEN ? " (con token)" : " (sin token)"}\n`);

// 1. Salud: es el ping que usa el despertador del sitio.
try {
  const { res, ms } = await pedir("/salud");
  const cuerpo = await res.json().catch(() => null);
  check("la salud responde 200", res.ok, `${res.status} · ${ms} ms${ms > 2500 ? " (arranque en frío)" : ""}`);
  check("la salud dice que está ok", cuerpo?.ok === true, JSON.stringify(cuerpo));
} catch (e) {
  check("la salud responde 200", false, e.message);
}

// 2. Sin token, las rutas que trabajan quedan cerradas.
if (TOKEN) {
  const sin = await fetch(`${BASE}/buscar?consulta=test&limite=1`, {
    headers: { "User-Agent": "bitly-verificar" },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  check("sin token /buscar responde 401", sin?.status === 401, `status=${sin?.status ?? "sin respuesta"}`);
}

// 3. Búsqueda de catálogo.
let primero = null;
try {
  const { res, ms } = await pedir(`/buscar?consulta=${encodeURIComponent("Daft Punk")}&limite=5`, {
    timeout: 90_000,
  });
  const cuerpo = await res.json().catch(() => null);
  const items = Array.isArray(cuerpo?.items) ? cuerpo.items : [];
  primero = items[0] ?? null;
  check("la búsqueda responde 200", res.ok, `${res.status} · ${ms} ms`);
  check("trae resultados", items.length > 0, `${items.length} items`);
  check(
    "los resultados sirven para la demo",
    !!primero?.id && !!primero?.titulo && Number(primero?.duracionMs) > 0,
    primero ? `${primero.titulo} · ${Math.round(primero.duracionMs / 1000)} s` : "sin item",
  );
} catch (e) {
  check("la búsqueda responde 200", false, e.message);
}

// 4. Resolución de audio y bytes.
if (primero) {
  try {
    const consulta = new URLSearchParams({
      titulo: String(primero.titulo ?? ""),
      artista: String(primero.artista ?? ""),
      duracion: String(Math.round(Number(primero.duracionMs ?? 0) / 1000)),
    });
    const { res, ms } = await pedir(`/resolver?${consulta}`, { timeout: 90_000 });
    const cuerpo = await res.json().catch(() => null);
    check("la resolución responde 200", res.ok, `${res.status} · ${ms} ms`);
    check("devuelve un stream del proxy", /^\/audio\//.test(String(cuerpo?.stream ?? "")), String(cuerpo?.stream ?? ""));

    if (/^\/audio\//.test(String(cuerpo?.stream ?? ""))) {
      // Range chico: alcanza para probar que el audio baja, sin bajar el tema.
      const audio = await fetch(`${BASE}${cuerpo.stream}`, {
        headers: { Range: "bytes=0-262143", "User-Agent": "bitly-verificar" },
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      const largo = Number(audio?.headers.get("content-length") ?? 0);
      check("el audio se puede bajar", audio?.status === 206 || audio?.status === 200, `status=${audio?.status ?? "sin respuesta"}`);
      check(
        "el audio trae bytes de verdad",
        largo > 100_000,
        `${(largo / 1024).toFixed(0)} KB · ${audio?.headers.get("content-type") ?? "sin content-type"}`,
      );
      check("el audio es reproducible por el navegador", /audio|octet-stream|mp4|webm/i.test(audio?.headers.get("content-type") ?? ""), String(audio?.headers.get("content-type") ?? ""));
    }
  } catch (e) {
    check("la resolución responde 200", false, e.message);
  }
}

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
