#!/usr/bin/env node
/**
 * Prueba el flujo que ninguna otra suite cubre: un tema de nicho que sólo existe
 * en el canal de YouTube, de la búsqueda al audio sonando.
 *
 * `verificar-demo.mjs` prueba el reproductor con un catálogo que responde en
 * segundos; esto prueba lo otro: que la búsqueda encuentre el tema en el canal
 * de YouTube, que el clic resuelva el audio y que el `<audio>` AVANCE de verdad
 * (no que exista el botón de pausa). Es el camino que se rompe cuando YouTube
 * cambia algo o cuando el servidor de Yattee se queda sin formatos.
 *
 * Se corre contra el sitio publicado, que es donde el canal está configurado:
 *
 *   node scripts/verificar-audio-nicho.mjs
 *   DEMO_URL=http://127.0.0.1:8799 node scripts/verificar-audio-nicho.mjs
 *   CONSULTA="Chuquimamani-Condori" node scripts/verificar-audio-nicho.mjs
 *
 * Sale con código 1 si el audio no suena, así que sirve en un cron o antes de
 * un deploy.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "https://bitly-site.pages.dev";
const CONSULTA = process.env.CONSULTA ?? "Los Thuthanaka";
const PUERTO = Number(process.env.CDP_PORT ?? 9355);
const PERFIL = path.join(raiz, ".capturas-perfil-audio-nicho");
/** La extracción en frío ronda los 25 s, y la precarga arranca al listar. */
const TOPE_AUDIO_MS = Number(process.env.TOPE_AUDIO_MS ?? 90_000);
const TOPE_BUSQUEDA_MS = Number(process.env.TOPE_BUSQUEDA_MS ?? 60_000);

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

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
const ses = await nuevaSesion(browser, { w: 900, h: 1000, dpr: 1 });

// El tutorial de la cabecera tapa los controles la primera vez; el <audio> se
// guarda al pedir play porque la demo lo crea con `new Audio()` (no está en el
// DOM) y no hay otra forma de leer su estado.
await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('bitly_pistas_cabecera','1')}catch{}",
});
await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
  source:
    "window.__audio=[];" +
    "const original=HTMLMediaElement.prototype.play;" +
    "HTMLMediaElement.prototype.play=function(){window.__el=this;" +
    "window.__audio.push({t:Math.round(performance.now())});" +
    "const r=original.apply(this,arguments);" +
    "if(r&&r.catch)r.catch(e=>window.__audio.push({rechazo:String(e&&e.name||e)}));" +
    "return r};",
});

async function esperar(expr, { tiempo = 30_000, nombre = expr, cada = 200 } = {}) {
  const fin = Date.now() + tiempo;
  while (Date.now() < fin) {
    try {
      if (await js(ses, `!!(${expr})`)) return true;
    } catch {}
    await dormir(cada);
  }
  return false;
}

async function clicReal(selector) {
  const c = await js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  );
  if (!c) throw new Error(`no encontré ${selector}`);
  await dormir(250);
  await ses.ev("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
  await ses.ev("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
  await ses.ev("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
}

try {
  console.log(`${BASE} · ${CONSULTA}\n`);
  await ses.ev("Page.navigate", { url: `${BASE}/#demo` });

  const vista = await esperar(`document.querySelector('[data-vista="demo"]')?.getAttribute('aria-hidden') === 'false'`, {
    nombre: "vista demo",
    tiempo: 60_000,
  });
  check("la demo abre", vista);
  if (!vista) throw new Error("la demo no abrió");

  const buscador = await esperar(`document.querySelector("#demo form input")`, { nombre: "buscador" });
  check("el buscador está montado", buscador);
  if (!buscador) throw new Error("sin buscador");

  await js(
    ses,
    `(() => {
      const el = document.querySelector("#demo form input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, ${JSON.stringify(CONSULTA)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );

  // Una búsqueda puede quedarse colgada del lado del servidor (se vio más de
  // una vez). El visitante reintenta; la prueba también, una sola vez, para no
  // fallar por un hipo de red que no tiene que ver con el audio.
  let hayFilas = false;
  let msBusqueda = 0;
  for (let intento = 1; intento <= 2 && !hayFilas; intento++) {
    const tBusqueda = Date.now();
    await js(ses, `document.querySelector("#demo form").requestSubmit()`);
    hayFilas = await esperar(`document.querySelectorAll("#demo ul li button").length > 0`, {
      nombre: "resultados",
      tiempo: TOPE_BUSQUEDA_MS,
    });
    msBusqueda = Date.now() - tBusqueda;
    if (!hayFilas) console.log(`      intento ${intento}: sin filas en ${(msBusqueda / 1000).toFixed(1)} s`);
  }
  check("la búsqueda trae resultados", hayFilas, `${(msBusqueda / 1000).toFixed(1)} s`);
  if (!hayFilas) throw new Error("la búsqueda no trajo filas");

  const filas = await js(
    ses,
    `[...document.querySelectorAll("#demo ul li button")].map((b) => b.innerText.replace(/\\s+/g, " ").trim())`,
  );
  check(
    "el tema pedido está en la lista",
    filas.some((f) => new RegExp(CONSULTA.split(" ")[0], "i").test(f)),
    filas[0],
  );

  const tClic = Date.now();
  await clicReal("#demo ul li button");
  const pidioPlay = await esperar(`window.__audio.length > 0`, { nombre: "play()", tiempo: TOPE_AUDIO_MS });
  check("el clic pide reproducir", pidioPlay);
  if (!pidioPlay) throw new Error("nunca se llamó a play()");

  const suena = await esperar(`window.__el && !window.__el.paused && window.__el.currentTime > 0.5`, {
    nombre: "audio avanzando",
    tiempo: TOPE_AUDIO_MS,
  });
  const msAudio = Date.now() - tClic;
  check("el audio avanza", suena, `${(msAudio / 1000).toFixed(1)} s después del clic`);
  if (!suena) throw new Error("el audio no avanzó");

  const estado = await js(
    ses,
    `(() => { const el = window.__el; return {
      src: String(el.currentSrc || el.src).slice(0, 120),
      t: Number(el.currentTime.toFixed(1)),
      dur: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
      progreso: document.querySelector("#demo .h-1 > div")?.style.width ?? null,
      pausa: !!document.querySelector("#demo svg.lucide-pause"),
      errores: (window.__errores || []).slice(0, 3),
    }; })()`,
  );
  console.log("estado:", JSON.stringify(estado));

  check("el stream no es un adelanto", (estado.dur ?? 0) > 60, `${estado.dur} s`);
  check("el miniplayer marca pausa", estado.pausa === true);
  check("la barra avanzó", Boolean(estado.progreso) && estado.progreso !== "0%", String(estado.progreso));
  check("la página no registró errores", estado.errores.length === 0, estado.errores.join(" | "));

  const urlYattee = (process.env.YATTEE_URL ?? "").replace(/\/+$/, "");
  if (urlYattee) {
    check("el audio viene del servidor de Yattee", estado.src.startsWith(urlYattee), estado.src.slice(0, 70));
  }
} catch (e) {
  console.log(`FALLO: ${e.message}`);
  try {
    console.log(
      "pista:",
      await js(
        ses,
        `JSON.stringify({ audio: window.__audio, el: window.__el && { t: window.__el.currentTime, err: window.__el.error && window.__el.error.code },
          texto: (document.querySelector("#demo")?.innerText || "").replace(/\\s+/g, " ").slice(0, 200) })`,
      ),
    );
  } catch {}
  fallos++;
} finally {
  await cerrar();
  fs.rmSync(PERFIL, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\n${ok} OK · ${fallos} fallas`);
process.exit(fallos > 0 ? 1 : 0);
