#!/usr/bin/env node
/**
 * Verifica /admin donde corre de verdad: el Worker de Cloudflare Pages (build
 * de producción en `wrangler pages dev`), no el dev server de Vite.
 *
 * Levanta wrangler con un `.dev.vars` temporal apuntando al repo de PRUEBA,
 * comprueba acceso, token, pestañas, el ancho de un celular y el registro del
 * service worker (la PWA sólo se registra en producción). Al terminar borra el
 * `.dev.vars` que armó.
 *
 * Necesita `pnpm build` hecho y un `.env` con el token del repo de datos.
 *
 *   pnpm build
 *   node scripts/verificar-worker.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ADMIN_CLAVE,
  ADMIN_CORREO,
  dormir,
  entornoPrueba,
  liberarPuerto,
  raiz,
} from "./pruebas/entorno.mjs";
import { abrirChrome, aplicarViewport, js, nuevaSesion } from "./capturas/lib/cdp.mjs";

const PUERTO = 8788;
// wrangler escucha en 127.0.0.1: con «localhost» Node puede intentar ::1 y no
// conecta nunca (Chrome sí, por eso el navegador andaba y el chequeo no).
const BASE = `http://127.0.0.1:${PUERTO}`;
const DIST = path.join(raiz, "dist", "client");
const DEV_VARS = path.join(raiz, ".dev.vars");

const fallos = [];
const chequear = (ok, texto, extra) => {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
};

if (!fs.existsSync(path.join(DIST, "_worker.js"))) {
  console.error("Falta el build. Corré `pnpm build` primero.");
  process.exit(1);
}

/* Variables del Worker: el repo de prueba, el correo apagado y la clave de la
   prueba. `.dev.vars` está en .gitignore y se borra al final. */
const env = entornoPrueba();
fs.writeFileSync(
  DEV_VARS,
  [
    `BITLY_DATA_REPO=${env.BITLY_DATA_REPO}`,
    `BITLY_DATA_TOKEN=${env.BITLY_CODES_TOKEN ?? ""}`,
    `BITLY_CODES_TOKEN=${env.BITLY_CODES_TOKEN ?? ""}`,
    `BITLY_DATA_SECRET=${env.BITLY_DATA_SECRET ?? ""}`,
    `BITLY_SESSION_SECRET=secreto-de-sesion-de-prueba-2026`,
    `BITLY_ADMIN_EMAIL=${ADMIN_CORREO}`,
    `BITLY_ADMIN_CLAVE=${ADMIN_CLAVE}`,
    `BITLY_ADMIN_SECRET=secreto-prueba-panel-2026`,
    `BITLY_EMAIL_WEBHOOK=`,
    `RESEND_API_KEY=`,
    `BITLY_SMTP_HOST=`,
  ].join("\n") + "\n",
);

// Si quedó un wrangler de una corrida anterior, la prueba hablaría con ese
// proceso (otro build, otra clave) en vez de con el nuevo.
await liberarPuerto(PUERTO);

const wrangler = spawn(
  "npx",
  [
    "--yes",
    "wrangler",
    "pages",
    "dev",
    DIST,
    "--port",
    String(PUERTO),
    "--compatibility-date",
    "2026-05-16",
    "--compatibility-flags",
    "nodejs_compat",
  ],
  { cwd: raiz, stdio: ["ignore", "pipe", "pipe"], shell: true },
);
const log = [];
wrangler.stdout?.on("data", (t) => log.push(String(t)));
wrangler.stderr?.on("data", (t) => log.push(String(t)));

const HELPERS = `
  window.__t = {
    tab: (txt) => [...document.querySelectorAll('[role=tab]')]
      .find((b) => b.textContent.trim().toLowerCase() === txt.toLowerCase()),
    aria: (txt) => [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes(txt.toLowerCase())),
    escribir: (el, valor) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      d.set.call(el, valor);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
`;

let ses;
let chrome;
async function esperarTexto(texto, ms = 25000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(ses, `(document.body?.innerText ?? '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())})`)) return true;
    await dormir(250);
  }
  return false;
}

async function entrar(clave) {
  return js(
    ses,
    `(() => {
      const [c, k] = [...document.querySelectorAll('form input')];
      if (!c || !k) return false;
      __t.escribir(c, ${JSON.stringify(ADMIN_CORREO)});
      __t.escribir(k, ${JSON.stringify(clave)});
      c.form.requestSubmit();
      return true;
    })()`,
  );
}

/** Nada debe salirse del ancho visible (móvil). */
async function desborde() {
  return js(
    ses,
    `(() => {
      const w = document.documentElement.clientWidth;
      const ancho = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const fuera = [...document.querySelectorAll('body *')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; })
        .slice(0, 5)
        .map((e) => e.tagName + '.' + String(e.className || '').split(' ').slice(0, 2).join('.'));
      return { w, ancho, fuera };
    })()`,
  );
}

async function listo() {
  const fin = Date.now() + 90_000;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok || r.status === 308) return true;
    } catch {}
    await dormir(600);
  }
  return false;
}

async function cerrarWrangler() {
  if (wrangler.pid) {
    await new Promise((ok) => {
      const tarea = spawn("taskkill", ["/PID", String(wrangler.pid), "/T", "/F"], { stdio: "ignore" });
      tarea.on("exit", ok);
      tarea.on("error", ok);
    });
    await dormir(600);
  }
  // workerd a veces sobrevive al árbol: se apaga por puerto para no dejar el
  // próximo intento hablando con este build.
  await liberarPuerto(PUERTO);
}

try {
  console.log("— Levanta el Worker —");
  const arriba = await listo();
  chequear(arriba, `wrangler responde en ${BASE}`);
  if (!arriba) {
    console.error(log.join("").slice(-1200));
    throw new Error("wrangler no arrancó");
  }

  chrome = await abrirChrome({
    puerto: 9345,
    perfil: path.join(raiz, "scripts/.cache/perfil-verificar-worker"),
  });
  ses = await nuevaSesion(chrome.browser, { w: 1360, h: 950, dpr: 1 });

  console.log("\n— Acceso en el Worker —");
  await ses.ev("Page.navigate", { url: `${BASE}/admin` });
  await dormir(3000);
  chequear(await esperarTexto("Panel del dueño"), "el Worker sirve la página del panel");
  await js(ses, HELPERS);
  chequear(
    (await js(ses, `document.querySelector('meta[name=robots]')?.content ?? ''`)).includes("noindex"),
    "la página del panel es noindex",
  );

  await entrar("clave-equivocada");
  chequear(await esperarTexto("Correo o clave incorrectos", 20000), "rechaza una clave equivocada");
  chequear(
    !(await js(ses, `Boolean(localStorage.getItem('bitly_admin_token'))`)),
    "no guarda token con la clave equivocada",
  );

  await js(ses, HELPERS);
  await entrar(ADMIN_CLAVE);
  chequear(await esperarTexto("Panel Bitly"), "con la clave correcta entra al panel");
  chequear(await esperarTexto("Ingresos del mes"), "el resumen se calcula en el Worker");
  const token = await js(ses, `localStorage.getItem('bitly_admin_token')`);
  chequear(typeof token === "string" && token.split(".").length === 2, "el token firmado llega y se guarda");
  chequear(
    !(await js(ses, `JSON.stringify(localStorage).includes(${JSON.stringify(ADMIN_CLAVE)})`)),
    "la clave no queda guardada",
  );

  await js(ses, HELPERS);
  await js(ses, `__t.tab('Pedidos')?.click()`);
  chequear(await esperarTexto("Correo sin configurar", 25000), "la pestaña Pedidos carga sus datos");
  chequear(!(await js(ses, `document.body.innerText.includes('No pudimos cargar')`)), "Pedidos no da error");

  await js(ses, HELPERS);
  await js(ses, `__t.tab('Usuarios')?.click()`);
  await dormir(3000);
  chequear(!(await js(ses, `document.body.innerText.includes('No pudimos')`)), "Usuarios no da error");

  console.log("\n— PWA (producción) —");
  const sw = await js(
    ses,
    `navigator.serviceWorker.ready.then((r) => r.active?.scriptURL ?? 'sin activo').catch((e) => 'ERR ' + e.message)`,
  );
  chequear(String(sw).includes("/sw.js"), "el service worker se registra sobre /", sw);

  console.log("\n— Móvil (390×844) —");
  await aplicarViewport(ses, { w: 390, h: 844, dpr: 2, movil: true });
  await ses.ev("Page.navigate", { url: `${BASE}/admin` });
  await dormir(3500);
  chequear(await esperarTexto("Panel Bitly", 25000), "en el celular sigue la sesión abierta");
  await js(ses, HELPERS);

  const anchoMovil = await desborde();
  chequear(anchoMovil.ancho <= anchoMovil.w + 1, "el panel no se desborda a lo ancho", JSON.stringify(anchoMovil));

  const tabs = await js(ses, `[...document.querySelectorAll('[role=tab]')].map((b) => b.textContent.trim())`);
  chequear(
    ["Resumen", "Pedidos", "Usuarios", "Egresos"].every((t) => tabs.includes(t)),
    "las cuatro pestañas están en el celular",
  );
  chequear(
    await js(ses, `[...document.querySelectorAll('[role=tab]')].every((b) => b.getBoundingClientRect().height >= 28)`),
    "las pestañas se pueden tocar (alto de 28 px o más)",
  );

  await js(ses, `__t.tab('Pedidos')?.click()`);
  await dormir(3000);
  chequear(!(await js(ses, `document.body.innerText.includes('No pudimos cargar')`)), "Pedidos carga en el celular");
  const anchoPedidos = await desborde();
  chequear(
    anchoPedidos.ancho <= anchoPedidos.w + 1,
    "la lista de pedidos no se desborda en el celular",
    JSON.stringify(anchoPedidos),
  );

  console.log("\n— Salir —");
  await js(ses, HELPERS);
  await js(ses, `__t.aria('Cerrar sesión del panel')?.click()`);
  chequear(await esperarTexto("Panel del dueño", 15000), "salir vuelve al acceso");
  chequear(
    !(await js(ses, `Boolean(localStorage.getItem('bitly_admin_token'))`)),
    "salir borra el token",
  );
  const anchoAcceso = await desborde();
  chequear(anchoAcceso.ancho <= anchoAcceso.w + 1, "el acceso entra en el celular", JSON.stringify(anchoAcceso));

  const errores = await js(ses, `window.__errores ?? []`);
  chequear(errores.length === 0, "sin errores de página", errores.join(" | "));
} catch (e) {
  console.error("\nERROR:", e.message);
  fallos.push("excepción: " + e.message);
  try {
    console.log("  pantalla:", String(await js(ses, "document.body.innerText")).slice(0, 600).split("\n").join(" | "));
    console.log("  errores:", (await js(ses, `window.__errores ?? []`)).join(" | "));
  } catch {}
} finally {
  await ses?.cerrar().catch(() => undefined);
  await chrome?.cerrar().catch(() => undefined);
  await cerrarWrangler();
  fs.rmSync(DEV_VARS, { force: true });
}

console.log(`\n${fallos.length === 0 ? "TODO OK" : `${fallos.length} fallas`}`);
if (fallos.length > 0) process.exit(1);
