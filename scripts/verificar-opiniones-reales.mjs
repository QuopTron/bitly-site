#!/usr/bin/env node
/**
 * Verifica el flujo REAL de opiniones y vistas contra Supabase.
 *
 * Los `probar-*.mjs` prueban las reglas y el servidor sin base; este hace lo que
 * ninguno puede: abre el sitio en Chrome, publica una opinión de verdad y
 * comprueba que la fila quede en Supabase, que el promedio y el reparto suban, y
 * que el contador de vistas avance. Al terminar borra la fila de prueba, así
 * que se puede correr las veces que haga falta sin ensuciar la tabla.
 *
 * Necesita la migración `supabase-migrations-opiniones.sql` aplicada y la clave
 * secreta para poder limpiar (el público no puede borrar, a propósito).
 *
 *   . ./.env                       # SUPABASE_URL y SUPABASE_SECRET_KEY
 *   DEMO_URL=http://localhost:3100 node scripts/verificar-opiniones-reales.mjs
 *   pnpm dev                       # en otra terminal, si no usás DEMO_URL
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9348);
const PERFIL = path.join(raiz, ".capturas-perfil-opiniones");

const URL_BASE = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const CLAVE_PUBLICA = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const CLAVE_SECRETA = process.env.SUPABASE_SECRET_KEY;

const NOMBRE_PRUEBA = "Prueba Automática";
const TEXTO_PRUEBA = "Opinión de prueba automática: esta fila se borra sola al terminar.";

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

/** Lee el resumen directo de Supabase (lectura pública, sin el sitio de por medio). */
async function resumen() {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/resumen_sitio`, {
    method: "POST",
    headers: {
      apikey: CLAVE_PUBLICA,
      Authorization: `Bearer ${CLAVE_PUBLICA}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const filas = await r.json();
  return Array.isArray(filas) ? filas[0] : null;
}

/** Borra la fila de prueba. La clave secreta salta RLS; el público no puede. */
async function limpiar() {
  if (!CLAVE_SECRETA) return "sin-clave-secreta";
  const r = await fetch(`${URL_BASE}/rest/v1/comentarios?nombre=eq.${encodeURIComponent(NOMBRE_PRUEBA)}`, {
    method: "DELETE",
    headers: {
      apikey: CLAVE_SECRETA,
      Authorization: `Bearer ${CLAVE_SECRETA}`,
      Prefer: "return=representation",
    },
  });
  if (!r.ok) return `error ${r.status}`;
  const borradas = await r.json();
  return `borradas ${Array.isArray(borradas) ? borradas.length : "?"}`;
}

if (!URL_BASE || !CLAVE_PUBLICA) {
  console.error("Faltan SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (¿olvidaste `. ./.env`?).");
  process.exit(1);
}

const antes = await resumen();
if (!antes) {
  console.error(
    "`resumen_sitio` no responde: la migración no está aplicada.\n" +
      "Corré `supabase-migrations-opiniones.sql` en Supabase → SQL Editor.",
  );
  process.exit(1);
}
console.log(`Antes: ${JSON.stringify(antes)}`);

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
const ses = await nuevaSesion(browser, { w: 1100, h: 1000, dpr: 1 });
let creada = false;

try {
  console.log(`${BASE} · flujo real de opiniones\n`);
  await ses.ev("Page.navigate", { url: `${BASE}/#opiniones` });
  await esperar(ses, `document.querySelector("#opiniones form")`, { nombre: "la sección montó" });
  await dormir(1500);

  // ── 1. La base responde y la sección NO dice que está desactivada ──
  const estado = await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      const texto = (s.innerText || "").replace(/\\s+/g, " ").trim();
      const ojo = s.querySelector("svg.lucide-eye");
      return {
        noDisponible: /no están activadas|aren't enabled/i.test(texto),
        vistas: ojo ? ojo.parentElement.innerText.replace(/\\s+/g, " ").trim() : null,
        girando: !!s.querySelector(".animate-spin"),
      };
    })()`,
  );
  console.log("estado:", JSON.stringify(estado));
  check("la sección no dice que esté desactivada", estado?.noDisponible === false);
  check("no queda girando", estado?.girando === false);
  check("el contador de vistas se ve", Boolean(estado?.vistas), String(estado?.vistas));

  const conVista = await resumen();
  check(
    "la visita quedó contada en la base",
    (conVista?.vistas ?? 0) > (antes.vistas ?? 0),
    `${antes.vistas} → ${conVista?.vistas}`,
  );

  // ── 2. Publicar desde el formulario, como lo haría una persona ──
  await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      s.querySelectorAll('[role="radio"]')[4].click();
      const setI = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const nombre = s.querySelector("input");
      setI.call(nombre, ${JSON.stringify(NOMBRE_PRUEBA)});
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
      const setT = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      const texto = s.querySelector("textarea");
      setT.call(texto, ${JSON.stringify(TEXTO_PRUEBA)});
      texto.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  await dormir(300);
  await esperar(ses, `document.querySelector("#opiniones button[type=submit]").disabled === false`, {
    nombre: "el botón se habilita",
  });
  await js(ses, `document.querySelector("#opiniones button[type=submit]").click()`);
  creada = true;

  await esperar(
    ses,
    `(document.querySelector("#opiniones").innerText || "").includes(${JSON.stringify(NOMBRE_PRUEBA)})`,
    { nombre: "la opinión aparece en la lista", tiempo: 20000 },
  );

  // ── 3. Lo que se ve en pantalla ──
  // Las cifras suben contando: hay que dejarlas asentar antes de mirarlas, o
  // se lee un valor intermedio (p. ej. 1 cuando ya son 2) y parece un error.
  const esperado = { vistas: conVista.vistas, opiniones: (antes.opiniones ?? 0) + 1 };
  await esperar(
    ses,
    `(() => {
      const t = (document.querySelector("#opiniones").innerText || "").replace(/\\s+/g, " ");
      return t.includes(${JSON.stringify(`${esperado.vistas} visitas`)})
        && t.includes(${JSON.stringify(`${esperado.opiniones} opiniones`)});
    })()`,
    { nombre: "los contadores se asientan", tiempo: 8000 },
  );

  const despues = await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      const texto = (s.innerText || "").replace(/\\s+/g, " ").trim();
      const ojo = s.querySelector("svg.lucide-eye");
      const reparto = s.querySelector('ul[aria-labelledby="opiniones-reparto"]');
      return {
        texto,
        vistas: ojo ? ojo.parentElement.innerText.replace(/\\s+/g, " ").trim() : null,
        promedio: s.querySelector('[role="img"]')?.parentElement?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
        barras: reparto ? reparto.querySelectorAll("li").length : 0,
        aviso: /Gracias|Thanks/i.test(texto),
      };
    })()`,
  );
  console.log("en pantalla:", JSON.stringify(despues));
  check("la opinión nueva se ve en la lista", despues?.texto?.includes(NOMBRE_PRUEBA) === true);
  check("avisa que se publicó", despues?.aviso === true);
  check("aparece el promedio", Boolean(despues?.promedio), String(despues?.promedio));
  check("se dibuja el reparto de 5 barras", despues?.barras === 5, `barras=${despues?.barras}`);
  check(
    "el contador de vistas muestra el total real",
    despues?.vistas?.includes(String(esperado.vistas)) === true,
    `${despues?.vistas} (esperado ${esperado.vistas})`,
  );
  check(
    "el promedio cuenta la opinión nueva",
    despues?.promedio?.includes(String(esperado.opiniones)) === true,
    `${despues?.promedio} (esperado ${esperado.opiniones})`,
  );

  // ── 4. Lo que quedó guardado de verdad ──
  const fin = await resumen();
  console.log("después (base):", JSON.stringify(fin));
  check(
    "la opinión se guardó en Supabase",
    (fin?.opiniones ?? 0) === (antes.opiniones ?? 0) + 1,
    `${antes.opiniones} → ${fin?.opiniones}`,
  );
  check("el promedio la incluye", Number(fin?.promedio) === 5, `promedio=${fin?.promedio}`);
  check(
    "el reparto sumó la estrella 5",
    (fin?.reparto?.[4] ?? 0) === (antes.reparto?.[4] ?? 0) + 1,
    `${antes.reparto?.[4]} → ${fin?.reparto?.[4]}`,
  );

  // ── 4b. Recargar la misma sesión no vuelve a contar la visita ──
  // El contador guarda una marca por sesión: si esto se rompiera, recargar la
  // página inflaría el número sin parar.
  await ses.ev("Page.navigate", { url: `${BASE}/#opiniones` });
  await esperar(ses, `document.querySelector("#opiniones form")`, { nombre: "la sección volvió a montar" });
  await dormir(2000);
  const trasRecarga = await resumen();
  check(
    "recargar en la misma sesión no infla las visitas",
    (trasRecarga?.vistas ?? -1) === (fin?.vistas ?? 0),
    `${fin?.vistas} → ${trasRecarga?.vistas}`,
  );

  // ── 5. El público sigue sin poder escribir directo ──
  const hackeo = await fetch(`${URL_BASE}/rest/v1/comentarios`, {
    method: "POST",
    headers: {
      apikey: CLAVE_PUBLICA,
      Authorization: `Bearer ${CLAVE_PUBLICA}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nombre: "hack", estrellas: 5, texto: "basura" }),
  });
  check("insertar con la clave pública sigue bloqueado", !hackeo.ok, `status=${hackeo.status}`);

  // ── 6. La visita se cuenta AL ENTRAR, sin la sección de opiniones ──
  // Una pestaña nueva = sesión nueva. Se entra a una ruta que no existe (404):
  // ahí no hay sección de opiniones, así que si el contador sube es porque se
  // dispara al arrancar el sitio (`src/routes/__root.tsx`) y no desde la sección.
  const antes404 = await resumen();
  const ses2 = await nuevaSesion(browser, { w: 900, h: 700, dpr: 1 });
  try {
    await ses2.ev("Page.navigate", { url: `${BASE}/ruta-que-no-existe` });
    await dormir(2500);
  } finally {
    await ses2.cerrar().catch(() => {});
  }
  const tras404 = await resumen();
  check(
    "la visita se cuenta al entrar, aunque no haya sección de opiniones",
    (tras404?.vistas ?? 0) === (antes404?.vistas ?? 0) + 1,
    `${antes404?.vistas} → ${tras404?.vistas}`,
  );

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  await ses.cerrar().catch(() => {});
  await cerrar();
  if (creada) {
    const r = await limpiar().catch((e) => `error ${e.message}`);
    console.log(`\nlimpieza: ${r}`);
  }
}
