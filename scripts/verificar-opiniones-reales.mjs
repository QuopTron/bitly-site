#!/usr/bin/env node
/**
 * Verifica el flujo REAL de opiniones y vistas contra GitHub.
 *
 * Los `probar-*.mjs` prueban las reglas y el servidor sin base; este hace lo que
 * ninguno puede: abre el sitio en Chrome, publica una opinión de verdad desde el
 * modal de comentarios y comprueba que la fila quede en el repo y que el
 * promedio y el reparto suban. Al terminar borra la fila de prueba, así que se
 * puede correr las veces que haga falta sin ensuciar el archivo.
 *
 * La visita se cuenta al entrar (`src/routes/__root.tsx`), así que también se
 * comprueba que el contador avance sin depender de la sección de opiniones.
 *
 * La base es el repo privado `QuopTron/bitly-data` (Contents API). Hace falta un
 * token con permiso `contents: write` para poder limpiar.
 *
 *   . ./.env                       # BITLY_CODES_TOKEN (o BITLY_DATA_TOKEN)
 *   DEMO_URL=http://localhost:3100 node scripts/verificar-opiniones-reales.mjs
 *   pnpm dev                       # en otra terminal, si no usás DEMO_URL
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9348);
const PERFIL = path.join(raiz, ".capturas-perfil-opiniones");

const API = "https://api.github.com";
const REPO = process.env.BITLY_DATA_REPO ?? "QuopTron/bitly-data";
const TOKEN = process.env.BITLY_DATA_TOKEN ?? process.env.BITLY_CODES_TOKEN;
const RAMA = "main";

// Los archivos del repo están cifrados en reposo (AES-256-GCM con
// BITLY_DATA_SECRET), así que para leerlos o limpiarlos hay que usar el mismo
// módulo que usa el sitio. Se compila al vuelo, como en probar-cifrado.mjs.
async function cargarCifrado() {
  const base = path.join(raiz, "node_modules", ".pnpm");
  const carpeta = readdirSync(base).find((d) => d.startsWith("esbuild@"));
  if (!carpeta) throw new Error("No encuentro esbuild en node_modules/.pnpm (¿pnpm install?).");
  const esbuild = (await import(pathToFileURL(path.join(base, carpeta, "node_modules", "esbuild", "lib", "main.js")).href)).default;
  const salida = path.join(raiz, "scripts", ".cache", "cifrado-qa.mjs");
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", "server", "cifrado.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: salida,
  });
  return import(pathToFileURL(salida).href);
}
const cifrado = await cargarCifrado();

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
    const crudo = JSON.parse(await r.text());
    if (cifrado.esSobre(crudo)) return JSON.parse(await cifrado.descifrarSobre(crudo));
    return crudo;
  } catch {
    return defecto;
  }
}

/** Escribe un JSON en el repo (create o update), como hace el sitio. */
async function escribirArchivo(ruta, valor, mensaje) {
  const texto = JSON.stringify(valor, null, 2) + "\n";
  const cuerpo = cifrado.cifradoActivo() ? await cifrado.cifrarTexto(texto) : texto;
  const contenido = Buffer.from(cuerpo, "utf8").toString("base64");
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
  await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
    source: "try{localStorage.setItem('bitly_pistas_cabecera','1')}catch{}",
  });
  await ses.ev("Page.navigate", { url: BASE });

  // ── 1. La portada muestra los contadores reales ──
  await esperar(ses, `document.querySelector("footer [class*='tabular-nums']")`, { nombre: "el pie del hero montó" });
  await dormir(1200);
  const hero = await js(
    ses,
    `(() => {
      const pie = document.querySelector("footer");
      const texto = (pie?.innerText || "").replace(/\\s+/g, " ").trim();
      const estrellas = pie?.querySelector('[role="img"]');
      return {
        texto,
        promedio: estrellas?.getAttribute("aria-label") ?? null,
        girando: !!document.querySelector(".animate-spin"),
      };
    })()`,
  );
  console.log("hero:", JSON.stringify(hero));
  check("la portada no queda girando", hero?.girando === false);
  check("el pie muestra las visitas", /visitas/i.test(hero?.texto ?? ""), hero?.texto?.slice(0, 80));
  check("el pie muestra el promedio de estrellas", /estrellas/i.test(hero?.promedio ?? ""), String(hero?.promedio));
  // El número del pie sale de un resumen que el Worker cachea 30 s: puede ir un
  // poco atrás de lo que hay en la base. Acá sólo se comprueba que se lea; el
  // conteo exacto se verifica contra el repo más abajo, ya sin caché.
  const enPie = Number((hero?.texto ?? "").match(/(\d+)\s+opinion/i)?.[1] ?? NaN);
  check(
    "el pie muestra cuántas opiniones hay",
    Number.isFinite(enPie) && enPie > 0,
    `${enPie} en pantalla (base: ${antes.opiniones})`,
  );

  // ── 2. El modal de comentarios abre con el formulario cerrado ──
  await js(ses, `document.querySelector('button[aria-label="Comentarios"]')?.click()`);
  await esperar(ses, `document.querySelector('[role="dialog"][aria-modal="true"]')`, { nombre: "el modal abrió" });
  await dormir(300);
  const cerrado = await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      return {
        tieneBoton: [...d.querySelectorAll("button")].some((b) => /dejá tu opinión|leave your review/i.test(b.innerText)),
        formularios: d.querySelectorAll("form").length,
        texto: (d.innerText || "").replace(/\\s+/g, " ").slice(0, 120),
      };
    })()`,
  );
  console.log("modal:", JSON.stringify(cerrado));
  check("el modal tiene el botón para comentar", cerrado?.tieneBoton === true, cerrado?.texto);
  check("el formulario arranca cerrado", cerrado?.formularios === 0, `formularios=${cerrado?.formularios}`);

  // ── 3. El formulario: estrellas accesibles, validación y envío ──
  await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      [...d.querySelectorAll("button")].find((b) => /dejá tu opinión|leave your review/i.test(b.innerText))?.click();
    })()`,
  );
  await esperar(ses, `document.querySelector('[role="dialog"] form')`, { nombre: "el formulario se abrió" });
  const forma = await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      const form = d.querySelector("form");
      const grupo = form.querySelector('[role="radiogroup"]');
      const radios = grupo ? [...grupo.querySelectorAll('[role="radio"]')] : [];
      const boton = form.querySelector('button[type="submit"]');
      const campos = [...form.querySelectorAll("input")];
      return {
        estrellas: radios.length,
        tabulables: radios.filter((r) => r.tabIndex === 0).length,
        campos: campos.length,
        enviarBloqueado: boton ? boton.disabled : null,
      };
    })()`,
  );
  console.log("formulario:", JSON.stringify(forma));
  check("tiene las 5 estrellas como radiogroup", forma?.estrellas === 5, `estrellas=${forma?.estrellas}`);
  check("un solo punto de tabulación en la nota", forma?.tabulables === 1, `tabulables=${forma?.tabulables}`);
  check("tiene nombre y comentario", forma?.campos === 2, `campos=${forma?.campos}`);
  check("con el formulario vacío no se puede enviar", forma?.enviarBloqueado === true);

  const teclado = await js(
    ses,
    `(async () => {
      const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
      const form = document.querySelector('[role="dialog"] form');
      const radios = [...form.querySelectorAll('[role="radio"]')];
      const marcado = () => radios.map((r) => r.getAttribute("aria-checked")).join(",");
      const tecla = (key) =>
        radios.find((r) => r.getAttribute("aria-checked") === "true")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      radios[0].click();
      await esperar(120);
      tecla("ArrowRight");
      await esperar(120);
      const trasFlecha = marcado();
      tecla("End");
      await esperar(120);
      const trasFin = marcado();
      return { trasFlecha, trasFin, foco: document.activeElement === radios[4] };
    })()`,
  );
  console.log("estrellas con teclado:", JSON.stringify(teclado));
  check("la flecha derecha sube la nota", teclado?.trasFlecha === "false,true,false,false,false", teclado?.trasFlecha);
  check("Fin salta a 5 estrellas", teclado?.trasFin === "false,false,false,false,true", teclado?.trasFin);
  check("el foco acompaña a la nota elegida", teclado?.foco === true);

  await js(
    ses,
    `(() => {
      const form = document.querySelector('[role="dialog"] form');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const [nombre, texto] = [...form.querySelectorAll("input")];
      set.call(nombre, ${JSON.stringify(NOMBRE_PRUEBA)});
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
      set.call(texto, ${JSON.stringify(TEXTO_PRUEBA)});
      texto.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  await dormir(250);
  await esperar(ses, `document.querySelector('[role="dialog"] form button[type=submit]').disabled === false`, {
    nombre: "el botón se habilita",
  });
  await js(ses, `document.querySelector('[role="dialog"] form button[type=submit]').click()`);
  creada = true;

  await esperar(
    ses,
    `(document.querySelector('[role="dialog"][aria-modal="true"]')?.innerText || "").search(/¡Gracias! Ya se publicó\\.|Thanks! It's live\\./) >= 0`,
    { nombre: "el aviso de publicación", tiempo: 25000 },
  );
  check("el sitio avisa que se publicó", true);

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
  check(
    "el reparto sumó la estrella 5",
    (fin?.reparto?.[4] ?? 0) === (antes.reparto?.[4] ?? 0) + 1,
    `${antes.reparto?.[4]} → ${fin?.reparto?.[4]}`,
  );

  // ── 5. La opinión nueva se ve en la portada sin recargar a mano ──
  await js(ses, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await dormir(600);
  await ses.ev("Page.navigate", { url: BASE });
  await esperar(
    ses,
    `(document.body.innerText || "").includes(${JSON.stringify(NOMBRE_PRUEBA)})`,
    { nombre: "la opinión aparece en el carrusel", tiempo: 30000 },
  );
  check("la opinión nueva se ve en la portada", true);

  // ── 6. Recargar la misma sesión no vuelve a contar la visita ──
  const trasRecarga = await resumen();
  check(
    "recargar en la misma sesión no infla las visitas",
    (trasRecarga?.vistas ?? -1) === (fin?.vistas ?? 0),
    `${fin?.vistas} → ${trasRecarga?.vistas}`,
  );

  // ── 7. Sin el token no se puede escribir directo ──
  const sinToken = await fetch(`${API}/repos/${REPO}/contents/qa-no-debe-existir.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "User-Agent": "bitly-qa" },
    body: JSON.stringify({ message: "qa", content: "eA==", branch: RAMA }),
  });
  check("escribir sin token sigue bloqueado", !sinToken.ok, `status=${sinToken.status}`);

  // ── 8. La visita se cuenta al entrar, sin depender de las opiniones ──
  // La marca vive en `sessionStorage`: se borra y se recarga para simular una
  // entrada nueva. No hace falta otra pestaña ni otro perfil.
  const antesVisita = await resumen();
  await js(ses, `sessionStorage.removeItem("bitly_vista_contada")`);
  // Recarga completa: un cambio de hash no vuelve a montar la app.
  await ses.ev("Page.reload", {});
  await esperar(ses, `document.querySelector('[data-vista="inicio"]')`, { nombre: "la portada volvió a montar" });
  await dormir(3000);
  const trasVisita = await resumen();
  check(
    "la visita se cuenta al entrar, en cualquier pantalla",
    (trasVisita?.vistas ?? 0) === (antesVisita?.vistas ?? 0) + 1,
    `${antesVisita?.vistas} → ${trasVisita?.vistas}`,
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
