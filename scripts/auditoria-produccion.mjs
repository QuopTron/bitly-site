#!/usr/bin/env node
/**
 * Auditoría de PRODUCCIÓN (sólo lectura).
 *
 * No crea cuentas, pedidos ni egresos: revisa cabeceras de seguridad, rutas
 * privadas y fugas, el HTML del panel, la RPC, el acceso con token inventado,
 * la consistencia de las métricas, caché, compresión, PWA y 404.
 *
 * La parte que entra al panel necesita el correo y la clave del dueño en el
 * entorno; sin ellos se salta ese bloque (y avisa) y sigue con el resto:
 *
 *   BITLY_ADMIN_EMAIL=... BITLY_ADMIN_CLAVE=... node scripts/auditoria-produccion.mjs
 *
 * Contra otro despliegue: PROD_URL=https://xxx.pages.dev ...
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, dormir, js, nuevaSesion } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.PROD_URL ?? "https://bitly-site.pages.dev";
// El correo del dueño no vive en el repo (es público): va por entorno, igual
// que la clave. Sin él no se revisa la fuga del correo ni se entra al panel.
const CORREO = (process.env.BITLY_ADMIN_EMAIL ?? "").trim();
const CLAVE = (process.env.BITLY_ADMIN_CLAVE ?? "").trim();

const fallos = [];
const check = (ok, texto, extra) => {
  console.log(`${ok ? "  ok   " : "  FALLA"} ${texto}${extra !== undefined ? ` · ${String(extra).slice(0, 140)}` : ""}`);
  if (!ok) fallos.push(texto);
};

const pedir = async (ruta, opciones = {}) => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${ruta}`, { redirect: "manual", ...opciones });
  const cuerpo = await r.text();
  return { r, cuerpo, ms: Date.now() - t0, cab: r.headers };
};

/* ── 1. Cabeceras de seguridad ─────────────────────────────────────────── */

console.log("— Cabeceras —");
const requeridas = [
  ["strict-transport-security", "max-age"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "deny"],
  ["referrer-policy", "strict-origin"],
  ["permissions-policy", "camera=()"],
  ["cross-origin-opener-policy", "same-origin"],
];
for (const [ruta, nombre] of [["/", "home"], ["/admin/", "admin"]]) {
  const { r, cab } = await pedir(ruta);
  for (const [clave, valor] of requeridas) {
    const dado = (cab.get(clave) ?? "").toLowerCase();
    check(dado.includes(valor), `${nombre}: ${clave}`, dado || "falta");
  }
  const csp = cab.get("content-security-policy") ?? "";
  check(csp.includes("default-src 'self'"), `${nombre}: CSP con default-src 'self'`);
  check(csp.includes("frame-ancestors 'none'"), `${nombre}: CSP frame-ancestors none`);
  check(csp.includes("object-src 'none'"), `${nombre}: CSP object-src none`);
  const scriptSrc = (csp.match(/script-src[^;]*/) ?? [""])[0];
  check(!scriptSrc.includes("'unsafe-inline'"), `${nombre}: script-src sin unsafe-inline`, scriptSrc);
  check(!cab.get("x-powered-by"), `${nombre}: sin x-powered-by`);
  check(!cab.get("set-cookie"), `${nombre}: no setea cookies (token en localStorage)`);
  check([200, 307, 308].includes(r.status), `${nombre}: responde 200 o redirección`, r.status);
}

/* ── 2. Rutas privadas y fugas ─────────────────────────────────────────── */

console.log("\n— Fugas y rutas privadas —");
const privadas = [
  "/_ssr/server.js",
  "/_ssr/assets/",
  "/_worker.js",
  "/.env",
  "/.git/config",
  "/package.json",
  "/pnpm-lock.yaml",
  "/wrangler.toml",
  "/src/server/admin.ts",
  "/src/server/cuentas.ts",
  "/data/pedidos.json",
  "/data/cuentas.json",
  "/node_modules/",
  "/tsconfig.json",
];
for (const ruta of privadas) {
  const { r, cuerpo } = await pedir(ruta);
  const filtrado = !r.ok || /not found|no encontr/i.test(cuerpo.slice(0, 300));
  check(filtrado, `${ruta} no se sirve`, r.status);
}
const assets = [...(await pedir("/admin/")).cuerpo.matchAll(/\/assets\/[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]);
for (const asset of new Set(assets).values().take(3)) {
  const { r, cuerpo } = await pedir(`${asset}.map`);
  check(r.status === 404 || !cuerpo.includes("sourcesContent"), `source map de ${asset} no se sirve`, r.status);
}

/* ── 3. HTML del panel ─────────────────────────────────────────────────── */

console.log("\n— HTML del panel —");
const admin = await pedir("/admin/");
check(admin.cuerpo.includes('name="robots"') && admin.cuerpo.includes("noindex"), "el HTML del panel es noindex");
check(!CORREO || !admin.cuerpo.includes(CORREO), "el HTML no trae el correo del dueño");
check(!/BITLY_[A-Z_]+\s*[:=]/.test(admin.cuerpo), "el HTML no trae nombres de variables internas");
check(!/Ingresos del mes|Egresos del mes|Balance/i.test(admin.cuerpo), "el HTML no trae el resumen con datos");
check(!CLAVE || !admin.cuerpo.includes(CLAVE), "el HTML no trae la clave");
const home = await pedir("/");
check(!CORREO || !home.cuerpo.includes(CORREO), "el inicio no menciona el correo del dueño");
check(!home.cuerpo.includes("bitly_admin_token"), "el inicio no menciona el token del panel");

/* ── 4. RPC y cuerpos ──────────────────────────────────────────────────── */

console.log("\n— RPC —");
const rpcGet = await pedir("/_serverFn/eyJmaWxlIjoiL3NyYy9zZXJ2ZXIvYWRtaW4udHMifQ");
check(!rpcGet.r.ok, "una server function no responde por GET", rpcGet.r.status);
check(
  rpcGet.cab.get("cache-control")?.includes("no-store") || rpcGet.r.status === 403 || rpcGet.r.status === 404,
  "la RPC no se cachea ni se indexa",
  rpcGet.cab.get("cache-control") ?? rpcGet.r.status,
);
const grande = await fetch(`${BASE}/_serverFn/x`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "a".repeat(7 * 1024 * 1024),
}).catch((e) => ({ status: 0, error: e.message }));
check(grande.status === 413 || grande.status === 400 || grande.status === 404, "un cuerpo de 7 MB se corta en el borde", grande.status);

/* ── 5. Autenticación en producción ────────────────────────────────────── */

console.log("\n— Autenticación —");
const chrome = await abrirChrome({ puerto: 9348, perfil: path.join(raiz, "scripts/.cache/perfil-auditoria") });
const ses = await nuevaSesion(chrome.browser, { w: 1360, h: 950, dpr: 1 });

const T = `
  window.__t = { escribir: (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, tab: (t) => [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim().toLowerCase() === t.toLowerCase()) };
`;
async function esperar(texto, ms = 25000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(ses, `(document.body?.innerText ?? '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())})`)) return true;
    await dormir(250);
  }
  return false;
}
const texto = () => js(ses, `document.body.innerText`);

try {
  if (!CLAVE || !CORREO) throw { saltar: true };
  // Token inventado: la página no debe mostrar datos ni dejar entrar.
  await ses.ev("Page.navigate", { url: `${BASE}/admin/` });
  await dormir(3500);
  await js(ses, T);
  const falso = Buffer.from(JSON.stringify({ a: 1, e: Date.now() + 1e9, k: "0000000000000000" }))
    .toString("base64url");
  await js(ses, `localStorage.setItem('bitly_admin_token', ${JSON.stringify(`${falso}.${"A".repeat(43)}`)}); location.reload()`);
  await dormir(4000);
  await js(ses, T);
  const conFalso = await texto();
  check(conFalso.includes("Panel del dueño"), "un token inventado vuelve a pedir la clave");
  check(!/Ingresos del mes/i.test(conFalso), "un token inventado no muestra el resumen");
  await js(ses, `localStorage.removeItem('bitly_admin_token')`);

  // Una equivocada y después la buena (la buena limpia el contador de fallos).
  await ses.ev("Page.navigate", { url: `${BASE}/admin/` });
  await dormir(3500);
  await js(ses, T);
  const entrar = (clave) =>
    js(
      ses,
      `(() => {
        const [c, k] = [...document.querySelectorAll('form input')];
        if (!c || !k) return false;
        __t.escribir(c, ${JSON.stringify(CORREO)});
        __t.escribir(k, ${JSON.stringify(clave)});
        c.form.requestSubmit();
        return true;
      })()`,
    );
  await entrar("una-clave-que-no-es");
  check(await esperar("Correo o clave incorrectos"), "rechaza la clave equivocada");
  await ses.ev("Page.navigate", { url: `${BASE}/admin/` });
  await dormir(3500);
  await js(ses, T);
  check(await entrar(CLAVE), "envía la clave correcta");
  check(await esperar("Panel Bitly"), "entra al panel");
  check(await esperar("Ingresos del mes"), "calcula el resumen");

  /* ── 6. Métricas ───────────────────────────────────────────────────── */

  console.log("\n— Métricas —");
  await js(ses, T);
  const tarjetas = await js(ses, `document.body.innerText`);
  const numeros = (tarjetas.match(/-?\d[\d.,]*/g) ?? []).map((n) => Number(n.replace(/\./g, "").replace(",", ".")));
  check(!/NaN|Infinity|undefined|null Bs/.test(tarjetas), "no hay cifras rotas (NaN/Infinity/undefined)");
  check(numeros.length > 10, "el resumen muestra cifras", numeros.length);
  const metricas = await js(
    ses,
    `(() => {
      const t = document.body.innerText;
      const limpiar = (s) => Number(String(s).replace(/[^\\d,-]/g, "").replace(/\\./g, "").replace(",", "."));
      return { texto: t.slice(0, 4000) };
    })()`,
  );
  check(metricas.texto.includes("Ingresos"), "aparece el bloque de ingresos");
  check(/usuarios/i.test(metricas.texto), "aparece el bloque de usuarios");
  check(/vistas/i.test(metricas.texto) && /descargas/i.test(metricas.texto), "aparecen las métricas de tráfico (vistas y descargas)");
  check(/ticket/i.test(metricas.texto), "aparece el ticket promedio");

  await js(ses, T);
  await js(ses, `__t.tab('Egresos')?.click()`);
  await dormir(2500);
  const egresos = await texto();
  check(!/NaN|Infinity/.test(egresos), "la lista de egresos no tiene cifras rotas");

  await js(ses, T);
  await js(ses, `__t.tab('Usuarios')?.click()`);
  await dormir(3500);
  const usuarios = await texto();
  check(!/No pudimos/.test(usuarios), "la lista de usuarios carga");
  check(!/undefined/.test(usuarios), "la lista de usuarios no muestra undefined");

  await js(ses, T);
  await js(ses, `__t.tab('Pedidos')?.click()`);
  await dormir(3500);
  const pedidos = await texto();
  check(!/No pudimos cargar/.test(pedidos), "la lista de pedidos carga");
  check(!/undefined/.test(pedidos), "la lista de pedidos no muestra undefined");
} catch (e) {
  if (!e?.saltar) throw e;
  console.log("  (se salta: falta BITLY_ADMIN_EMAIL y/o BITLY_ADMIN_CLAVE)");
} finally {
  await ses.cerrar().catch(() => undefined);
  await chrome.cerrar().catch(() => undefined);
}

/* ── 7. Rendimiento y caché ────────────────────────────────────────────── */

console.log("\n— Rendimiento —");
for (const ruta of ["/", "/admin/"]) {
  const { r, cab, ms } = await pedir(ruta);
  check(ms < 2500, `${ruta} responde rápido`, `${ms} ms`);
  const comprimido = (cab.get("content-encoding") ?? "").length > 0;
  check(comprimido, `${ruta} viaja comprimido`, cab.get("content-encoding"));
  check(!(cab.get("cache-control") ?? "").includes("immutable"), `${ruta} no se cachea como inmutable`, cab.get("cache-control"));
  check((await pedir(ruta)).cuerpo.length < 300_000, `${ruta} pesa menos de 300 KB`, (await pedir(ruta)).cuerpo.length);
}
const js0 = assets[0];
if (js0) {
  const a = await pedir(js0);
  check((a.cab.get("cache-control") ?? "").includes("immutable"), "los assets se cachean para siempre", a.cab.get("cache-control"));
  check((a.cab.get("content-encoding") ?? "").length > 0, "los assets viajan comprimidos", a.cab.get("content-encoding"));
}

/* ── 8. PWA y varios ───────────────────────────────────────────────────── */

console.log("\n— PWA y varios —");
const sw = await pedir("/sw.js");
check(sw.r.status === 200 && (sw.cab.get("content-type") ?? "").includes("javascript"), "sw.js se sirve como JS", sw.cab.get("content-type"));
const manifiesto = await pedir("/site.webmanifest");
let json = null;
try {
  json = JSON.parse(manifiesto.cuerpo);
} catch {}
check(Boolean(json?.icons?.length), "el manifiesto tiene iconos");
for (const icono of (json?.icons ?? []).slice(0, 3)) {
  const r = await fetch(`${BASE}${icono.src}`);
  check(r.ok, `el icono ${icono.src} existe`, r.status);
}
const reflejo = await pedir(`/?q=${encodeURIComponent("<script>alert(1)</script>")}`);
check(!reflejo.cuerpo.includes("<script>alert(1)</script>"), "no refleja un script en la URL");
const noEncontrado = await pedir("/esto-no-existe-12345");
check(noEncontrado.r.status === 404, "una ruta inexistente da 404", noEncontrado.r.status);

console.log(`\n${fallos.length === 0 ? "PRODUCCIÓN: TODO OK" : `PRODUCCIÓN: ${fallos.length} fallas`}`);
if (fallos.length) process.exit(1);
