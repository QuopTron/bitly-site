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
// El tutorial de la cabecera abre solo la primera vez y su capa tapa los
// controles de la demo: en la prueba se marca como visto antes de navegar.
await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
  source: "try{localStorage.setItem('bitly_pistas_cabecera','1')}catch{}",
});

try {
  console.log(`${BASE} · marco de celular\n`);
  await ses.ev("Page.navigate", { url: `${BASE}/#demo` });
  // La sección existe desde el SSR aunque la vista activa siga en "inicio":
  // primero se espera a que el hash active la pestaña de la demo (si no, los
  // clics caen sobre un panel desplazado fuera de pantalla).
  await esperar(
    ses,
    `document.querySelector('[data-vista="demo"]')?.getAttribute('aria-hidden') === 'false'`,
    { nombre: "vista demo activa" },
  );
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
  await foto(ses, "demo-celular.png", "#demo [class*='shadow-2xl']");

  // ── 2. Búsqueda ──
  await escribir(ses, "#demo input[type='text'], #demo input:not([type])", "get lucky daft punk");
  await clic(ses, "#demo form button[type='submit']");
  // Las canciones son filas anchas: el botón de reproducir de cada una lleva
  // "Reproducir o pausar: <pista>" y adentro van título, artista y álbum.
  await esperar(ses, `document.querySelectorAll("#demo button[aria-label^='Reproducir']").length > 0`);
  // Cada fila se lee entera (título + artista): el artista es el que dice
  // cuál es la grabación pedida, no el título.
  const filas = await js(
    ses,
    `[...document.querySelectorAll("#demo button[aria-label^='Reproducir']")].map((b) => b.innerText.replace(/\\s+/g, " ").trim())`,
  );
  check(
    "cada canción trae su botón de descarga",
    (await js(ses, `document.querySelectorAll("#demo button[aria-label^='Descargar']").length`)) === filas.length,
  );
  console.log("resultados:", JSON.stringify(filas.slice(0, 3)));
  check(
    "el listado trae el original de Daft Punk primero",
    /daft punk/i.test(filas?.[0] ?? "") && !/experience|charli|parra/i.test(filas?.[0] ?? ""),
    filas?.[0],
  );

  // ── 3. Autoplay con clic REAL ──
  await clic(ses, "#demo button[aria-label^='Reproducir']");
  // La resolución del audio pasa por el relay de stash y, si ese canal no
  // responde, por el backend local de yt-dlp: en una red lenta 30 s no alcanzan
  // y el verificador fallaba por impaciencia, no por un bug del reproductor.
  // El canal sin pérdida falla de vez en cuando (devuelve un cuerpo que el
  // navegador no puede abrir). El reproductor invalida esa URL al fallar, así
  // que un segundo toque —lo que haría cualquiera— la vuelve a resolver: se
  // reintenta una vez antes de dar la prueba por perdida.
  let sono = false;
  for (let intento = 0; intento < 2 && !sono; intento++) {
    if (intento > 0) await clic(ses, "#demo button[aria-label^='Reproducir']");
    try {
      await esperar(ses, `!!document.querySelector("#demo svg.lucide-pause")`, {
        tiempo: 45000,
        nombre: "que arranque solo (icono de pausa)",
      });
      sono = true;
    } catch (e) {
      if (intento === 1) throw e;
    }
  }
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
  check(
    "la cuota bajó a 3 (o ilimitadas en ventana libre)",
    /3/.test(estado?.cuota ?? "") || /ilimitadas/i.test(estado?.cuota ?? ""),
    String(estado?.cuota),
  );

  // La letra se pide al servidor (LRCLIB) y puede tardar; no se exige que la
  // línea actual ya esté pintada, pero sí que el verso exista (no el ♪ solo).
  let letra = "";
  for (let i = 0; i < 40; i++) {
    letra = await js(
      ses,
      `(document.querySelector("#demo [data-karaoke]")?.innerText ?? "").replace(/\\s+/g, " ").trim()`,
    );
    if (letra && letra !== "♪" && !letra.startsWith("♪ ·")) break;
    await dormir(250);
  }
  check("el miniplayer muestra la letra sincronizada", /legend|phoenix/i.test(letra), letra.slice(0, 90));

  // Tocar un verso salta a su segundo; al avanzar, el verso actual queda
  // marcado y la ventana se desplaza (karaoke, no una letra estática).
  const verso = await js(
    ses,
    `(() => { const b = [...document.querySelectorAll("#demo [data-karaoke] button")];
      if (b.length < 2) return null; const t = b[1].innerText.trim(); b[1].click(); return t; })()`,
  );
  await dormir(900);
  const activo = await js(
    ses,
    `(document.querySelector("#demo [data-karaoke] button[data-activa='1']")?.innerText ?? "").trim()`,
  );
  check("la letra avanza y pinta el verso actual", Boolean(verso) && activo === verso, activo);

  // ── 4. Las cuatro categorías se pueden recorrer ──
  // Cambiar de burbuja reabre la búsqueda: los resultados pasan a ser
  // colecciones (tarjetas cuadradas) y abrir una trae SU música en el lugar,
  // sin tocar lo que el visitante escribió en el buscador.
  await clic(ses, "#demo form [role='group'] button:nth-child(2)");
  await esperar(ses, `document.querySelectorAll("#demo button[title^='Ver la música de']").length > 0`, {
    nombre: "álbumes en tarjetas",
    tiempo: 30000,
  });
  const insignias = await js(
    ses,
    `[...document.querySelectorAll("#demo button[title^='Ver la música de'] [class*=uppercase]")].map((e) => e.innerText.trim())`,
  );
  console.log("insignias:", JSON.stringify(insignias.slice(0, 4)));
  check(
    "cambiar de burbuja cambia la categoría del listado",
    /álbum|album/i.test(insignias?.[0] ?? ""),
    insignias?.[0],
  );
  check("las colecciones son cuadradas", (await js(ses, `(() => { const t = document.querySelector("#demo button[title^='Ver la música de'] span[class*='aspect-square']");
    if (!t) return false; const r = t.getBoundingClientRect(); return Math.abs(r.width - r.height) <= 2; })()`)) === true);

  const album = await js(
    ses,
    `(() => { const b = document.querySelector("#demo button[title^='Ver la música de']"); if (!b) return null;
      const r = b.getBoundingClientRect();
      return { titulo: (b.querySelector("span.truncate")?.innerText ?? "").trim(),
               insignia: (b.querySelector("[class*=uppercase]")?.innerText ?? "").trim(),
               cuadrado: Math.abs(r.width - r.height) <= 4 }; })()`,
  );
  console.log("álbum a abrir:", JSON.stringify(album));
  await clic(ses, "#demo button[title^='Ver la música de']");
  await esperar(
    ses,
    `[...document.querySelectorAll("#demo button")].some((b) => /Reproducir todo/i.test(b.innerText))`,
    { nombre: "cabecera del álbum abierto", tiempo: 40000 },
  );
  await dormir(1200);
  const trasAbrir = await js(
    ses,
    `({ valor: document.querySelector("#demo input")?.value ?? "",
        cabecera: document.querySelector("#demo section, #demo")?.innerText.includes("Volver a resultados") ?? false,
        titulo: (document.querySelector("#demo h3")?.innerText ?? "").trim(),
        filas: document.querySelectorAll("#demo button[aria-label^='Reproducir']").length,
        volver: !!document.querySelector("#demo button[aria-label], #demo button") })`,
  );
  console.log("tras abrir el álbum:", JSON.stringify(trasAbrir));
  check("abrir una colección no cambia el buscador", trasAbrir?.valor === "get lucky daft punk", trasAbrir?.valor);
  check("la colección abierta muestra su cabecera", Boolean(trasAbrir?.titulo) && trasAbrir?.cabecera === true, trasAbrir?.titulo);
  check("la colección abierta lista sus canciones", (trasAbrir?.filas ?? 0) > 0, String(trasAbrir?.filas));
  check("hay un botón para volver a los resultados", (await js(ses, `[...document.querySelectorAll("#demo button")].some((b) => /Volver a resultados/i.test(b.innerText))`)) === true);

  // Volver a Canciones para dejar el marco como estaba.
  await clic(ses, "#demo form [role='group'] button:nth-child(1)");
  await dormir(600);

  // La CSP tiene que dejar pasar todo lo que la demo necesita de verdad.
  const csp = await js(ses, `(window.__csp || []).slice(0, 8)`);
  check("la CSP no bloquea nada de lo que carga la demo", (csp?.length ?? 0) === 0, JSON.stringify(csp));

  await foto(ses, "demo-miniplayer.png", "#demo [class*='shadow-2xl']");

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await ses.cerrar();
  await cerrar();
}
