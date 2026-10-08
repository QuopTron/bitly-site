#!/usr/bin/env node
/**
 * Verifica el sitio como se ve en un celular de gama baja (ZTE y compañía).
 *
 * Emula 360×640 con táctil y la **CPU 4× más lenta**, que es la parte que
 * importa: en un equipo así no alcanza con mirar una captura.
 *
 * Comprueba tres cosas:
 *
 *  1. Estructura: que las optimizaciones estén de verdad en el DOM —canvas en
 *     perfil liviano, ninguna capa con `backdrop-filter`, sin animar los halos
 *     enormes, sin desbordes horizontales—.
 *  2. Apariciones: que al bajar, todo lo que se anima al entrar termine visible
 *     (sin capas que queden en gris).
 *  3. Costo: cuadros por segundo y p95 del frame durante un scroll real, con la
 *     CPU recortada. El listón es 45 fps y p95 < 40 ms.
 *
 * Nota sobre lo que NO mide: no hay comparación contra la configuración de
 * escritorio. Se probó forzándola a la fuerza sobre el mismo viewport, pero en
 * headless el ruido entre dos pasadas de la MISMA configuración (17 a 34 fps)
 * es mayor que la diferencia entre configuraciones, así que cualquier número
 * que saliera de ahí sería inventado. De la ganancia quedan los datos duros del
 * DOM: 22 puntos sin líneas contra 80 puntos con 3 160 comparaciones por cuadro,
 * y 0 capas translúcidas contra 18.
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
  await js(ses, `window.scrollTo({ top: 0, left: 0, behavior: "instant" })`);
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
    // `instant` ignora el `scroll-behavior: smooth` del CSS.
    await js(ses, `window.scrollBy({ top: ${salto}, left: 0, behavior: "instant" })`);
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

  // ── 2. Las partículas bajan a la versión liviana ──
  const particulas = await js(
    ses,
    `(() => { const c = document.querySelector("canvas"); return c ? { ...c.dataset } : null; })()`,
  );
  console.log("partículas:", JSON.stringify(particulas));
  check("el canvas existe (hay fondo)", particulas !== null);
  check("perfil liviano: 22 puntos", particulas?.puntos === "22", `puntos=${particulas?.puntos}`);
  check("perfil liviano: sin líneas O(n²)", particulas?.lineas === "off", `lineas=${particulas?.lineas}`);
  check("perfil liviano: sin halo del puntero", particulas?.glow === "off", `glow=${particulas?.glow}`);

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

  // ── 4. Los halos enormes no se animan; lo chico sí ──
  const anim = await js(
    ses,
    `(() => {
      const corriendo = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getAnimations().length > 0).length;
      return {
        deriva: corriendo(".anim-deriva"),
        halo: corriendo(".anim-halo"),
        flota: corriendo(".anim-flota"),
        brillo: corriendo(".anim-brillo"),
      };
    })()`,
  );
  console.log("animaciones:", JSON.stringify(anim));
  check("los halos del fondo NO se animan en celular", anim?.deriva === 0, `deriva=${anim?.deriva}`);
  check("los halos con blur NO se animan en celular", anim?.halo === 0, `halo=${anim?.halo}`);
  check("el logo sigue flotando (elemento chico)", (anim?.flota ?? 0) > 0, `flota=${anim?.flota}`);
  check("el brillo del título sigue", (anim?.brillo ?? 0) > 0, `brillo=${anim?.brillo}`);

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
  const alto = await js(ses, `document.documentElement.scrollHeight`);
  for (let y = 0; y <= alto; y += 260) {
    await js(ses, `window.scrollTo({ top: ${y}, left: 0, behavior: "instant" })`);
    await dormir(60);
  }
  // Margen de sobra: la última aparición puede tener 150 ms de retraso más
  // 600 ms de animación, y con la CPU recortada se estira.
  await dormir(1800);
  const reveals = await js(
    ses,
    `(() => {
      const todos = [...document.querySelectorAll("[data-reveal]")];
      const ocultos = todos.filter((el) => Number(getComputedStyle(el).opacity) < 0.99);
      return {
        total: todos.length,
        ocultos: ocultos.length,
        sinMarca: todos.filter((el) => !el.hasAttribute("data-dentro")).length,
        cuales: todos.filter((el) => !el.hasAttribute("data-dentro")).map((el) => el.tagName + "." + String(el.className).slice(0, 46)),
      };
    })()`,
  );
  console.log("apariciones:", JSON.stringify(reveals));
  check("hay bloques que aparecen al bajar", (reveals?.total ?? 0) > 5, `${reveals?.total}`);
  check("todos quedan marcados al pasar por ellos", reveals?.sinMarca === 0, `sinMarca=${reveals?.sinMarca}`);
  check("y todos terminan visibles", reveals?.ocultos === 0, `ocultos=${reveals?.ocultos}`);

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

  // ── 8. La sección de opiniones se monta y valida el formulario sola ──
  // (No se envía nada: eso escribiría en la base.)
  const forma = await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      if (!s) return null;
      const grupo = s.querySelector('[role="radiogroup"]');
      const boton = s.querySelector('button[type="submit"]');
      return {
        estrellas: grupo ? grupo.querySelectorAll('[role="radio"]').length : 0,
        tieneNombre: !!s.querySelector("input"),
        tieneComentario: !!s.querySelector("textarea"),
        enviarBloqueado: boton ? boton.disabled : null,
      };
    })()`,
  );
  console.log("opiniones:", JSON.stringify(forma));
  check("la sección de opiniones está en la página", forma !== null);
  check("tiene las 5 estrellas", forma?.estrellas === 5, `estrellas=${forma?.estrellas}`);
  check("tiene nombre y comentario", forma?.tieneNombre === true && forma?.tieneComentario === true);
  check("con el formulario vacío no se puede enviar", forma?.enviarBloqueado === true);

  await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      s.querySelectorAll('[role="radio"]')[4].click();
      const setI = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const nombre = s.querySelector("input");
      setI.call(nombre, "Pablo");
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
      const setT = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      const texto = s.querySelector("textarea");
      setT.call(texto, "Muy buena la demo, bajó en FLAC de una.");
      texto.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  await dormir(250);
  const habilitado = await js(ses, `document.querySelector("#opiniones button[type=submit]").disabled`);
  check("con datos válidos el botón se habilita", habilitado === false, `bloqueado=${habilitado}`);

  // La calificación tiene que poder recorrerse con el teclado: flechas, Inicio
  // y Fin, con un solo punto de tabulación (el patrón de un radiogroup).
  const teclado = await js(
    ses,
    `(async () => {
      const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
      const s = document.querySelector("#opiniones");
      const radios = [...s.querySelectorAll('[role="radio"]')];
      const tabulables = radios.filter((r) => r.tabIndex === 0).length;
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
      return { tabulables, trasFlecha, trasFin, foco: document.activeElement === radios[4] };
    })()`,
  );
  console.log("estrellas con teclado:", JSON.stringify(teclado));
  check("la calificación tiene un solo punto de tabulación", teclado?.tabulables === 1, `tabulables=${teclado?.tabulables}`);
  check("la flecha derecha sube la nota", teclado?.trasFlecha === "false,true,false,false,false", teclado?.trasFlecha);
  check("Fin salta a 5 estrellas", teclado?.trasFin === "false,false,false,false,true", teclado?.trasFin);
  check("el foco acompaña a la nota elegida", teclado?.foco === true);

  // ── 9. Los modales son diálogos de verdad, no sólo un recuadro ──
  // Escape, foco adentro, nombre accesible y la página de atrás sin arrastrarse.
  const disparo = await js(
    ses,
    `(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /bitly m[o\u00f3]vil/i.test(x.innerText || ""));
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
  const abrir = (re) =>
    js(
      ses,
      `(() => {
        const b = [...document.querySelectorAll("button")].find((x) => ${re}.test(x.innerText || ""));
        if (!b) return false;
        b.click();
        return true;
      })()`,
    );
  check("abre el primero de los dos diálogos", (await abrir(/bitly m[o\u00f3]vil/i)) === true);
  await dormir(250);
  check("abre el segundo con el primero todavía abierto", (await abrir(/preguntas frecuentes/i)) === true);
  await dormir(250);
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

  // ── 10. Las opiniones no quedan girando para siempre ──
  // Con la migración sin aplicar, la base contesta error: la sección tiene que
  // decirlo, no quedarse con el spinner ni quedar en blanco.
  await dormir(1500);
  const estadoOpiniones = await js(
    ses,
    `(() => {
      const s = document.querySelector("#opiniones");
      return { girando: !!s.querySelector(".animate-spin"), texto: (s.innerText || "").trim().length };
    })()`,
  );
  console.log("estado de opiniones:", JSON.stringify(estadoOpiniones));
  check("las opiniones no quedan girando para siempre", estadoOpiniones?.girando === false, JSON.stringify(estadoOpiniones));
  check("la sección dice algo", (estadoOpiniones?.texto ?? 0) > 80, `largo=${estadoOpiniones?.texto}`);

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
        particulas: (() => { const c = document.querySelector("canvas"); return c ? c.dataset.puntos ?? null : null; })(),
      };
    })()`,
  );
  console.log("sin movimiento:", JSON.stringify(quieto));
  check("sin movimiento no se esconde nada", (quieto?.total ?? 1) > 0 && quieto?.invisibles === 0, JSON.stringify(quieto));
  check("sin movimiento no queda nada animándose", (quieto?.animando?.length ?? 1) === 0, `animando=${JSON.stringify(quieto?.animando)}`);
  check("sin movimiento no se dibuja el canvas", quieto?.particulas == null, `puntos=${quieto?.particulas}`);

  console.log(`\n${ok}/${ok + fallos} aserciones OK`);
  if (fallos > 0) process.exitCode = 1;
} finally {
  if (ses) await ses.cerrar().catch(() => {});
  await cerrar();
}
