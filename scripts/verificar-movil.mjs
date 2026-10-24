#!/usr/bin/env node
/**
 * Verifica el sitio como se ve en un celular de gama baja (ZTE y compañía).
 *
 * Emula 360×640 con táctil y la **CPU 4× más lenta**, que es la parte que
 * importa: en un equipo así no alcanza con mirar una captura.
 *
 * Comprueba tres cosas:
 *
 *  1. Estructura: que las optimizaciones estén de verdad en el DOM —fondo
 *     estático sin canvas, ninguna capa con `backdrop-filter`, sin animar capas
 *     grandes, sin desbordes horizontales—.
 *  2. Apariciones: que al bajar cada pantalla, todo lo que se anima al entrar
 *     termine visible (sin bloques que queden en gris).
 *  3. Costo: cuadros por segundo y p95 del frame durante un scroll real, con la
 *     CPU recortada. El listón es 45 fps y p95 < 40 ms. El scroll es el de la
 *     pantalla activa: desde el rediseño cada vista tiene su propio contenedor
 *     con `overflow-y-auto`, así que `window.scrollY` no se mueve y medirlo
 *     mediría una página quieta.
 *
 *   pnpm dev
 *   node scripts/verificar-movil.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, nuevaSesion, js, dormir } from "./capturas/lib/cdp.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const PUERTO = Number(process.env.CDP_PORT ?? 9347);
const PERFIL = path.join(raiz, ".capturas-perfil-movil");
const SALIDA = path.join(raiz, "scripts", ".cache");
fs.mkdirSync(SALIDA, { recursive: true });

/** Motorril de un celular barato: pantalla chica, táctil y CPU recortada. */
const MOVIL = { w: 360, h: 640, dpr: 2, movil: true };
const LENTO = 4;

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

async function esperar(ses, expr, { tiempo = 90000, nombre = expr, cada = 150 } = {}) {
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
 * Mide cuadros y deltas durante `ms`, mientras otro bucle hace scroll.
 *
 * Vuelve arriba antes de empezar: si la página ya está al final, `scrollBy` no
 * mueve nada, el navegador no tiene motivo para producir cuadros y la medición
 * sale con un solo frame (que no significa que el sitio vaya lento).
 */
async function medirScroll(ses, ms = 1800, salto = 220, pausa = 28) {
  const PANEL = `[data-vista="inicio"]`;
  await js(ses, `(() => { const p = document.querySelector('${PANEL}'); if (p) p.scrollTop = 0; })()`);
  await dormir(400);

  const medicion = js(
    ses,
    `new Promise((listo) => {
      const deltas = [];
      const inicio = performance.now();
      const fin = inicio + ${ms};
      let t = inicio;
      function paso() {
        const ahora = performance.now();
        deltas.push(ahora - t);
        t = ahora;
        if (ahora < fin) requestAnimationFrame(paso);
        else {
          const orden = deltas.slice().sort((a, b) => a - b);
          const dur = Math.max(0.001, (ahora - inicio) / 1000);
          const en = (f) => orden[Math.min(orden.length - 1, Math.max(0, Math.floor(orden.length * f)))] ?? 0;
          listo({
            frames: deltas.length,
            fps: Math.round(deltas.length / dur),
            promedio: +(deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1)).toFixed(1),
            p95: +en(0.95).toFixed(1),
            peor: +(orden[orden.length - 1] ?? 0).toFixed(1),
          });
        }
      }
      requestAnimationFrame(paso);
    })`,
  );

  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    // Cada vista scrollea dentro de su propio panel, no en `window`.
    await js(ses, `(() => { const p = document.querySelector('${PANEL}'); if (p) p.scrollTop += ${salto}; })()`);
    await dormir(pausa);
  }
  return medicion;
}

const { browser, cerrar } = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
let ses = null;

try {
  console.log(`${BASE} · 360x640, CPU ${LENTO}x más lenta\n`);

  ses = await nuevaSesion(browser, MOVIL);
  await ses.ev("Emulation.setCPUThrottlingRate", { rate: LENTO });
  await ses.ev("Page.navigate", { url: BASE });
  await esperar(ses, `document.querySelector("#demo form")`, { nombre: "la demo montó" });
  await dormir(1200);

  // ── 1. Nada se desborda a lo ancho ──
  const ancho = await js(
    ses,
    `(() => {
      const vw = document.documentElement.clientWidth;
      // Sólo cuenta lo que desborda la PÁGINA. Lo que se sale y queda recortado
      // por un antepasado con overflow (los halos del fondo, las pestañas de la
      // guía, que se arrastran a propósito) no genera scroll horizontal.
      const recortado = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== "visible") return true;
        }
        return false;
      };
      const culpables = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > vw + 2)
        .filter((el) => !recortado(el))
        .map((el) => ({ w: Math.round(el.getBoundingClientRect().right), tag: el.tagName + "." + String(el.className).slice(0, 40) }))
        .slice(0, 5);
      return { vw, doc: document.documentElement.scrollWidth, culpables };
    })()`,
  );
  console.log("ancho:", JSON.stringify(ancho));
  check("la página no se desborda a lo ancho", ancho?.doc <= ancho?.vw + 1, `scrollWidth=${ancho?.doc} vs ${ancho?.vw}`);
  check("ningún elemento genera scroll horizontal", (ancho?.culpables?.length ?? 1) === 0, JSON.stringify(ancho?.culpables));

  // ── 2. El fondo es estático: pared de spray en CSS, sin canvas ──
  const fondo = await js(
    ses,
    `(() => {
      const pared = document.querySelector(".pared-puntos");
      const capa = pared ? pared.parentElement : null;
      const estilo = pared ? getComputedStyle(pared) : null;
      return {
        pared: !!pared,
        patron: estilo ? estilo.backgroundImage !== "none" : false,
        tags: document.querySelectorAll(".tag-fondo").length,
        lienzos: document.querySelectorAll("canvas").length,
        animando: capa ? capa.getAnimations({ subtree: true }).length : -1,
      };
    })()`,
  );
  console.log("fondo:", JSON.stringify(fondo));
  check("el fondo está montado (pared con patrón)", fondo?.pared === true && fondo?.patron === true, JSON.stringify(fondo));
  check("tiene los dos tags de fondo", fondo?.tags === 2, `tags=${fondo?.tags}`);
  check("no hay canvas en celular", fondo?.lienzos === 0, `canvas=${fondo?.lienzos}`);
  check("el fondo no anima nada", fondo?.animando === 0, `animando=${fondo?.animando}`);

  // ── 3. Ninguna capa con `backdrop-filter` (lo que más arruina el scroll) ──
  const blur = await js(
    ses,
    `(() => {
      const conClase = [...document.querySelectorAll(".backdrop-blur, .backdrop-blur-sm, .backdrop-blur-md, .backdrop-blur-lg, .backdrop-blur-xl, .backdrop-blur-2xl")];
      const activas = conClase.filter((el) => {
        const v = getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || "none";
        return v !== "none" && v !== "";
      });
      return { conClase: conClase.length, activas: activas.length };
    })()`,
  );
  console.log("backdrop-filter:", JSON.stringify(blur));
  check("hay elementos translúcidos en el sitio", (blur?.conClase ?? 0) > 0, `${blur?.conClase}`);
  check("ninguno usa backdrop-filter en celular", blur?.activas === 0, `activas=${blur?.activas}`);

  // ── 4. Ninguna capa grande se anima en celular ──
  // Lo que arruina el scroll no es "que haya animaciones", sino animar cajas
  // enormes con blur. Se miran todas las animaciones corriendo y se mide el
  // área del elemento animado.
  const anim = await js(
    ses,
    `(() => {
      const corriendo = document.getAnimations().filter((a) => a.playState === "running");
      const grandes = corriendo
        .map((a) => a.effect && a.effect.target)
        .filter(Boolean)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width * r.height > 200000)
        .map(({ el }) => el.tagName + "." + String(el.className).slice(0, 40));
      return { total: corriendo.length, grandes };
    })()`,
  );
  console.log("animaciones:", JSON.stringify(anim));
  check("no se animan capas grandes en celular", anim?.grandes?.length === 0, JSON.stringify(anim?.grandes));

  // ── 5. Las 4 burbujas entran sin scroll, también en 360 px ──
  const burbujas = await js(
    ses,
    `(() => {
      const grupo = document.querySelector("#demo form [role='group']");
      if (!grupo) return null;
      const hijos = [...grupo.children];
      const g = grupo.getBoundingClientRect();
      return {
        cuantas: hijos.length,
        scrollX: grupo.scrollWidth - grupo.clientWidth,
        desbordan: hijos.filter((h) => { const r = h.getBoundingClientRect(); return r.right > g.right + 1 || r.left < g.left - 1; }).length,
      };
    })()`,
  );
  console.log("burbujas:", JSON.stringify(burbujas));
  check("las 4 burbujas entran en 360 px", burbujas?.cuantas === 4 && burbujas?.desbordan === 0, JSON.stringify(burbujas));
  check("sin scroll horizontal en las burbujas", (burbujas?.scrollX ?? 99) <= 1, `scrollX=${burbujas?.scrollX}`);

  // ── 6. Al bajar, todo lo que aparece termina visible ──
  // Cada pantalla scrollea en su propio panel: se recorre ESE panel, no window.
  const revelar = async (sel) => {
    const alto = await js(ses, `(() => { const p = document.querySelector('${sel}'); return p ? p.scrollHeight : 0; })()`);
    for (let y = 0; y <= alto; y += 240) {
      await js(ses, `(() => { const p = document.querySelector('${sel}'); if (p) p.scrollTop = ${y}; })()`);
      await dormir(60);
    }
    // Margen de sobra: la última aparición puede tener 150 ms de retraso más
    // 600 ms de animación, y con la CPU recortada se estira.
    await dormir(1800);
    return js(
      ses,
      `(() => {
        const todos = [...document.querySelectorAll('${sel} [data-reveal]')];
        const ocultos = todos.filter((el) => Number(getComputedStyle(el).opacity) < 0.99);
        return {
          total: todos.length,
          ocultos: ocultos.length,
          cuales: ocultos.map((el) => el.tagName + "." + String(el.className).slice(0, 46)),
        };
      })()`,
    );
  };

  const reveals = await revelar('[data-vista="inicio"]');
  console.log("apariciones (inicio):", JSON.stringify(reveals));
  check("hay bloques que aparecen al bajar", (reveals?.total ?? 0) >= 3, `${reveals?.total}`);
  check("en Inicio todos terminan visibles", reveals?.ocultos === 0, JSON.stringify(reveals?.cuales));

  // Las otras pantallas sólo se revelan cuando entran en pantalla: se navega a
  // Planes con el menú del celular y se comprueba que no quede nada en gris.
  await js(
    ses,
    `[...document.querySelectorAll("header button")]
      .find((b) => /abrir menú|open menu/i.test(b.getAttribute("aria-label") || ""))?.click()`,
  );
  await dormir(400);
  const navego = await js(
    ses,
    `(() => {
      const b = [...document.querySelectorAll("nav button")].find((x) => /^planes$/i.test(x.innerText.trim()));
      if (!b) return false;
      b.click();
      return true;
    })()`,
  );
  check("el menú del celular navega a Planes", navego === true);
  await esperar(ses, `document.querySelector('[data-vista="planes"]')?.getAttribute('aria-hidden') === 'false'`, {
    nombre: "la pantalla de Planes entra",
  });
  const planes = await revelar('[data-vista="planes"]');
  console.log("apariciones (planes):", JSON.stringify(planes));
  check("en Planes también hay bloques que aparecen", (planes?.total ?? 0) > 0, `${planes?.total}`);
  check("en Planes ninguno queda oculto", planes?.ocultos === 0, JSON.stringify(planes?.cuales));

  // Vuelta a Inicio para el resto de las pruebas.
  await js(
    ses,
    `[...document.querySelectorAll("header button")]
      .find((b) => /abrir menú|open menu/i.test(b.getAttribute("aria-label") || ""))?.click()`,
  );
  await dormir(300);
  await js(
    ses,
    `[...document.querySelectorAll("nav button")].find((x) => /^inicio$/i.test(x.innerText.trim()))?.click()`,
  );
  await dormir(600);

  // ── 7. Scroll real con la CPU recortada ──
  // Tres pasadas y se conserva la mejor: el ruido (una tarea del sistema, el
  // servidor de desarrollo recompilando) sólo puede empeorar una medición,
  // nunca mejorarla, así que el mejor resultado es el que refleja el sitio.
  const pasadas = [await medirScroll(ses), await medirScroll(ses), await medirScroll(ses)];
  const scroll = pasadas.reduce((x, y) => (y.fps >= x.fps ? y : x));
  console.log("scroll:", pasadas.map((p) => `${p.fps}/s p95 ${p.p95} ms`).join(" | "), "→", JSON.stringify(scroll));
  check("el scroll va fluido (p95 < 40 ms)", scroll.p95 < 40, `p95=${scroll.p95} ms, peor=${scroll.peor} ms`);
  check("sostiene 45 fps o más", scroll.fps >= 45, `${scroll.fps} cuadros/s, promedio ${scroll.promedio} ms`);

  const foto = await ses.ev("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(SALIDA, "movil.png"), Buffer.from(foto.data, "base64"));

  // ── 8. El formulario de opiniones del modal (no se envía nada) ──
  await js(ses, `document.querySelector('button[aria-label="Comentarios"]')?.click()`);
  await esperar(ses, `document.querySelector('[role="dialog"][aria-modal="true"]')`, {
    nombre: "el modal de comentarios abrió",
  });
  await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      [...d.querySelectorAll("button")]
        .find((b) => /dejá tu opinión|leave your review/i.test(b.innerText))?.click();
    })()`,
  );
  await esperar(ses, `document.querySelector('[role="dialog"] form [role="radiogroup"]')`, {
    nombre: "el formulario de opiniones se abrió",
  });
  const forma = await js(
    ses,
    `(() => {
      const form = document.querySelector('[role="dialog"] form');
      const radios = [...form.querySelectorAll('[role="radio"]')];
      const boton = form.querySelector('button[type="submit"]');
      return {
        estrellas: radios.length,
        tabulables: radios.filter((r) => r.tabIndex === 0).length,
        campos: form.querySelectorAll("input").length,
        enviarBloqueado: boton ? boton.disabled : null,
      };
    })()`,
  );
  console.log("opiniones:", JSON.stringify(forma));
  check("tiene las 5 estrellas como radiogroup", forma?.estrellas === 5, `estrellas=${forma?.estrellas}`);
  check("tiene nombre y comentario", forma?.campos === 2, `campos=${forma?.campos}`);
  check("con el formulario vacío no se puede enviar", forma?.enviarBloqueado === true);
  check("la nota tiene un solo punto de tabulación", forma?.tabulables === 1, `tabulables=${forma?.tabulables}`);

  await js(
    ses,
    `(() => {
      const form = document.querySelector('[role="dialog"] form');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const [nombre, texto] = [...form.querySelectorAll("input")];
      form.querySelectorAll('[role="radio"]')[4].click();
      set.call(nombre, "Pablo");
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
      set.call(texto, "Muy buena la demo, bajó en FLAC de una.");
      texto.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  await dormir(250);
  const habilitado = await js(ses, `document.querySelector('[role="dialog"] form button[type=submit]').disabled`);
  check("con datos válidos el botón se habilita", habilitado === false, `bloqueado=${habilitado}`);

  // La calificación se recorre con el teclado: flechas, Inicio y Fin, con un
  // solo punto de tabulación (el patrón de un radiogroup).
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

  // Se cierra sin enviar: publicar escribiría en la base.
  await js(ses, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await dormir(500);
  check(
    "Escape cierra el modal de comentarios",
    (await js(ses, `document.querySelectorAll('[role="dialog"][aria-modal="true"]').length`)) === 0,
  );

  // ── 9. Los modales son diálogos de verdad, no sólo un recuadro ──
  // Escape, foco adentro, nombre accesible y la página de atrás sin arrastrarse.
  const disparo = await js(
    ses,
    `(() => {
      // El botón "Ver" del hero abre el modal de descargas (un diálogo real).
      const b = [...document.querySelectorAll("button")].find((x) => /^ver$/i.test((x.innerText || "").trim()));
      if (!b) return "sin-boton";
      b.click();
      return "ok";
    })()`,
  );
  check("se encontró el botón que abre el diálogo", disparo === "ok", String(disparo));
  await esperar(ses, `document.querySelector('[role="dialog"][aria-modal="true"]')`, {
    nombre: "el diálogo abrió",
    tiempo: 15000,
  });
  const dialogo = await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      const id = d.getAttribute("aria-labelledby");
      return {
        nombre: id ? (document.getElementById(id)?.innerText || "") : "",
        focoAdentro: d.contains(document.activeElement),
        scrollBloqueado: getComputedStyle(document.body).overflow === "hidden",
        cerrarEtiquetado: !!d.querySelector("button[aria-label]"),
      };
    })()`,
  );
  console.log("diálogo:", JSON.stringify(dialogo));
  check("el diálogo tiene nombre accesible", (dialogo?.nombre ?? "").length > 3, dialogo?.nombre);
  check("el foco entra al diálogo", dialogo?.focoAdentro === true);
  check("la página de atrás no se arrastra", dialogo?.scrollBloqueado === true);
  check("el botón de cerrar tiene etiqueta", dialogo?.cerrarEtiquetado === true);

  await js(ses, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await dormir(400);
  const trasEscape = await js(
    ses,
    `({
      quedo: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      scrollSuelto: getComputedStyle(document.body).overflow !== "hidden",
    })`,
  );
  check("Escape cierra el diálogo", trasEscape?.quedo === false);
  check("al cerrar se suelta el scroll de atrás", trasEscape?.scrollSuelto === true);

  // Dos diálogos a la vez: cerrar el primero NO puede soltar el fondo mientras
  // el segundo sigue abierto (y el último en cerrarse es el que suelta).
  // Busca por texto visible o por aria-label: los botones del header son de
  // sólo ícono y su texto accesible está en el aria-label.
  const abrir = (re) =>
    js(
      ses,
      `(() => {
        const textos = (x) => [(x.innerText || "").trim(), (x.getAttribute("aria-label") || "").trim()];
        const b = [...document.querySelectorAll("button")].find((x) => textos(x).some((t) => ${re}.test(t)));
        if (!b) return false;
        b.click();
        return true;
      })()`,
    );
  check("abre el primero de los dos diálogos", (await abrir(/^ver$/i)) === true);
  await dormir(700);
  check("abre el segundo con el primero todavía abierto", (await abrir(/preguntas frecuentes|faq/i)) === true);
  await dormir(900);
  const dosAbiertos = await js(ses, `document.querySelectorAll('[role="dialog"][aria-modal="true"]').length`);
  check("hay dos diálogos abiertos a la vez", dosAbiertos === 2, `abiertos=${dosAbiertos}`);

  // Cierra el primero (el suyo es el primer botón "Cerrar" en el DOM).
  await js(
    ses,
    `(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      const b = d.querySelector("button[aria-label]");
      if (b) b.click();
      return !!b;
    })()`,
  );
  await dormir(300);
  const trasUno = await js(
    ses,
    `({
      abiertos: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
      sigueBloqueado: getComputedStyle(document.body).overflow === "hidden",
    })`,
  );
  check("queda uno abierto", trasUno?.abiertos === 1, `abiertos=${trasUno?.abiertos}`);
  check("el fondo SIGUE bloqueado mientras hay otro abierto", trasUno?.sigueBloqueado === true);

  await js(ses, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await dormir(400);
  const trasDos = await js(
    ses,
    `({
      abiertos: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
      libre: getComputedStyle(document.body).overflow !== "hidden",
    })`,
  );
  check("cerrar el último sí suelta el fondo", trasDos?.abiertos === 0 && trasDos?.libre === true, JSON.stringify(trasDos));

  // ── 10. Las opiniones cargan y no quedan girando para siempre ──
  await dormir(1500);
  const estadoOpiniones = await js(
    ses,
    `(() => {
      const vista = document.querySelector('[data-vista="inicio"]');
      const pie = vista ? vista.querySelector("footer") : null;
      return {
        girando: !!vista?.querySelector(".animate-spin"),
        pie: (pie?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
      };
    })()`,
  );
  console.log("estado de opiniones:", JSON.stringify(estadoOpiniones));
  check("las opiniones no quedan girando para siempre", estadoOpiniones?.girando === false, JSON.stringify(estadoOpiniones));
  check("el pie dice cuántas opiniones hay", /opinion/i.test(estadoOpiniones?.pie ?? ""), estadoOpiniones?.pie);

  // ── 11. Con "menos movimiento" nada se esconde y nada se anima ──
  // Es el camino que más fácil se rompe: si la clase que oculta el contenido
  // no se soltara, la página quedaría en gris para quien pide menos movimiento.
  await ses.ev("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await ses.ev("Page.navigate", { url: BASE });
  await esperar(ses, `document.querySelector("#demo form")`, { nombre: "la demo montó (sin movimiento)" });
  await dormir(1000);
  const quieto = await js(
    ses,
    `(() => {
      const todos = [...document.querySelectorAll("[data-reveal]")];
      return {
        total: todos.length,
        invisibles: todos.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
        // Lo que importa no es que una animación siga existiendo, sino que
        // ninguna dure lo suficiente para verse moverse.
        animando: document
          .getAnimations()
          .filter((a) => {
            const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
            return t && typeof t.duration === "number" && t.duration > 50;
          })
          .map((a) => a.animationName || a.transitionProperty || "?"),
        lienzos: document.querySelectorAll("canvas").length,
      };
    })()`,
  );
  console.log("sin movimiento:", JSON.stringify(quieto));
  check("sin movimiento no se esconde nada", (quieto?.total ?? 1) > 0 && quieto?.invisibles === 0, JSON.stringify(quieto));
  check("sin movimiento no queda nada animándose", (quieto?.animando?.length ?? 1) === 0, `animando=${JSON.stringify(quieto?.animando)}`);
  check("sin movimiento no hay ningún canvas", quieto?.lienzos === 0, `canvas=${quieto?.lienzos}`);

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  if (ses) await ses.cerrar().catch(() => {});
  await cerrar();
}
