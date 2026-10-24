#!/usr/bin/env node
/**
 * Verificación en navegador del panel del dueño y del reparto de códigos.
 *
 * Levanta un dev server propio contra el repo de DATOS DE PRUEBA (correo
 * apagado), siembra una compradora con un pedido pagado de 2 códigos y recorre:
 *
 *   1. acceso (clave equivocada y correcta), token y pestañas;
 *   2. resumen, alta y baja de un egreso;
 *   3. pedidos y usuarios con el token;
 *   4. reparto: el dueño asigna un código escribiendo solo el correo;
 *   5. la compradora lo ve en «Mi cuenta» y lo revoca;
 *   6. el código liberado se puede repartir de nuevo.
 *
 * Necesita Chrome y un `.env` con el token del repo de datos.
 *
 *   node scripts/verificar-panel.mjs
 */

import path from "node:path";
import {
  ADMIN_CLAVE,
  ADMIN_CORREO,
  dormir,
  entornoPrueba,
  levantarDev,
  raiz,
  servidorDePrueba,
} from "./pruebas/entorno.mjs";
import { abrirChrome, js, nuevaSesion } from "./capturas/lib/cdp.mjs";

const sello = Date.now().toString(36).toUpperCase().slice(-6);
const FOLIO = `FLX-VER${sello}`;
const USUARIO = `verif${sello.toLowerCase()}`;
const CORREO = `${USUARIO}@prueba.test`;
const CLAVE = "prueba-verificacion-2026";
const CODIGOS = [
  `BITLY2.verif-${sello}-uno.firma-${sello}`,
  `BITLY2.verif-${sello}-dos.firma-${sello}`,
];
const INVITADA = `invitada.${sello.toLowerCase()}@prueba.test`;
const INVITADA_2 = `otra.${sello.toLowerCase()}@prueba.test`;
const PUERTO = 3010;
const BASE = `http://localhost:${PUERTO}`;

const fallos = [];
const chequear = (ok, texto, extra) => {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
};

const HELPERS = `
  window.__t = {
    texto: () => document.body.innerText,
    dialogos: () => [...document.querySelectorAll('[role=dialog]')],
    dialogo: () => __t.dialogos().find((d) => /Entrar|Crear cuenta|Cerrar sesión|@/.test(d.innerText)) ?? null,
    escribir: (el, valor) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      d.set.call(el, valor);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    inputs: () => [...(__t.dialogo()?.querySelectorAll('form input') ?? [])],
    enviar: () => __t.dialogo()?.querySelector('form')?.requestSubmit(),
    boton: (txt) => [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim().toLowerCase().includes(txt.toLowerCase())),
    tab: (txt) => [...document.querySelectorAll('[role=tab]')]
      .find((b) => b.textContent.trim().toLowerCase() === txt.toLowerCase()),
    aria: (txt) => [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes(txt.toLowerCase())),
  };
`;

let ses;
async function esperarTexto(texto, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(ses, `(document.body?.innerText ?? '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())})`)) return true;
    await dormir(250);
  }
  return false;
}
async function esperarSinTexto(texto, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (!(await js(ses, `(document.body?.innerText ?? '').toLowerCase().includes(${JSON.stringify(texto.toLowerCase())})`))) return true;
    await dormir(250);
  }
  return false;
}
const cuerpo = () => js(ses, `document.body?.innerText ?? ''`);

async function limpiarBase(store) {
  store.olvidar("datos", "data/pedidos.json");
  store.olvidar("datos", "data/asignaciones.json");
  store.olvidar("datos", "data/cuentas.json");
  store.olvidar("datos", "data/codigos-emitidos.json");

  const pedidos = await store.getJson("datos", "data/pedidos.json", []);
  const sinPedido = (Array.isArray(pedidos) ? pedidos : []).filter((p) => p?.folio !== FOLIO);
  if (sinPedido.length !== (pedidos ?? []).length) {
    await store.putJson("datos", "data/pedidos.json", sinPedido, `prueba: quita el pedido ${FOLIO}`);
  }
  const reparto = await store.getJson("datos", "data/asignaciones.json", []);
  const sinReparto = (Array.isArray(reparto) ? reparto : []).filter((a) => a?.folio !== FOLIO);
  if (sinReparto.length !== (reparto ?? []).length) {
    await store.putJson("datos", "data/asignaciones.json", sinReparto, `prueba: quita el reparto ${FOLIO}`);
  }
  const lista = await store.getJson("datos", "data/cuentas.json", []);
  const vivas = (Array.isArray(lista) ? lista : []).filter(
    (c) => !(typeof c?.correo === "string" && c.correo.endsWith("@prueba.test")),
  );
  if (vivas.length !== (lista ?? []).length) {
    await store.putJson("datos", "data/cuentas.json", vivas, "prueba: limpia cuentas de la verificación");
  }
  const emitidos = await store.getJson("datos", "data/codigos-emitidos.json", []);
  const sinEmitidos = (Array.isArray(emitidos) ? emitidos : []).filter((e) => !CODIGOS.includes(e?.c));
  if (sinEmitidos.length !== (emitidos ?? []).length) {
    await store.putJson("datos", "data/codigos-emitidos.json", sinEmitidos, "prueba: limpia códigos de la verificación");
  }
}

let dev;
let chrome;
let cuentasServer;
try {
  console.log("— Siembra en el repo de prueba —");
  entornoPrueba();
  cuentasServer = await servidorDePrueba();
  const cuentas = await cuentasServer.ssrLoadModule("/src/server/cuentas.ts");
  const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");
  const asignaciones = await cuentasServer.ssrLoadModule("/src/server/asignaciones.ts");
  const admin = await cuentasServer.ssrLoadModule("/src/server/admin.ts");

  await limpiarBase(store);
  const alta = await cuentas.registrarCuenta({
    data: { nombre: "Compradora de verificación", usuario: USUARIO, correo: CORREO, clave: CLAVE },
  });
  chequear(alta.ok, "se crea la cuenta compradora", alta.ok ? "" : alta.motivo);
  if (!alta.ok) throw new Error("sin cuenta no hay pedido");

  const ahora = new Date().toISOString();
  const pedidos = await store.getJson("datos", "data/pedidos.json", []);
  await store.putJson(
    "datos",
    "data/pedidos.json",
    [
      {
        folio: FOLIO,
        token: `TOKEN-${sello}`,
        nombre: "Compradora de verificación",
        correo: CORREO,
        celular: "+59170000000",
        comprobante: "",
        tipoComprobante: "image/png",
        estado: "pagado",
        cantidad: CODIGOS.length,
        total: 100,
        codigos: CODIGOS,
        codigo: CODIGOS[0],
        ventanaFin: ahora,
        nota: "",
        cuentaId: alta.cuenta.id,
        creado: ahora,
        actualizado: ahora,
      },
      ...(Array.isArray(pedidos) ? pedidos : []),
    ],
    `prueba: pedido ${FOLIO}`,
  );
  const emitidos = await store.getJson("datos", "data/codigos-emitidos.json", []);
  await store.putJson(
    "datos",
    "data/codigos-emitidos.json",
    [
      ...CODIGOS.map((c) => ({ c, f: FOLIO, u: null, d: ahora, a: true })),
      ...(Array.isArray(emitidos) ? emitidos : []),
    ],
    `prueba: códigos ${FOLIO}`,
  );
  chequear(true, "pedido pagado de 2 códigos listo", FOLIO);

  console.log("\n— Arranca el dev server —");
  dev = await levantarDev({ puerto: PUERTO });
  chequear(Boolean(dev), `dev server en ${BASE}`);

  chrome = await abrirChrome({
    puerto: 9343,
    perfil: path.join(raiz, "scripts/.cache/perfil-verificar-panel"),
  });
  ses = await nuevaSesion(chrome.browser, { w: 1360, h: 950, dpr: 1 });

  /* ── Acceso ─────────────────────────────────────────────────────── */

  console.log("\n— Acceso —");
  await ses.ev("Page.navigate", { url: `${BASE}/admin` });
  await dormir(3000);
  chequear(await esperarTexto("Panel del dueño"), "la página /admin muestra el acceso");
  await js(ses, HELPERS);
  chequear(
    (await js(ses, `document.querySelector('meta[name=robots]')?.content ?? ''`)).includes("noindex"),
    "la página es noindex",
  );

  const entrar = (correo, clave) =>
    js(
      ses,
      `(() => {
        const [c, k] = [...document.querySelectorAll('form input')];
        if (!c || !k) return false;
        __t.escribir(c, ${JSON.stringify(correo)});
        __t.escribir(k, ${JSON.stringify(clave)});
        c.form.requestSubmit();
        return true;
      })()`,
    );

  await entrar(ADMIN_CORREO, "clave-equivocada");
  chequear(await esperarTexto("Correo o clave incorrectos"), "una clave equivocada muestra el error");
  chequear(
    !(await js(ses, `Boolean(localStorage.getItem('bitly_admin_token'))`)),
    "no guarda token con la clave equivocada",
  );

  // Se recarga para entrar como alguien que abre la página de cero.
  await ses.ev("Page.navigate", { url: `${BASE}/admin` });
  await dormir(3000);
  await js(ses, HELPERS);
  await entrar(ADMIN_CORREO, ADMIN_CLAVE);
  chequear(await esperarTexto("Panel Bitly"), "con la clave correcta entra al panel");
  chequear(await esperarTexto("Ingresos del mes"), "el resumen muestra los ingresos del mes");
  const token = await js(ses, `localStorage.getItem('bitly_admin_token')`);
  chequear(typeof token === "string" && token.split(".").length === 2, "guarda un token firmado (dos partes)");
  chequear(
    !(await js(ses, `document.body.innerText.includes(${JSON.stringify(ADMIN_CLAVE)})`)),
    "la clave no queda escrita en la página",
  );

  const pestañas = await js(ses, `[...document.querySelectorAll('[role=tab]')].map((b) => b.textContent.trim())`);
  chequear(
    ["Resumen", "Pedidos", "Usuarios", "Egresos"].every((p) => pestañas.includes(p)),
    "están las cuatro pestañas",
    pestañas.join(", "),
  );

  /* ── Egresos ────────────────────────────────────────────────────── */

  console.log("\n— Egresos —");
  await js(ses, HELPERS);
  await js(ses, `__t.tab('Egresos')?.click()`);
  chequear(await esperarTexto("Nuevo egreso"), "abre la pestaña de egresos");
  await js(
    ses,
    `(() => {
      const [concepto, monto, fecha] = __t.inputs().length ? __t.inputs() : [...document.querySelectorAll('form input')];
      __t.escribir(concepto, 'Egreso de verificación');
      __t.escribir(monto, '12.5');
      const sel = document.querySelector('form select');
      const d = Object.getOwnPropertyDescriptor(sel.constructor.prototype, 'value');
      d.set.call(sel, 'servicios');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      __t.escribir(fecha, new Date().toISOString().slice(0, 10));
      document.querySelector('form').requestSubmit();
      return true;
    })()`,
  );
  chequear(await esperarTexto("Egreso de verificación", 25000), "el egreso cargado aparece en la lista");
  chequear(await js(ses, `document.body.innerText.includes('Egreso guardado')`), "confirma que se guardó");
  await js(ses, `__t.aria('Borrar Egreso de verificación')?.click()`);
  await dormir(400);
  await js(ses, `__t.boton('Borrar')?.click()`);
  chequear(await esperarSinTexto("Egreso de verificación", 25000), "se borra el egreso desde la lista");

  /* ── Pedidos y usuarios ─────────────────────────────────────────── */

  console.log("\n— Pedidos y usuarios —");
  await js(ses, HELPERS);
  await js(ses, `__t.tab('Pedidos')?.click()`);
  chequear(await esperarTexto("Correo sin configurar", 25000), "pedidos carga con el token");
  chequear(await esperarTexto(FOLIO), "el pedido de prueba aparece en la lista");
  chequear(!(await js(ses, `document.body.innerText.includes('No pudimos cargar')`)), "pedidos no muestra error");

  await js(ses, HELPERS);
  await js(ses, `__t.tab('Usuarios')?.click()`);
  await dormir(3000);
  chequear(!(await js(ses, `document.body.innerText.includes('No pudimos')`)), "usuarios carga sin error");

  /* ── Reparto ────────────────────────────────────────────────────── */

  console.log("\n— El dueño reparte un código —");
  await js(ses, HELPERS);
  await js(ses, `__t.tab('Pedidos')?.click()`);
  await esperarTexto(FOLIO);
  await js(
    ses,
    `(() => {
      const b = [...document.querySelectorAll('li > button')].find((x) => x.textContent.includes(${JSON.stringify(FOLIO)}));
      b?.click();
      return Boolean(b);
    })()`,
  );
  chequear(await esperarTexto("Repartir entre personas"), "al abrir el pedido aparece el reparto");
  await js(
    ses,
    `(() => {
      const i = document.querySelector('input[aria-label="Correo de la persona"]');
      if (!i) return false;
      __t.escribir(i, ${JSON.stringify(INVITADA)});
      return true;
    })()`,
  );
  await js(ses, `__t.boton('Crear su cuenta y enviar')?.click()`);
  chequear(await esperarTexto("no salió", 30000), "avisa que el correo no salió (apagado en la prueba)");
  const textoReparto = await cuerpo();
  chequear(/Usuario @\S+/.test(textoReparto), "muestra el usuario creado");
  chequear(/contraseña \S+/.test(textoReparto), "muestra la contraseña por defecto");

  store.olvidar("datos", "data/cuentas.json");
  store.olvidar("datos", "data/asignaciones.json");
  const creadas = await store.getJson("datos", "data/cuentas.json", []);
  const invitada = (Array.isArray(creadas) ? creadas : []).find((c) => c?.correo === INVITADA);
  chequear(Boolean(invitada), "la cuenta de la persona invitada existe en la base");
  chequear(CODIGOS.includes(invitada?.codigo), "la invitada quedó con un código del pedido");
  chequear(Boolean(invitada?.premiumDesde), "la invitada nace con Premium");

  /* ── La compradora ve y revoca ──────────────────────────────────── */

  console.log("\n— La compradora ve el reparto y lo revoca —");
  await ses.ev("Page.navigate", { url: BASE });
  await dormir(3000);
  await js(ses, `localStorage.setItem('bitly_pistas_cabecera', '1'); location.reload()`);
  await dormir(3500);
  await js(ses, HELPERS);
  await js(ses, `document.querySelector('[data-pista="cuenta"]')?.click()`);
  chequear(await esperarTexto("Iniciar sesión", 10000), "abre el acceso de la cuenta");
  await js(ses, HELPERS);
  await js(
    ses,
    `(() => {
      const [u, k] = __t.inputs();
      if (!u || !k) return false;
      __t.escribir(u, ${JSON.stringify(USUARIO)});
      __t.escribir(k, ${JSON.stringify(CLAVE)});
      __t.enviar();
      return true;
    })()`,
  );
  chequear(await esperarTexto("Códigos y personas", 25000), "la compradora ve sus códigos");
  const conReparto = (await cuerpo()).toLowerCase();
  chequear(conReparto.includes(INVITADA), "figura el correo de la persona");
  chequear(conReparto.includes("todavía no entró"), "marca que la persona todavía no entró");
  chequear((conReparto.match(/sin asignar/g) ?? []).length >= 1, "el otro código figura sin asignar");

  await js(ses, HELPERS);
  await js(ses, `__t.boton('Revocar y reasignar')?.click()`);
  chequear(await esperarTexto("Sí, revocar", 8000), "pide confirmación antes de revocar");
  await js(ses, `__t.boton('Sí, revocar')?.click()`);
  chequear(await esperarSinTexto(INVITADA, 30000), "el correo asignado desaparece de la lista");
  chequear(
    ((await cuerpo()).toLowerCase().match(/sin asignar/g) ?? []).length >= 2,
    "los dos códigos vuelven a estar libres",
  );

  store.olvidar("datos", "data/asignaciones.json");
  store.olvidar("datos", "data/cuentas.json");
  const reparto = await store.getJson("datos", "data/asignaciones.json", []);
  const mia = (Array.isArray(reparto) ? reparto : []).find((a) => a?.folio === FOLIO);
  chequear(mia?.estado === "revocada", "la asignación queda revocada en la base");
  const cuentasTras = await store.getJson("datos", "data/cuentas.json", []);
  const invitadaTras = (Array.isArray(cuentasTras) ? cuentasTras : []).find((c) => c?.correo === INVITADA);
  chequear(Boolean(invitadaTras?.eliminada), "la cuenta creada para esa persona queda dada de baja");

  console.log("\n— El código liberado se reutiliza —");
  const ingreso = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: ADMIN_CLAVE } });
  chequear(ingreso.ok, "el token del panel sirve para el reparto");
  const segundo = await asignaciones.asignarCodigos({
    data: { admin: ingreso.ok ? ingreso.token : "", folio: FOLIO, correos: [INVITADA_2] },
  });
  chequear(segundo.ok && segundo.asignadas.length === 1, "se reparte el código liberado a otra persona");
  chequear(
    segundo.ok && CODIGOS.includes(segundo.asignadas[0]?.codigo),
    "el código reasignado es uno del pedido",
  );

  /* ── Sesión ─────────────────────────────────────────────────────── */

  console.log("\n— Sesión del panel —");
  await ses.ev("Page.navigate", { url: `${BASE}/admin` });
  await dormir(3000);
  chequear(await esperarTexto("Panel Bitly", 25000), "al volver sigue adentro (token guardado)");
  await js(ses, HELPERS);
  await js(ses, `__t.aria('Cerrar sesión del panel')?.click()`);
  chequear(await esperarTexto("Panel del dueño", 15000), "salir vuelve al acceso");
  chequear(
    !(await js(ses, `Boolean(localStorage.getItem('bitly_admin_token'))`)),
    "salir borra el token",
  );

  const errores = await js(ses, `window.__errores ?? []`);
  chequear(errores.length === 0, "sin errores de página", errores.join(" | "));
} catch (e) {
  console.error("\nERROR:", e.message);
  fallos.push("excepción: " + e.message);
  try {
    console.log("  pantalla:", String(await cuerpo()).slice(0, 600).split("\n").join(" | "));
    console.log("  errores:", (await js(ses, `window.__errores ?? []`)).join(" | "));
  } catch {}
} finally {
  try {
    if (cuentasServer) {
      const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");
      await limpiarBase(store);
    }
  } catch (e) {
    console.error("no se pudo limpiar la base:", e.message);
  }
  await ses?.cerrar().catch(() => undefined);
  await chrome?.cerrar().catch(() => undefined);
  await cuentasServer?.close();
  await dev?.cerrar();
}

console.log(`\n${fallos.length === 0 ? "TODO OK" : `${fallos.length} fallas`}`);
if (fallos.length > 0) process.exit(1);
