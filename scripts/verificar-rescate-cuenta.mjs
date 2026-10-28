#!/usr/bin/env node
/**
 * Verificación en navegador del panel de RESCATE de «Mi cuenta».
 *
 * Comprueba el camino entero, en el orden en que lo usa una persona: abrir el
 * panel (que recién ahí pide la configuración al servidor), definir los canales,
 * guardar y ver lo mismo en la base del sitio, reabrir el modal y encontrarlo
 * guardado, y por último «volver a lo de la app».
 *
 * También comprueba lo que NO tiene que pasar: que una URL inválida no deje un
 * guardado a medias silencioso (el panel avisa) y que los secretos de la app no
 * viajen al sitio (la ruta los descarta; acá se manda uno a propósito).
 *
 * Corre contra el repo de PRUEBA de datos (`QuopTron/bitly-chats`): siembra una
 * cuenta, la borra al final, y usa el correo apagado. Necesita Chrome y un `.env`
 * con el token del repo.
 *
 *   node scripts/verificar-rescate-cuenta.mjs
 */

import path from "node:path";
import {
  dormir,
  entornoPrueba,
  levantarDev,
  raiz,
  servidorDePrueba,
} from "./pruebas/entorno.mjs";
import { abrirChrome, js, nuevaSesion } from "./capturas/lib/cdp.mjs";

const sello = Date.now().toString(36).toLowerCase().slice(-6);
const USUARIO = `rescate${sello}`;
const CORREO = `${USUARIO}@prueba.test`;
const CLAVE = "prueba-rescate-2026";
const PUERTO = 3013;
const BASE = `http://localhost:${PUERTO}`;
const ARCHIVO_RESCATE = "data/rescate.json";
const ARCHIVO_CUENTAS = "data/cuentas.json";

const ESPEJO_1 = "https://espejo-uno.prueba.test";
const ESPEJO_2 = "https://espejo-dos.prueba.test";
const ARCOD = "https://mi-arcod.prueba.test";

const fallos = [];
const chequear = (ok, texto, extra) => {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
};

const HELPERS = `
  window.__t = {
    dialogo: () => [...document.querySelectorAll('[role=dialog]')]
      .find((d) => /Entrar|Crear cuenta|@|Rescate/.test(d.innerText)) ?? null,
    escribir: (el, valor) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      d.set.call(el, valor);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    inputs: () => [...(__t.dialogo()?.querySelectorAll('input') ?? [])],
    boton: (txt) => [...(__t.dialogo()?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent.trim().toLowerCase().includes(txt.toLowerCase())),
    campo: (id) => __t.dialogo()?.querySelector('#' + id) ?? null,
    /** El bloque del panel que contiene [id] (para sus propios controles). */
    bloque: (id) => __t.campo(id)?.closest('div') ?? null,
    verja: (id) => __t.bloque(id)?.querySelector('input[type=checkbox]') ?? null,
  };
`;

let ses;
let dev;
let chrome;
let cuentasServer;

async function esperar(expr, ms = 20000, nombre = expr) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(ses, `!!(${expr})`)) return true;
    await dormir(250);
  }
  console.log(`  (se agotó la espera de ${nombre})`);
  return false;
}

async function esperarTexto(texto, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(ses, `(document.body?.innerText ?? '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())})`)) {
      return true;
    }
    await dormir(250);
  }
  return false;
}

/** Abre «Mi cuenta» desde la cabecera y entra con usuario y contraseña. */
async function abrirCuentaYEntrar() {
  await ses.ev("Page.navigate", { url: BASE });
  await dormir(3000);
  // El recorrido de bienvenida tapa la cabecera la primera vez.
  await js(ses, `localStorage.setItem('bitly_pistas_cabecera', '1'); location.reload()`);
  await dormir(3500);
  await js(ses, HELPERS);
  await js(ses, `document.querySelector('[data-pista="cuenta"]')?.click()`);
  if (!(await esperarTexto("Iniciar sesión", 10000))) return false;
  await js(ses, HELPERS);
  return js(
    ses,
    `(() => {
      const [u, k] = __t.inputs();
      if (!u || !k) return false;
      __t.escribir(u, ${JSON.stringify(USUARIO)});
      __t.escribir(k, ${JSON.stringify(CLAVE)});
      __t.dialogo()?.querySelector('form')?.requestSubmit();
      return true;
    })()`,
  );
}

/** Deja el panel abierto y con sus campos cargados. */
async function abrirPanel() {
  const abierto = await esperar(`__t.boton('Configurar el rescate')`, 12000, "el botón del panel");
  if (!abierto) return false;
  await js(ses, `__t.boton('Configurar el rescate')?.click()`);
  return esperar(`__t.campo('rescate-espejos')`, 20000, "el formulario del rescate");
}

async function guardar() {
  await js(ses, HELPERS);
  await js(ses, `__t.boton('Guardar en mi cuenta')?.click()`);
}

/** Lee el archivo de rescate del repo de PRUEBA (sin caché del módulo). */
async function leerRescate(store) {
  store.olvidar("datos", ARCHIVO_RESCATE);
  const todo = await store.getJson("datos", ARCHIVO_RESCATE, {});
  return todo && typeof todo === "object" ? todo : {};
}

try {
  console.log("— Siembra —");
  entornoPrueba();
  cuentasServer = await servidorDePrueba();
  const cuentas = await cuentasServer.ssrLoadModule("/src/server/cuentas.ts");
  const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");

  store.olvidar("datos", ARCHIVO_CUENTAS);
  const alta = await cuentas.registrarCuenta({
    data: { nombre: "Cuenta de prueba", usuario: USUARIO, correo: CORREO, clave: CLAVE },
  });
  chequear(alta.ok && Boolean(alta.token), "se crea la cuenta de prueba", alta.ok ? "" : alta.motivo);
  if (!alta.ok) throw new Error("sin cuenta no se puede probar");

  const cuentasLista = await store.getJson("datos", ARCHIVO_CUENTAS, []);
  const cuenta = (Array.isArray(cuentasLista) ? cuentasLista : []).find((c) => c?.correo === CORREO);
  chequear(Boolean(cuenta?.id), "la cuenta queda registrada con su id");
  if (!cuenta?.id) throw new Error("no se pudo encontrar la cuenta sembrada");

  console.log("\n— Arranca el dev server —");
  dev = await levantarDev({ puerto: PUERTO });
  chequear(Boolean(dev), `dev server en ${BASE}`);

  chrome = await abrirChrome({
    puerto: 9346,
    perfil: path.join(raiz, "scripts/.cache/perfil-verificar-rescate"),
  });
  ses = await nuevaSesion(chrome.browser, { w: 1280, h: 1000, dpr: 1 });

  console.log("\n— El panel —");
  chequear(await abrirCuentaYEntrar(), "entra a «Mi cuenta»");
  chequear(await esperarTexto(`@${USUARIO}`), "la sesión muestra el usuario");
  chequear(
    !(await js(ses, `(document.body.innerText || '').includes('Rescate')`)),
    "el panel no está abierto hasta que se pide",
  );
  chequear(await abrirPanel(), "el panel se abre y carga su formulario");

  console.log("\n— Guardar la configuración —");
  await js(ses, HELPERS);
  await js(
    ses,
    `__t.escribir(__t.campo('rescate-espejos'), ${JSON.stringify(`${ESPEJO_1}\n${ESPEJO_2}\n`)});
     __t.escribir(__t.campo('rescate-arcod'), ${JSON.stringify(`${ARCOD}/`)});
     __t.verja('rescate-monochrome')?.click();
     const rel = __t.campo('rescate-relay');
     __t.escribir(rel, 'off');`,
  );
  chequear(
    (await js(ses, `__t.campo('rescate-monochrome')?.disabled`)) === true,
    "marcar «apagado» bloquea el campo de esa instancia",
  );
  await guardar();
  chequear(
    await esperarTexto("la app va a usar esta configuración", 20000),
    "el panel confirma el guardado",
  );

  const guardado = (await leerRescate(store))[cuenta.id] ?? {};
  chequear(
    JSON.stringify(guardado.mirrors) === JSON.stringify([ESPEJO_1, ESPEJO_2]),
    "los dos espejos quedaron guardados",
    JSON.stringify(guardado.mirrors),
  );
  chequear(
    guardado.arcodBase === ARCOD,
    "la instancia propia de arcod se normaliza sin barra final",
    String(guardado.arcodBase),
  );
  chequear(guardado.monochrome === false, "monochrome quedó apagado", JSON.stringify(guardado.monochrome));
  chequear(guardado.stashRelay === false, "el relay quedó apagado", JSON.stringify(guardado.stashRelay));
  chequear(typeof guardado.actualizado === "string", "queda el sello de cuándo se actualizó");

  console.log("\n— Se relee igual, sin secretos —");
  await ses.ev("Page.navigate", { url: BASE });
  await dormir(3000);
  await js(ses, HELPERS);
  await js(ses, `document.querySelector('[data-pista="cuenta"]')?.click()`);
  await esperarTexto(`@${USUARIO}`, 15000);
  chequear(await abrirPanel(), "el panel se vuelve a abrir");
  const releido = await js(
    ses,
    `(async () => {
      await new Promise((r) => setTimeout(r, 800));
      return JSON.stringify({
        espejos: __t.campo('rescate-espejos')?.value ?? '',
        arcod: __t.campo('rescate-arcod')?.value ?? '',
        mono: __t.campo('rescate-monochrome')?.disabled && __t.verja('rescate-monochrome')?.checked,
        relay: __t.campo('rescate-relay')?.value ?? '',
      });
    })()`,
  );
  const visto = JSON.parse(releido || "{}");
  chequear(visto.espejos === `${ESPEJO_1}\n${ESPEJO_2}`, "los espejos vuelven tal cual", visto.espejos);
  chequear(visto.arcod === ARCOD, "la instancia de arcod vuelve tal cual", visto.arcod);
  chequear(visto.mono === true, "monochrome sigue marcado como apagado");
  chequear(visto.relay === "off", "el relay sigue apagado", visto.relay);

  console.log("\n— Volver a lo de la app —");
  await js(ses, HELPERS);
  await js(ses, `__t.boton('Volver a lo de la app')?.click()`);
  chequear(
    await esperarTexto("vuelve a usar lo que tenga la app", 20000),
    "el panel confirma el borrado",
  );
  const trasBorrar = await leerRescate(store);
  chequear(trasBorrar[cuenta.id] === undefined, "la cuenta ya no define canales", JSON.stringify(Object.keys(trasBorrar)));
  chequear(
    (await js(ses, `__t.campo('rescate-espejos')?.value ?? ''`)) === "",
    "el formulario queda limpio",
  );

  console.log("\n— Una URL inválida no pasa (y no deja nada a medias) —");
  await js(ses, HELPERS);
  await js(ses, `__t.escribir(__t.campo('rescate-arcod'), 'mi-arcod.test')`);
  await guardar();
  chequear(
    await esperarTexto("no es una dirección http(s)", 20000),
    "el panel avisa que la URL no sirve",
  );
  chequear(
    !(await js(ses, `(document.body.innerText || '').includes('la app va a usar esta configuración')`)),
    "no dice que guardó",
  );
  const trasElError = await leerRescate(store);
  chequear(
    trasElError[cuenta.id] === undefined,
    "no se guardó nada con la URL inválida",
    JSON.stringify(Object.keys(trasElError)),
  );

  const errores = await js(ses, `window.__errores ?? []`);
  chequear(errores.length === 0, "sin errores de página", errores.join(" | "));
} catch (e) {
  console.error("\nERROR:", e.message);
  fallos.push("excepción: " + e.message);
  try {
    console.log("  pantalla:", String(await js(ses, "document.body.innerText")).slice(0, 700).split("\n").join(" | "));
    console.log("  errores:", (await js(ses, `window.__errores ?? []`)).join(" | "));
  } catch {}
} finally {
  try {
    if (cuentasServer) {
      const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");
      // La cuenta sembrada y su configuración de rescate no quedan en el repo
      // de pruebas: la próxima corrida siembra con otro sello.
      store.olvidar("datos", ARCHIVO_CUENTAS);
      const lista = await store.getJson("datos", ARCHIVO_CUENTAS, []);
      const cuenta = (Array.isArray(lista) ? lista : []).find((c) => c?.correo === CORREO);
      if (cuenta) {
        const quedan = lista.filter((c) => c?.correo !== CORREO);
        await store.putJson("datos", ARCHIVO_CUENTAS, quedan, "prueba: limpia la cuenta del rescate");
        store.olvidar("datos", ARCHIVO_RESCATE);
        const rescate = await store.getJson("datos", ARCHIVO_RESCATE, {});
        if (rescate && typeof rescate === "object" && cuenta.id in rescate) {
          delete rescate[cuenta.id];
          await store.putJson("datos", ARCHIVO_RESCATE, rescate, "prueba: limpia el rescate de la cuenta");
        }
      }
    }
  } catch (e) {
    console.error("no se pudo limpiar:", e.message);
  }
  await ses?.cerrar().catch(() => undefined);
  await chrome?.cerrar().catch(() => undefined);
  await cuentasServer?.close();
  await dev?.cerrar();
}

console.log(`\n${fallos.length === 0 ? "TODO OK" : `${fallos.length} fallas`}`);
if (fallos.length > 0) process.exit(1);
