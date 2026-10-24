#!/usr/bin/env node
/**
 * Verifica la navegación de vistas EN EL NAVEGADOR, en celular y escritorio.
 *
 * El sitio dejó de ser una página con anclas: ahora es un shell con cuatro
 * pantallas (inicio, instalar, planes, demo) que se deslizan. Por eso este
 * verificador mide lo que importa en este diseño:
 *
 *   · el riel de escritorio tiene las cuatro vistas, con 40 px de alto y sin
 *     desbordar a lo ancho;
 *   · tocar una vista cambia de pantalla y se anuncia con `aria-current`;
 *   · en celular el riel no entra (es `hidden lg:block`): el menú de la cabecera
 *     es el que navega, y se cierra solo al elegir;
 *   · nada desborda a lo ancho en 360 px.
 *
 *   pnpm dev
 *   DEMO_URL=http://localhost:3000 node scripts/verificar-nav.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9349);
const PERFIL = path.join(raiz, ".capturas-perfil-nav");

/** Las cuatro vistas del shell, en el orden del riel. */
const VISTAS = ["inicio", "instalar", "planes", "demo"];

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

async function esperar(ses, expr, { tiempo = 20000, nombre = expr, cada = 150 } = {}) {
  const fin = Date.now() + tiempo;
  while (Date.now() < fin) {
    try {
      if (await js(ses, `!!(${expr})`)) return true;
    } catch {}
    await dormir(cada);
  }
  throw new Error(`Timeout esperando: ${nombre}`);
}

/** Lee el riel visible (el de escritorio). */
const leerRiel = `(() => {
  const nav = [...document.querySelectorAll('nav[aria-label]')].find((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!nav) return null;
  const botones = [...nav.querySelectorAll("button")];
  return {
    nombre: nav.getAttribute("aria-label"),
    textos: botones.map((b) => b.innerText.trim()),
    altos: botones.map((b) => Math.round(b.getBoundingClientRect().height)),
    activo: botones.findIndex((b) => b.getAttribute("aria-current") === "page"),
    doc: Math.round(document.documentElement.scrollWidth - window.innerWidth),
  };
})()`;

/** Qué pantalla está visible. */
const leerVista = `(() => {
  const visibles = [...document.querySelectorAll("[data-vista]")]
    .filter((d) => d.getAttribute("aria-hidden") !== "true")
    .map((d) => d.getAttribute("data-vista"));
  return visibles[0] ?? null;
})()`;

const clicBoton = async (ses, texto) => {
  const hecho = await js(
    ses,
    `(() => {
      const nav = [...document.querySelectorAll('nav[aria-label]')].find((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!nav) return false;
      const b = [...nav.querySelectorAll("button")].find((x) => x.innerText.trim().toLowerCase() === ${JSON.stringify(
        texto.toLowerCase(),
      )});
      if (!b) return false;
      b.click();
      return true;
    })()`,
  );
  if (!hecho) throw new Error(`no encontré el botón «${texto}»`);
  await dormir(700);
};

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });

try {
  // ── Escritorio: el riel completo ────────────────────────────────────────
  const grande = await nuevaSesion(browser, { w: 1200, h: 900, dpr: 1 });
  console.log(`${BASE} · navegación de vistas\n\n— escritorio 1200×900 —`);
  await grande.ev("Page.navigate", { url: BASE });
  await esperar(grande, `document.querySelector("[data-vista]")`, { nombre: "el shell montó" });
  await dormir(900);

  const riel = await js(grande, leerRiel);
  console.log("riel:", JSON.stringify(riel));
  check("el riel existe y tiene nombre accesible", Boolean(riel?.nombre), String(riel?.nombre));
  check(
    "entra la navegación completa (4 vistas)",
    (riel?.textos ?? []).filter((t) => t.length > 0).length === VISTAS.length,
    JSON.stringify(riel?.textos),
  );
  check(
    "cada destino tiene 40 px de alto o más",
    (riel?.altos ?? []).every((h) => h >= 40),
    JSON.stringify(riel?.altos),
  );
  check("la fila no desborda la página a lo ancho", (riel?.doc ?? 99) <= 1, `sobra=${riel?.doc}px`);
  check("arranca en Inicio y lo anuncia", (await js(grande, leerVista)) === "inicio" && riel?.activo === 0);

  for (const [i, vista] of VISTAS.entries()) {
    if (i === 0) continue;
    const etiqueta = (riel?.textos ?? [])[i];
    await clicBoton(grande, etiqueta);
    const visible = await js(grande, leerVista);
    const tras = await js(grande, leerRiel);
    check(
      `«${etiqueta}» abre la pantalla ${vista} y la anuncia`,
      visible === vista && tras?.activo === i,
      `visible=${visible} activo=${tras?.activo}`,
    );
  }

  // La pantalla anterior no tiene que quedar enfocable.
  const inicioInerte = await js(
    grande,
    `document.querySelector('[data-vista="inicio"]')?.hasAttribute("inert") === true`,
  );
  check("la pantalla que no se ve queda inerte", inicioInerte);
  await grande.cerrar().catch(() => {});

  // ── Celular: el riel se esconde y manda el menú ─────────────────────────
  console.log("\n— celular 360×640 —");
  const chico = await nuevaSesion(browser, { w: 360, h: 640, dpr: 2, movil: true });
  await chico.ev("Page.navigate", { url: BASE });
  await esperar(chico, `document.querySelector("[data-vista]")`, { nombre: "el shell montó" });
  await dormir(900);

  const rielMovil = await js(chico, leerRiel);
  check("en celular el riel de escritorio no se ve", rielMovil === null, JSON.stringify(rielMovil));
  check(
    "la página no desborda a lo ancho",
    (await js(chico, `Math.round(document.documentElement.scrollWidth - window.innerWidth)`)) <= 1,
  );

  const abrir = `(() => {
    const b = document.querySelector('header button[aria-expanded]');
    if (!b) return false;
    if (b.getAttribute("aria-expanded") === "true") return true;
    b.click();
    return true;
  })()`;
  await js(chico, abrir);
  await esperar(chico, `[...document.querySelectorAll('nav[aria-label]')].some((n) => n.offsetHeight > 0)`, {
    nombre: "el menú móvil se abrió",
  });
  const menu = await js(chico, leerRiel);
  console.log("menú móvil:", JSON.stringify(menu));
  check("el menú trae las cuatro vistas", (menu?.textos ?? []).length >= VISTAS.length, JSON.stringify(menu?.textos));
  check(
    "cada destino del menú mide 44 px o más (dedo, no puntero)",
    (menu?.altos ?? []).every((h) => h >= 44),
    JSON.stringify(menu?.altos),
  );

  const etiquetaPlanes = menu?.textos?.[VISTAS.indexOf("planes")] ?? "Planes";
  await clicBoton(chico, etiquetaPlanes);
  await dormir(400);
  const expanded = await js(chico, `document.querySelector('header button[aria-expanded]')?.getAttribute("aria-expanded")`);
  check("al elegir una vista el menú se cierra", expanded === "false", `aria-expanded=${expanded}`);
  check("y la pantalla cambia a Planes", (await js(chico, leerVista)) === "planes");
  check(
    "sigue sin desbordar después de navegar",
    (await js(chico, `Math.round(document.documentElement.scrollWidth - window.innerWidth)`)) <= 1,
  );
  await chico.cerrar().catch(() => {});

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await cerrar();
}
