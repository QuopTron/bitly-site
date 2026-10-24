#!/usr/bin/env node
/**
 * Verificación en navegador del cambio de contraseña y de usuario.
 *
 * El correo sale por un webhook local: el script lee el código de 6 dígitos del
 * mensaje y lo escribe en el modal, como haría alguien con su correo abierto.
 * Después comprueba que la contraseña vieja deja de servir, que la nueva entra,
 * y lo mismo con el usuario.
 *
 * Necesita Chrome y un `.env` con el token del repo de datos.
 *
 *   node scripts/verificar-cambio.mjs
 */

import http from "node:http";
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
const USUARIO = `cambio${sello}`;
const USUARIO_NUEVO = `nuevo${sello}`;
const CORREO = `${USUARIO}@prueba.test`;
const CLAVE = "prueba-cambio-2026";
const CLAVE_NUEVA = "clave-nueva-2026";
const PUERTO = 3011;
const PUERTO_BUZON = 4999;
const BASE = `http://localhost:${PUERTO}`;

const fallos = [];
const chequear = (ok, texto, extra) => {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
};

/* ── Buzón local que recibe los correos del dev server ─────────────────── */

const correos = [];
const buzon = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (t) => (cuerpo += t));
  req.on("end", () => {
    try {
      correos.push(JSON.parse(cuerpo));
    } catch {
      correos.push({ to: "", subject: "", text: cuerpo, html: "" });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
});
await new Promise((ok) => buzon.listen(PUERTO_BUZON, "127.0.0.1", ok));

/** Último código de 6 dígitos enviado a ese correo. */
async function codigoDe(correo, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    const mensaje = [...correos]
      .reverse()
      .find((c) => String(c?.to ?? "").toLowerCase() === correo);
    const codigo = (String(mensaje?.text ?? "").match(/\b\d{6}\b/) ?? [])[0];
    if (codigo) return codigo;
    await dormir(250);
  }
  return "";
}

const HELPERS = `
  window.__t = {
    dialogos: () => [...document.querySelectorAll('[role=dialog]')],
    dialogo: () => __t.dialogos().find((d) => /Entrar|Crear cuenta|Cerrar sesión|@/.test(d.innerText)) ?? null,
    escribir: (el, valor) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      d.set.call(el, valor);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    inputs: () => [...(__t.dialogo()?.querySelectorAll('input') ?? [])],
    boton: (txt) => [...(__t.dialogo()?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent.trim().toLowerCase().includes(txt.toLowerCase())),
    codigo: () => __t.inputs().find((x) => x.getAttribute('inputmode') === 'numeric' || x.getAttribute('autocomplete') === 'one-time-code'),
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
const cuerpo = () => js(ses, `__t.dialogo()?.innerText ?? document.body.innerText`);

async function abrirCuenta() {
  await ses.ev("Page.navigate", { url: BASE });
  await dormir(3000);
  // El recorrido de bienvenida tapa la cabecera la primera vez.
  await js(ses, `localStorage.setItem('bitly_pistas_cabecera', '1'); location.reload()`);
  await dormir(3500);
  await js(ses, HELPERS);
  await js(ses, `document.querySelector('[data-pista="cuenta"]')?.click()`);
  return esperarTexto("Iniciar sesión", 10000);
}

async function entrar(usuario, clave) {
  await js(ses, HELPERS);
  return js(
    ses,
    `(() => {
      const [u, k] = __t.inputs();
      if (!u || !k) return false;
      __t.escribir(u, ${JSON.stringify(usuario)});
      __t.escribir(k, ${JSON.stringify(clave)});
      __t.dialogo()?.querySelector('form')?.requestSubmit();
      return true;
    })()`,
  );
}

let dev;
let chrome;
let cuentasServer;
try {
  console.log("— Siembra —");
  entornoPrueba();
  cuentasServer = await servidorDePrueba();
  const cuentas = await cuentasServer.ssrLoadModule("/src/server/cuentas.ts");
  const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");

  store.olvidar("datos", "data/cuentas.json");
  const alta = await cuentas.registrarCuenta({
    data: { nombre: "Cuenta de prueba", usuario: USUARIO, correo: CORREO, clave: CLAVE },
  });
  chequear(alta.ok && Boolean(alta.token), "se crea la cuenta de prueba", alta.ok ? "" : alta.motivo);
  if (!alta.ok) throw new Error("sin cuenta no se puede probar");

  console.log("\n— Arranca el dev server con correo por webhook —");
  dev = await levantarDev({
    puerto: PUERTO,
    extra: { BITLY_EMAIL_WEBHOOK: `http://127.0.0.1:${PUERTO_BUZON}/correo` },
  });
  chequear(Boolean(dev), `dev server en ${BASE}`);

  chrome = await abrirChrome({
    puerto: 9344,
    perfil: path.join(raiz, "scripts/.cache/perfil-verificar-cambio"),
  });
  ses = await nuevaSesion(chrome.browser, { w: 1280, h: 950, dpr: 1 });

  console.log("\n— Cambiar contraseña —");
  chequear(await abrirCuenta(), "abre «Mi cuenta»");
  chequear(await entrar(USUARIO, CLAVE), "entra con la contraseña actual");
  chequear(await esperarTexto(`@${USUARIO}`), "la sesión muestra el usuario");

  await js(ses, HELPERS);
  await js(ses, `__t.boton('Cambiar contraseña')?.click()`);
  chequear(await esperarTexto("contraseña actual"), "abre el formulario de cambio de contraseña");

  await js(ses, HELPERS);
  const lleno = await js(
    ses,
    `(() => {
      const [actual, nueva, repetir] = __t.inputs().filter((i) => i.type === 'password');
      if (!actual || !nueva || !repetir) return false;
      __t.escribir(actual, ${JSON.stringify(CLAVE)});
      __t.escribir(nueva, ${JSON.stringify(CLAVE_NUEVA)});
      __t.escribir(repetir, ${JSON.stringify(CLAVE_NUEVA)});
      return true;
    })()`,
  );
  chequear(lleno, "completa contraseña actual, nueva y repetición");
  await js(ses, `__t.boton('Enviar código')?.click()`);
  chequear(await esperarTexto("código de 6 dígitos"), "avisa que el código salió al correo");

  const codigo = await codigoDe(CORREO);
  chequear(/^\d{6}$/.test(codigo), "el correo con el código llegó", codigo);
  chequear(correos.some((c) => String(c?.html ?? "").includes("Bitly")), "el mensaje viene con el marco del sitio");

  await js(ses, HELPERS);
  await js(
    ses,
    `(() => {
      const i = __t.codigo();
      if (!i) return false;
      __t.escribir(i, ${JSON.stringify(codigo)});
      return true;
    })()`,
  );
  chequear((await js(ses, `__t.codigo()?.value ?? ''`)) === codigo, "el código queda escrito en el campo");
  chequear(
    (await js(ses, `__t.boton('Confirmar cambio')?.disabled ?? true`)) === false,
    "el botón de confirmar se habilita",
  );
  await js(ses, `__t.boton('Confirmar cambio')?.click()`);
  chequear(await esperarTexto("Cambiar contraseña", 20000), "el cambio se aplica y vuelve a la cuenta");
  chequear(!(await cuerpo()).toLowerCase().includes("no es"), "no muestra error de código");

  console.log("\n— La contraseña vieja deja de servir —");
  store.olvidar("datos", "data/cuentas.json");
  const vieja = await cuentas.iniciarSesion({ data: { identificador: USUARIO, clave: CLAVE } });
  chequear(!vieja.ok, "entrar con la contraseña vieja ya no funciona", vieja.ok ? "" : vieja.motivo);
  const nueva = await cuentas.iniciarSesion({ data: { identificador: USUARIO, clave: CLAVE_NUEVA } });
  chequear(nueva.ok, "la contraseña nueva sí entra", nueva.ok ? "" : nueva.motivo);

  console.log("\n— Cambiar usuario —");
  await ses.ev("Page.navigate", { url: BASE });
  await dormir(3000);
  await js(ses, HELPERS);
  await js(ses, `document.querySelector('[data-pista="cuenta"]')?.click()`);
  await dormir(1500);
  if (await esperarTexto("Iniciar sesión", 5000)) {
    chequear(await entrar(USUARIO, CLAVE_NUEVA), "vuelve a entrar con la contraseña nueva");
    chequear(await esperarTexto(`@${USUARIO}`), "la sesión es la misma cuenta");
  }

  await js(ses, HELPERS);
  await js(ses, `__t.boton('Cambiar usuario')?.click()`);
  chequear(await esperarTexto("usuario nuevo"), "abre el formulario de cambio de usuario");
  await js(ses, HELPERS);
  await js(
    ses,
    `(() => {
      const i = __t.inputs().find((x) => (x.maxLength || 0) === 20 && x.type === 'text');
      if (!i) return false;
      __t.escribir(i, ${JSON.stringify(USUARIO_NUEVO)});
      return true;
    })()`,
  );
  await js(ses, `__t.boton('Enviar código')?.click()`);
  chequear(await esperarTexto("código de 6 dígitos"), "el segundo código también sale");

  let codigo2 = codigo;
  for (let i = 0; i < 40 && codigo2 === codigo; i++) {
    const ultimo = [...correos].reverse()[0];
    codigo2 = (String(ultimo?.text ?? "").match(/\b\d{6}\b/) ?? [])[0] ?? codigo;
    if (codigo2 === codigo) await dormir(250);
  }
  chequear(/^\d{6}$/.test(codigo2), "llegó el código del cambio de usuario", codigo2);
  chequear(codigo2 !== codigo, "es un código distinto al anterior");

  await js(ses, HELPERS);
  await js(
    ses,
    `(() => {
      const i = __t.codigo();
      if (!i) return false;
      __t.escribir(i, ${JSON.stringify(codigo2)});
      return true;
    })()`,
  );
  await js(ses, `__t.boton('Confirmar cambio')?.click()`);
  chequear(await esperarTexto(`@${USUARIO_NUEVO}`), "el modal muestra el usuario nuevo");

  store.olvidar("datos", "data/cuentas.json");
  const porUsuarioViejo = await cuentas.iniciarSesion({
    data: { identificador: USUARIO, clave: CLAVE_NUEVA },
  });
  chequear(!porUsuarioViejo.ok, "el usuario viejo ya no entra");
  const porUsuarioNuevo = await cuentas.iniciarSesion({
    data: { identificador: USUARIO_NUEVO, clave: CLAVE_NUEVA },
  });
  chequear(porUsuarioNuevo.ok, "el usuario nuevo entra con su contraseña");

  const errores = await js(ses, `window.__errores ?? []`);
  chequear(errores.length === 0, "sin errores de página", errores.join(" | "));
} catch (e) {
  console.error("\nERROR:", e.message);
  fallos.push("excepción: " + e.message);
  try {
    console.log("  pantalla:", String(await cuerpo()).slice(0, 700).split("\n").join(" | "));
    console.log("  errores:", (await js(ses, `window.__errores ?? []`)).join(" | "));
  } catch {}
} finally {
  try {
    if (cuentasServer) {
      const store = await cuentasServer.ssrLoadModule("/src/server/github-store.ts");
      store.olvidar("datos", "data/cuentas.json");
      const lista = await store.getJson("datos", "data/cuentas.json", []);
      const quedan = (Array.isArray(lista) ? lista : []).filter((c) => c?.correo !== CORREO);
      if (quedan.length !== (lista ?? []).length) {
        await store.putJson("datos", "data/cuentas.json", quedan, "prueba: limpia la cuenta del cambio");
      }
    }
  } catch (e) {
    console.error("no se pudo limpiar:", e.message);
  }
  await ses?.cerrar().catch(() => undefined);
  await chrome?.cerrar().catch(() => undefined);
  await cuentasServer?.close();
  await dev?.cerrar();
  await new Promise((ok) => buzon.close(ok));
}

console.log(`\n${fallos.length === 0 ? "TODO OK" : `${fallos.length} fallas`}`);
if (fallos.length > 0) process.exit(1);
