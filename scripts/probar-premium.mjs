#!/usr/bin/env node
/**
 * Verifica el CANJE de códigos Premium en el sitio, contra el registro real.
 *
 * Por qué existe: el canje lee `codes.json` del repo privado con
 * `BITLY_CODES_TOKEN`; si esa variable falta (o el token no tiene acceso), el
 * servidor responde "desconocido" y la interfaz dice "No pudimos verificar ese
 * código" + "El registro no respondió". Ese síntoma no se distingue de un error
 * de red mirando el código, así que la única prueba concluyente es pedir un
 * código que EXISTE y ver su estado real.
 *
 * Se usa un código con estado `usado` a propósito: la lectura es de sólo
 * lectura (el sitio nunca marca códigos), y "ya fue usado" sólo se puede
 * responder si el servidor efectivamente descargó el registro.
 *
 *   DEMO_URL=https://bitly-site.pages.dev \
 *   CODIGO_USADO=<un código con estado "usado"> \
 *   node scripts/probar-premium.mjs
 *
 * El código se pasa por variable de entorno para no embeber credenciales en el
 * repo. Se puede sacar de `scripts/.cache/codes.json` si está descargado.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9346);
const PERFIL = path.join(raiz, ".capturas-perfil-premium");
const CODIGO = process.env.CODIGO_USADO;

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
  while (Date.now() < fin) {
    try {
      if (await js(ses, `!!(${expr})`)) return true;
    } catch {}
    await dormir(cada);
  }
  throw new Error(`Timeout esperando: ${nombre}`);
}

/** Marca un elemento encontrado por expresión para poder clickearlo con CDP. */
async function marcar(ses, expr, tag) {
  return js(
    ses,
    `(() => { const el = ${expr}; if (!el) return false;
      el.setAttribute("data-harness", ${JSON.stringify(tag)}); return true; })()`,
  );
}

async function centroDe(ses, selector) {
  await js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ block: "center" }); return !!el; })()`,
  );
  await dormir(200);
  return js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  );
}

/** Clic REAL: el modal no lo necesita, pero así se prueba igual que un usuario. */
async function clic(ses, selector) {
  const c = await centroDe(ses, selector);
  if (!c) throw new Error("no encontré " + selector);
  await ses.ev("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
  await ses.ev("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
  await ses.ev("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
}

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

if (!CODIGO) {
  console.error("Falta CODIGO_USADO (un código con estado \"usado\" del registro).");
  process.exit(2);
}

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
const ses = await nuevaSesion(browser, { w: 1100, h: 1000, dpr: 2 });

try {
  console.log(`${BASE} · canje de código Premium\n`);
  await ses.ev("Page.navigate", { url: `${BASE}/#demo` });
  await esperar(ses, `document.querySelector("#demo form")`, { nombre: "buscador montado" });
  await dormir(600);

  // 1. Abrir el modal de canje.
  const abierto = await marcar(
    ses,
    `[...document.querySelectorAll("#demo button")].find((b) => /código premium|premium code/i.test(b.innerText))`,
    "canjear",
  );
  check("está el botón para canjear", abierto === true);
  await clic(ses, `[data-harness="canjear"]`);

  const hayInput = await marcar(
    ses,
    `[...document.querySelectorAll("input")].find((i) => /pegá tu código|paste your code/i.test(i.getAttribute("aria-label") || ""))`,
    "codigo",
  );
  await esperar(ses, `document.querySelector('[data-harness="codigo"]')`, { nombre: "input del modal" });
  check("se abrió el modal con el input", hayInput === true);

  // 2. Pegar el código y verificar.
  await escribir(ses, `[data-harness="codigo"]`, CODIGO);
  const hayBoton = await marcar(
    ses,
    `[...document.querySelectorAll('button[type="submit"]')].find((b) => /verificar código|verify code/i.test(b.innerText))`,
    "verificar",
  );
  check("está el botón Verificar", hayBoton === true);
  await clic(ses, `[data-harness="verificar"]`);

  // 3. Leer la respuesta del servidor.
  await esperar(ses, `document.querySelector('[role="status"]')`, { nombre: "respuesta del servidor", tiempo: 30000 });
  await dormir(400);
  const respuesta = await js(
    ses,
    `(() => {
      const estado = document.querySelector('[role="status"]')?.innerText?.trim() ?? null;
      const notas = [...document.querySelectorAll("p")].map((p) => p.innerText.trim())
        .filter((t) => /registro no respondió|registry did not respond|demasiados intentos|too many/i.test(t));
      // El status del RPC distingue "el handler contestó desconocido" (200) de
      // "el handler explotó" (500): el primero es un problema de datos, el
      // segundo de runtime (p. ej. process.env sin poblar).
      const rpc = performance
        .getEntriesByType("resource")
        .filter((r) => r.name.includes("_serverFn"))
        .map((r) => ({ status: r.responseStatus ?? null, url: r.name.split("/").pop() }));
      return { estado, notas, rpc };
    })()`,
  );
  console.log("respuesta:", JSON.stringify(respuesta));
  check(
    "el RPC respondió 200 (no 500)",
    (respuesta?.rpc ?? []).length > 0 && respuesta.rpc.every((r) => r.status === 200),
    JSON.stringify(respuesta?.rpc),
  );

  check(
    "el registro se leyó y el código figura como usado",
    /ya fue usado|already been used/i.test(respuesta?.estado ?? ""),
    respuesta?.estado,
  );
  check("no aparece el aviso de registro caído", (respuesta?.notas ?? []).length === 0, respuesta?.notas?.join(" | "));

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await ses.cerrar();
  await cerrar();
}
