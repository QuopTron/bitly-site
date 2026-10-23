#!/usr/bin/env node
/**
 * Verifica el flujo REAL de opiniones y vistas contra GitHub.
 *
 * Los `probar-*.mjs` prueban las reglas y el servidor sin base; este hace lo que
 * ninguno puede: abre el sitio en Chrome, publica una opinión de verdad y
 * comprueba que el archivo quede en el repo, que el promedio y el reparto suban,
 * y que el contador de vistas avance. Al terminar borra la fila de prueba, así
 * que se puede correr las veces que haga falta sin ensuciar el archivo.
 *
 * La base es el repo privado `QuopTron/bitly-data` (Contents API). Hace falta un
 * token con permiso `contents: write` para poder limpiar.
 *
 *   . ./.env                       # BITLY_CODES_TOKEN (o BITLY_DATA_TOKEN)
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

const API = "https://api.github.com";
const REPO = process.env.BITLY_DATA_REPO ?? "QuopTron/bitly-data";
const TOKEN = process.env.BITLY_DATA_TOKEN ?? process.env.BITLY_CODES_TOKEN;
const RAMA = "main";

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

async function gh(ruta, init = {}) {
  const r = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bitly-qa",
      ...(init.headers ?? {}),
    },
  });
  return r;
}

/** Lee un JSON del repo por la Contents API (raw, sin base64). */
async function leerArchivo(ruta, defecto) {
  const r = await gh(`/repos/${REPO}/contents/${ruta}?ref=${RAMA}`, {
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (!r.ok) return defecto;
  try {
    return JSON.parse(await r.text());
  } catch {
    return defecto;
  }
}

/** Escribe un JSON en el repo (create o update), como hace el sitio. */
async function escribirArchivo(ruta, valor, mensaje) {
  const contenido = Buffer.from(JSON.stringify(valor, null, 2) + "\n", "utf8").toString("base64");
  const shaDe = async () => {
    const r = await gh(`/repos/${REPO}/contents/${ruta}?ref=${RAMA}`);
    return r.ok ? (await r.json())?.sha : undefined;
  };
  const mandar = async (sha) =>
    gh(`/repos/${REPO}/contents/${ruta}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: mensaje, content: contenido, branch: RAMA, ...(sha ? { sha } : {}) }),
    });

  let sha = await shaDe();
  let r = await mandar(sha);
  if (r.status === 409 || (r.status === 422 && !sha)) {
    sha = await shaDe();
    r = await mandar(sha);
  }
  return r.ok;
}

/** El mismo resumen que arma `src/server/datos.ts`, calculado del JSON crudo. */
async function resumen() {
  const [registro, opiniones] = await Promise.all([
    leerArchivo("data/vistas.json", { visitas: 0 }),
    leerArchivo("data/opiniones.json", []),
  ]);
  const lista = Array.isArray(opiniones) ? opiniones : [];
  const estrellas = lista.map((o) => Number(o.estrellas) || 0).filter((n) => n > 0);
  const reparto = [1, 2, 3, 4, 5].map((n) => estrellas.filter((e) => e === n).length);
  return {
    vistas: Number(registro.visitas) || 0,
    opiniones: lista.length,
    promedio: estrellas.length ? (estrellas.reduce((a, b) => a + b, 0) / estrellas.length).toFixed(1) : "0.0",
    reparto,
  };
}

/** Borra la fila de prueba del archivo. */
async function limpiar() {
  const lista = await leerArchivo("data/opiniones.json", []);
  const antes = Array.isArray(lista) ? lista.length : 0;
  const resto = (Array.isArray(lista) ? lista : []).filter((o) => o.nombre !== NOMBRE_PRUEBA);
  if (resto.length === antes) return "sin fila de prueba";
  const okBorrado = await escribirArchivo("data/opiniones.json", resto, "qa: limpiar opinión de prueba");
  return okBorrado ? `borradas ${antes - resto.length}` : "error de escritura";
}

if (!TOKEN) {
  console.error("Falta BITLY_CODES_TOKEN (¿olvidaste `. ./.env`?).");
  process.exit(1);
}

const antes = await resumen();
console.log(`Antes: ${JSON.stringify(antes)}  (${REPO})`);

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
  // La lectura pasa por la caché de 30 s del Worker: hay que darle tiempo a
  // que expire, o se compara contra el JSON viejo.
  await dormir(32000);
  const fin = await resumen();
  console.log("después (base):", JSON.stringify(fin));
  check(
    "la opinión se guardó en el repo",
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
  await ses.ev("Page.navigate", { url: `${BASE}/#opiniones` });
  await esperar(ses, `document.querySelector("#opiniones form")`, { nombre: "la sección volvió a montar" });
  await dormir(2000);
  const trasRecarga = await resumen();
  check(
    "recargar en la misma sesión no infla las visitas",
    (trasRecarga?.vistas ?? -1) === (fin?.vistas ?? 0),
    `${fin?.vistas} → ${trasRecarga?.vistas}`,
  );

  // ── 5. Sin el token no se puede escribir directo ──
  // Antes lo probaba la clave pública de Supabase. Ahora lo que protege el
  // archivo es que no hay endpoint abierto: la Contents API exige un token.
  const sinToken = await fetch(`${API}/repos/${REPO}/contents/qa-no-debe-existir.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "User-Agent": "bitly-qa" },
    body: JSON.stringify({ message: "qa", content: "eA==", branch: RAMA }),
  });
  check("escribir sin token sigue bloqueado", !sinToken.ok, `status=${sinToken.status}`);

  // ── 6. La visita se cuenta AL ENTRAR, sin la sección de opiniones ──
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
