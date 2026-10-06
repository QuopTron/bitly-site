#!/usr/bin/env node
/**
 * Verifica el navbar de secciones EN EL NAVEGADOR, en pantalla de celular.
 *
 * Lo que importa acá no es que los links existan, sino que sirvan en gama baja:
 * que la fila no desborde a lo ancho, que cada destino tenga 44 px de alto (dedo,
 * no puntero), que al tocar una sección la página salte sin que el propio navbar
 * tape el título, y que la sección activa se anuncie sola.
 *
 *   pnpm dev
 *   DEMO_URL=http://localhost:3100 node scripts/verificar-nav.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9349);
const PERFIL = path.join(raiz, ".capturas-perfil-nav");

const ESPERADOS = ["#inicio", "#demo", "#instalar", "#opiniones", "#planes", "#contacto"];

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

/**
 * Espera a que el scroll se detenga de verdad.
 *
 * El salto a un ancla es suave y Chrome lo estira según la distancia: un
 * `dormir` fijo mide a mitad de camino y da un falso negativo.
 */
async function esperarQuieto(ses, tiempo = 9000) {
  const fin = Date.now() + tiempo;
  let previo = -1;
  let iguales = 0;
  while (Date.now() < fin) {
    const y = await js(ses, `Math.round(window.scrollY)`);
    if (y === previo) {
      if (++iguales >= 2) return y;
    } else {
      iguales = 0;
    }
    previo = y;
    await dormir(300);
  }
  return previo;
}

const leerNav = `(() => {
  const nav = document.querySelector('nav[aria-label]');
  if (!nav) return null;
  const r = nav.getBoundingClientRect();
  const links = [...nav.querySelectorAll("a[href^='#']")];
  return {
    nombre: nav.getAttribute("aria-label"),
    pegado: Math.round(r.top),
    alto: Math.round(r.height),
    hrefs: links.map((a) => a.getAttribute("href")),
    altos: links.map((a) => Math.round(a.getBoundingClientRect().height)),
    activo: links.find((a) => a.getAttribute("aria-current"))?.getAttribute("href") ?? null,
    doc: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
const ses = await nuevaSesion(browser, { w: 360, h: 640, dpr: 2, movil: true });

try {
  console.log(`${BASE} · navbar de secciones (360×640)\n`);
  await ses.ev("Page.navigate", { url: BASE });
  await esperar(ses, `document.querySelector("nav[aria-label]")`, { nombre: "el navbar montó" });
  await dormir(800);

  // ── 1. Estructura ──
  const nav = await js(ses, leerNav);
  console.log("navbar:", JSON.stringify(nav));
  check("el navbar existe y tiene nombre accesible", nav !== null && (nav.nombre ?? "").length > 0, String(nav?.nombre));
  check("lleva a todas las secciones", JSON.stringify(nav?.hrefs) === JSON.stringify(ESPERADOS), JSON.stringify(nav?.hrefs));
  check(
    "cada destino tiene 44 px de alto o más",
    (nav?.altos ?? []).every((h) => h >= 44),
    JSON.stringify(nav?.altos),
  );
  check("la fila no desborda la página a lo ancho", (nav?.doc ?? 99) <= 1, `sobra=${nav?.doc}px`);

  // ── 2. Salta a la sección sin que el navbar tape el título ──
  await js(
    ses,
    `document.querySelector('nav[aria-label] a[href="#opiniones"]').click()`,
  );
  await esperarQuieto(ses);
  const salto = await js(
    ses,
    `(() => {
      const nav = document.querySelector("nav[aria-label]").getBoundingClientRect();
      const s = document.querySelector("#opiniones").getBoundingClientRect();
      return { navAbajo: Math.round(nav.bottom), seccionArriba: Math.round(s.top), y: Math.round(window.scrollY) };
    })()`,
  );
  console.log("salto a opiniones:", JSON.stringify(salto));
  check("la página se movió", (salto?.y ?? 0) > 100, `y=${salto?.y}`);
  check(
    "el título queda justo debajo del navbar, no tapado ni lejos",
    (salto?.seccionArriba ?? 0) >= (salto?.navAbajo ?? 99) - 2 &&
      (salto?.seccionArriba ?? 9999) <= (salto?.navAbajo ?? 0) + 40,
    `sección=${salto?.seccionArriba} nav=${salto?.navAbajo}`,
  );

  // ── 3. El navbar queda pegado y anuncia la sección activa ──
  const pegado = await js(ses, leerNav);
  console.log("pegado:", JSON.stringify(pegado));
  check("el navbar queda pegado arriba", Math.abs(pegado?.pegado ?? 99) <= 1, `top=${pegado?.pegado}`);
  check(
    "anuncia la sección activa",
    pegado?.activo === "#opiniones",
    `activo=${pegado?.activo}`,
  );

  // ── 4. Cambiar de sección actualiza el anuncio ──
  await js(ses, `document.querySelector('nav[aria-label] a[href="#planes"]').click()`);
  await esperarQuieto(ses);
  const tras = await js(ses, leerNav);
  check("al saltar a otra sección, el anuncio cambia", tras?.activo === "#planes", `activo=${tras?.activo}`);

  // ── 5. "Inicio" vuelve al principio de verdad ──
  // Antes apuntaba a los botones de descarga: caía en el medio del hero y
  // dejaba el título cortado arriba. Ahora apunta al encabezado, así que tiene
  // que terminar en el tope exacto de la página.
  await js(ses, `document.querySelector('nav[aria-label] a[href="#inicio"]').click()`);
  await esperarQuieto(ses);
  const volvio = await js(ses, `Math.round(window.scrollY)`);
  const navInicio = await js(ses, leerNav);
  console.log("volver arriba:", JSON.stringify({ y: volvio, activo: navInicio?.activo }));
  check("Inicio vuelve al tope de la página", volvio === 0, `y=${volvio}`);
  check("y queda marcada la sección Inicio", navInicio?.activo === "#inicio", `activo=${navInicio?.activo}`);

  // ── 6. "Contacto" llega al pie, que antes no existía como destino ──
  await js(ses, `document.querySelector('nav[aria-label] a[href="#contacto"]').click()`);
  await esperarQuieto(ses);
  const pie = await js(
    ses,
    `(() => {
      const f = document.querySelector("#contacto");
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { top: Math.round(r.top), alto: Math.round(r.height), visible: r.top < window.innerHeight && r.bottom > 0 };
    })()`,
  );
  const navPie = await js(ses, leerNav);
  console.log("contacto:", JSON.stringify({ pie: pie?.top, activo: navPie?.activo }));
  check("el pie existe y trae el contacto", (pie?.alto ?? 0) > 100, `alto=${pie?.alto}`);
  check("Contacto deja el pie a la vista", pie?.visible === true, `top=${pie?.top}`);
  check("y queda marcada la sección Contacto", navPie?.activo === "#contacto", `activo=${navPie?.activo}`);

  // ── 7. En escritorio entra completa y centrada ──
  await ses.ev("Emulation.setDeviceMetricsOverride", {
    width: 1200, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await dormir(500);
  const grande = await js(ses, leerNav);
  console.log("escritorio:", JSON.stringify(grande));
  check("en escritorio están todas las secciones", JSON.stringify(grande?.hrefs) === JSON.stringify(ESPERADOS));
  check("en escritorio la fila no desborda", (grande?.doc ?? 99) <= 1, `sobra=${grande?.doc}px`);

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await ses.cerrar().catch(() => {});
  await cerrar();
}
