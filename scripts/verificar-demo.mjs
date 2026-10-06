#!/usr/bin/env node
/**
 * Verifica la demo EN EL NAVEGADOR, que es donde se ve.
 *
 * Los harness de `probar-*.mjs` prueban el servidor; este maneja Chrome de
 * verdad (misma librería CDP que las capturas) para comprobar lo que solo se
 * nota mirando: que las 4 burbujas entren sin scroll en el marco de celular,
 * que al tocar una canción suene SOLA (autoplay real, con clic real), que el
 * miniplayer tenga sus controles y que la cuota baje.
 *
 *   pnpm dev                       # en otra terminal (puerto 3000)
 *   node scripts/verificar-demo.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9345);
const PERFIL = path.join(raiz, ".capturas-perfil-verif");
const SALIDA = path.join(raiz, "scripts", ".cache");
fs.mkdirSync(SALIDA, { recursive: true });

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

async function esperar(ses, expr, { tiempo = 25000, nombre = expr, cada = 150 } = {}) {
  const fin = Date.now() + tiempo;
  let ultimo = null;
  while (Date.now() < fin) {
    try {
      if (await js(ses, `!!(${expr})`)) return true;
    } catch (e) {
      ultimo = e;
    }
    await dormir(cada);
  }
  let pista = "";
  try {
    pista = await js(
      ses,
      `JSON.stringify({ url: location.href, listo: document.readyState,
        hayDemo: !!document.querySelector("#demo"),
        hayForm: !!document.querySelector("#demo form"),
        errores: (window.__errores||[]).slice(0,3) })`,
    );
  } catch {}
  throw new Error(
    `Timeout esperando: ${nombre}\n    ↳ ${pista}${ultimo ? `\n    ↳ último error: ${ultimo.message}` : ""}`,
  );
}

/** Centro de un elemento, ya centrado en la pantalla. */
async function centroDe(ses, selector) {
  await js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ block: "center" }); return !!el; })()`,
  );
  await dormir(220);
  return js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  );
}

/** Clic REAL (evento de entrada): sintético NO da activación de usuario. */
async function clic(ses, selector) {
  const c = await centroDe(ses, selector);
  if (!c) throw new Error("no encontré " + selector);
  await ses.ev("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
  await ses.ev("Input.dispatchMouseEvent", {
    type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1,
  });
  await ses.ev("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1,
  });
}

/** Escribe en un input controlado por React (setter nativo + evento input). */
async function escribir(ses, selector, texto) {
  await js(
    ses,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, ${JSON.stringify(texto)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return el.value;
    })()`,
  );
}

const foto = async (ses, nombre, clip) => {
  const params = { format: "png", fromSurface: true };
  if (clip) {
    const r = await js(ses, `(() => { const el = document.querySelector(${JSON.stringify(clip)});
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 }; })()`);
    params.clip = r;
  }
  const { data } = await ses.ev("Page.captureScreenshot", params);
  fs.writeFileSync(path.join(SALIDA, nombre), Buffer.from(data, "base64"));
  console.log(`      → ${nombre}`);
};

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
const ses = await nuevaSesion(browser, { w: 1100, h: 1000, dpr: 2 });

// El sitio publica una Content-Security-Policy: acá se anota cualquier cosa que
// esa política bloquee (una imagen de portada, una fuente, el audio), para que
// una CSP mal puesta se vea como una aserción fallada y no como "no carga".
await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
  source:
    "window.__csp=[];" +
    "addEventListener('securitypolicyviolation',e=>window.__csp.push((e.violatedDirective||'?')+' <- '+(e.blockedURI||'?')));",
});

try {
  console.log(`${BASE} · marco de celular\n`);
  await ses.ev("Page.navigate", { url: `${BASE}/#demo` });
  // Se espera al FORMULARIO, no a la sección: el marco puede existir un
  // instante antes de que React monte el buscador.
  await esperar(ses, `document.querySelector("#demo form")`, { nombre: "buscador montado" });
  await esperar(ses, `document.querySelector("#demo form").querySelector('[role="group"]')`, {
    nombre: "burbujas montadas",
  });
  await js(ses, `document.querySelector("#demo").scrollIntoView()`);
  await dormir(700);

  // ── 1. Las 4 burbujas, sin scroll horizontal ──
  const burbujas = await js(
    ses,
    `(() => {
      const form = document.querySelector("#demo form");
      const grupo = form.querySelector('[role="group"]');
      if (!grupo) return null;
      const hijos = [...grupo.children];
      const g = grupo.getBoundingClientRect();
      const desbordan = hijos.filter((h) => {
        const r = h.getBoundingClientRect();
        return r.right > g.right + 1 || r.left < g.left - 1;
      }).length;
      return {
        cuantas: hijos.length,
        textos: hijos.map((h) => h.innerText.trim()),
        scrollX: grupo.scrollWidth - grupo.clientWidth,
        desbordan,
        filas: new Set(hijos.map((h) => Math.round(h.getBoundingClientRect().top))).size,
      };
    })()`,
  );
  console.log("burbujas:", JSON.stringify(burbujas));
  check("están las 4 burbujas", burbujas?.cuantas === 4, String(burbujas?.cuantas));
  check("ninguna se sale del recuadro", burbujas?.desbordan === 0);
  check("no hay scroll horizontal", (burbujas?.scrollX ?? 99) <= 1, `scrollX=${burbujas?.scrollX}`);
  await foto(ses, "demo-celular.png", "#demo [role='img']");

  // ── 2. Búsqueda ──
  await escribir(ses, "#demo input[type='text'], #demo input:not([type])", "get lucky daft punk");
  await clic(ses, "#demo form button[type='submit']");
  await esperar(ses, `document.querySelectorAll("#demo ul li button").length > 0`);
  // Cada fila se lee entera (título + artista): el artista es el que dice
  // cuál es la grabación pedida, no el título.
  const filas = await js(
    ses,
    `[...document.querySelectorAll("#demo ul li button")].map((b) => b.innerText.replace(/\\s+/g, " ").trim())`,
  );
  console.log("resultados:", JSON.stringify(filas.slice(0, 3)));
  check(
    "el listado trae el original de Daft Punk primero",
    /daft punk/i.test(filas?.[0] ?? "") && !/experience|charli|parra/i.test(filas?.[0] ?? ""),
    filas?.[0],
  );

  // ── 3. Autoplay con clic REAL ──
  await clic(ses, "#demo ul li button");
  await esperar(ses, `!!document.querySelector("#demo svg.lucide-pause")`, {
    tiempo: 30000,
    nombre: "que arranque solo (icono de pausa)",
  });
  await dormir(1200);
  const estado = await js(
    ses,
    `(() => {
      const mini = document.querySelector("#demo svg.lucide-pause")?.closest("div.border-t")?.parentElement;
      const barra = document.querySelector("#demo .h-1 > div");
      return {
        suena: !!document.querySelector("#demo svg.lucide-pause"),
        progreso: barra ? barra.style.width : null,
        controles: {
          aleatoria: !!document.querySelector("#demo svg.lucide-shuffle"),
          anterior: !!document.querySelector("#demo svg.lucide-skip-back"),
          playPausa: !!document.querySelector("#demo svg.lucide-pause, #demo svg.lucide-play"),
          siguiente: !!document.querySelector("#demo svg.lucide-skip-forward"),
          silencio: !!document.querySelector("#demo svg.lucide-volume-2, #demo svg.lucide-volume-x"),
          volumen: !!document.querySelector("#demo input[type='range']"),
        },
        cuota: [...document.querySelectorAll("#demo span")].map((s) => s.innerText).find((t) => /reproducc/i.test(t)) ?? null,
      };
    })()`,
  );
  console.log("miniplayer:", JSON.stringify(estado));
  check("arranca SOLO al tocar (sin apretar play)", estado?.suena === true);
  check("la barra avanza", Boolean(estado?.progreso) && estado.progreso !== "0%", String(estado?.progreso));
  check("tiene aleatoria", estado?.controles?.aleatoria === true);
  check("tiene anterior", estado?.controles?.anterior === true);
  check("tiene play/pausa", estado?.controles?.playPausa === true);
  check("tiene siguiente", estado?.controles?.siguiente === true);
  check("tiene silencio", estado?.controles?.silencio === true);
  check("tiene volumen", estado?.controles?.volumen === true);
  check("la cuota bajó a 3", /3/.test(estado?.cuota ?? ""), String(estado?.cuota));

  // ── 4. Las cuatro categorías se pueden recorrer ──
  // Cambiar de burbuja reabre la búsqueda: el listado tiene que pasar a
  // álbumes, cada fila decir QUÉ es (insignia) y abrir una traer su música.
  await clic(ses, "#demo form [role='group'] button:nth-child(2)");
  await esperar(
    ses,
    `document.querySelectorAll("#demo ul li button [class*=uppercase]").length > 0`,
    { nombre: "resultados de álbumes", tiempo: 30000 },
  );
  const insignias = await js(
    ses,
    `[...document.querySelectorAll("#demo ul li button [class*=uppercase]")].map((e) => e.innerText.trim())`,
  );
  console.log("insignias:", JSON.stringify(insignias.slice(0, 4)));
  check(
    "cambiar de burbuja cambia la categoría del listado",
    /álbum|album/i.test(insignias?.[0] ?? ""),
    insignias?.[0],
  );

  const album = await js(
    ses,
    `(() => { const b = document.querySelector("#demo ul li button"); if (!b) return null;
      return { titulo: b.querySelector("span.truncate")?.innerText?.trim() ?? "",
               insignia: b.querySelector("[class*=uppercase]")?.innerText?.trim() ?? "" }; })()`,
  );
  await clic(ses, "#demo ul li button");
  await esperar(ses, `document.querySelectorAll("#demo ul li button").length > 0`, {
    nombre: "música del álbum abierto",
  });
  await dormir(1200);
  const trasAbrir = await js(
    ses,
    `({ valor: document.querySelector("#demo input")?.value ?? "",
        insignias: [...document.querySelectorAll("#demo ul li button [class*=uppercase]")].length,
        filas: [...document.querySelectorAll("#demo ul li button")].slice(0, 2).map((b) => b.innerText.replace(/\\s+/g, " ").trim()) })`,
  );
  console.log("tras abrir el álbum:", JSON.stringify(trasAbrir));
  check(
    "abrir un álbum busca su música",
    Boolean(album?.titulo) && trasAbrir?.valor === album.titulo,
    `${album?.titulo} → ${trasAbrir?.valor}`,
  );
  check("la música del álbum vuelve a ser canciones", (trasAbrir?.insignias ?? 1) === 0, String(trasAbrir?.insignias));

  // Volver a Canciones para dejar el marco como estaba.
  await clic(ses, "#demo form [role='group'] button:nth-child(1)");
  await dormir(600);

  // La CSP tiene que dejar pasar todo lo que la demo necesita de verdad.
  const csp = await js(ses, `(window.__csp || []).slice(0, 8)`);
  check("la CSP no bloquea nada de lo que carga la demo", (csp?.length ?? 0) === 0, JSON.stringify(csp));

  await foto(ses, "demo-miniplayer.png", "#demo [role='img']");

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await ses.cerrar();
  await cerrar();
}
