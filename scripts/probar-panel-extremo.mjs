#!/usr/bin/env node
/**
 * Pruebas de abuso del panel y del servidor (no funcionales: intentan romperlas).
 *
 * Cubre lo que una suite normal no toca:
 *
 *   1. Tokens: firmados con otro secreto, vencidos, con el payload cambiado,
 *      truncados, gigantes, con `alg` inventado o con la clave vieja.
 *   2. Puertas: cada endpoint del panel y de los pedidos sin token, con token
 *      basura y con el token de OTRA persona.
 *   3. IDOR: un comprador queriendo leer o tocar los códigos y pedidos ajenos.
 *   4. Carreras: dos repartos simultáneos por el último código, dos revocaciones
 *      iguales, dos bajas de la misma cuenta, el mismo código de correo usado
 *      en paralelo.
 *   5. Entradas hostiles: 100 000 caracteres, control chars, HTML, emoji, nulos,
 *      montos negativos, NaN, fechas imposibles, `__proto__`.
 *   6. Límites: fuerza bruta de la clave del panel, de la contraseña de una
 *      cuenta, altas desde una misma IP y códigos de confirmación.
 *   7. Inundación: 200 lecturas y 200 intentos fallidos en paralelo.
 *
 * Usa los módulos reales con la base en memoria: no toca el repo de datos.
 *
 *   node scripts/probar-panel-extremo.mjs
 */

import crypto from "node:crypto";
import {
  ADMIN_CLAVE,
  ADMIN_CORREO,
  entornoPrueba,
  servidorDePrueba,
  stub,
} from "./pruebas/entorno.mjs";

const fallos = [];
const chequear = (ok, texto, extra) => {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
};

entornoPrueba();
delete process.env.BITLY_ADMIN_CODE;

const server = await servidorDePrueba({
  alias: [
    { find: /^@\/server\/github-store$/, replacement: stub("github-store.mjs") },
    { find: /^@\/server\/correo$/, replacement: stub("correo.mjs") },
  ],
});

const cuentas = await server.ssrLoadModule("/src/server/cuentas.ts");
const asignaciones = await server.ssrLoadModule("/src/server/asignaciones.ts");
const admin = await server.ssrLoadModule("/src/server/admin.ts");
const panel = await server.ssrLoadModule("/src/server/panel.ts");
const pedidos = await server.ssrLoadModule("/src/server/pedidos.ts");
const store = await server.ssrLoadModule("/scripts/pruebas/stubs/github-store.mjs");

/* ── Utilidades ────────────────────────────────────────────────────────── */

const ahora = new Date().toISOString();
const hoy = ahora.slice(0, 10);
let ip = "10.0.0.1";
const usarIp = (nueva) => {
  ip = nueva;
  globalThis.__IP = nueva;
};

function sembrar(ruta, valor) {
  (globalThis.__STORE ??= new Map()).set(ruta, JSON.stringify(valor));
}

const base64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function huellaClave(clave) {
  return base64url(crypto.createHash("sha256").update(`bitly-admin-clave-v1:${clave}`).digest()).slice(0, 16);
}

/** Token con el mismo formato que firma el sitio (para probar vencimiento). */
function firmarToken({ secreto, expira, clave, carga }) {
  const payload = Buffer.from(
    JSON.stringify(carga ?? { a: 1, e: expira, k: huellaClave(clave) }),
  );
  const firma = crypto.createHmac("sha256", `bitly-admin-v1:${secreto}`).update(payload).digest();
  return `${base64url(payload)}.${base64url(firma)}`;
}

const SECRETO = process.env.BITLY_ADMIN_SECRET;
const conTimeout = (promesa, ms = 8000) =>
  Promise.race([
    Promise.resolve(promesa).then((v) => ({ tipo: "ok", valor: v })),
    new Promise((ok) => setTimeout(() => ok({ tipo: "timeout" }), ms)),
  ]);

let A;
let B;
let tokenA;
let tokenB;
let tokenAdmin;

try {
  /* ── Preparación ───────────────────────────────────────────────────── */

  console.log("— Preparación —");
  sembrar("data/pedidos.json", []);
  sembrar("data/asignaciones.json", []);
  sembrar("data/cuentas.json", []);
  sembrar("data/codigos-emitidos.json", []);

  /** Crea la cuenta y la confirma con el código que "llegó" al correo. */
  async function crearCuenta(usuario, correo, clave) {
    const alta = await cuentas.registrarCuenta({
      data: { nombre: `Cuenta ${usuario}`, usuario, correo, clave },
    });
    if (!alta.ok || !alta.pendiente) return alta;
    const mensaje = [...(globalThis.__CORREOS ?? [])]
      .reverse()
      .find((c) => c.to === correo);
    const codigo = (String(mensaje?.text ?? "").match(/\b\d{6}\b/) ?? [])[0] ?? "";
    return cuentas.confirmarCuenta({ data: { identificador: correo, codigo } });
  }

  usarIp("10.0.0.10");
  const altaA = await crearCuenta("compradoraa", "a@prueba.test", "clave-a-2026");
  usarIp("10.0.0.11");
  const altaB = await crearCuenta("compradorb", "b@prueba.test", "clave-b-2026");
  chequear(altaA.ok && altaB.ok, "se crean dos cuentas");
  A = altaA.ok ? altaA.cuenta : null;
  B = altaB.ok ? altaB.cuenta : null;
  tokenA = altaA.ok ? altaA.token : "";
  tokenB = altaB.ok ? altaB.token : "";

  const pedido = (folio, cuentaId, codigos) => ({
    folio,
    token: `T-${folio}`,
    nombre: "Prueba",
    correo: "prueba@prueba.test",
    celular: "+59170000000",
    comprobante: "",
    tipoComprobante: "image/png",
    estado: "pagado",
    cantidad: codigos.length,
    total: 50,
    codigos,
    codigo: codigos[0],
    ventanaFin: ahora,
    nota: "",
    cuentaId,
    creado: ahora,
    actualizado: ahora,
  });

  sembrar("data/pedidos.json", [
    pedido("FLX-A1", A.id, ["CODE-A1"]),
    pedido("FLX-B1", B.id, ["CODE-B1", "CODE-B2"]),
    pedido("FLX-C1", A.id, ["CODE-C1"]),
  ]);

  const ingreso = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: ADMIN_CLAVE } });
  chequear(ingreso.ok, "el dueño entra al panel");
  tokenAdmin = ingreso.ok ? ingreso.token : "";

  /* ── 1. Tokens ─────────────────────────────────────────────────────── */

  console.log("\n— Tokens —");
  const conOtroSecreto = firmarToken({
    secreto: "otro-secreto-cualquiera",
    expira: Date.now() + 86_400_000,
    clave: ADMIN_CLAVE,
  });
  const vencido = firmarToken({ secreto: SECRETO, expira: Date.now() - 1000, clave: ADMIN_CLAVE });
  const delFuturo = firmarToken({ secreto: SECRETO, expira: Date.now() + 10 * 365 * 86_400_000, clave: ADMIN_CLAVE });
  const claveVieja = firmarToken({
    secreto: SECRETO,
    expira: Date.now() + 86_400_000,
    clave: "una-clave-que-ya-no-existe",
  });
  const sinBandera = firmarToken({
    secreto: SECRETO,
    expira: Date.now() + 86_400_000,
    clave: ADMIN_CLAVE,
    carga: { a: 0, e: Date.now() + 86_400_000, k: huellaClave(ADMIN_CLAVE) },
  });
  const expiraTexto = firmarToken({
    secreto: SECRETO,
    expira: Date.now() + 86_400_000,
    clave: ADMIN_CLAVE,
    carga: { a: 1, e: String(Date.now() + 86_400_000), k: huellaClave(ADMIN_CLAVE) },
  });

  const [payloadValido] = tokenAdmin.split(".");
  const firmaValida = tokenAdmin.split(".")[1];
  const casos = [
    ["vacío", ""],
    ["null", null],
    ["basura", "hola"],
    ["dos partes al azar", "abc.def"],
    ["firma de otro secreto", conOtroSecreto],
    ["vencido", vencido],
    ["expira en texto", expiraTexto],
    ["bandera a=0", sinBandera],
    ["huella de clave vieja", claveVieja],
    ["payload válido con otra firma", `${payloadValido}.${firmaValida.slice(0, -2)}xx`],
    ["firma válida con otro payload", `${Buffer.from('{"a":1}').toString("base64url")}.${firmaValida}`],
    ["token truncado", tokenAdmin.slice(0, -10)],
    ["token gigante", `${tokenAdmin}.${"x".repeat(2000)}`],
    ["solo el payload", payloadValido],
    ["base64 roto", "!!!.???"],
  ];
  for (const [nombre, valor] of casos) {
    const r = await panel.resumenPanel({ data: { admin: valor } });
    chequear(r === null, `el resumen rechaza el token ${nombre}`);
  }
  // Un token firmado con el secreto real es válido aunque su `e` sea lejano: el
  // TTL sólo lo respeta quien firma. Lo que importa es que NO se pueda firmar sin
  // el secreto (probado arriba) ni reusar uno de una clave anterior.
  const conFuturo = await panel.resumenPanel({ data: { admin: delFuturo } });
  chequear(Boolean(conFuturo), "un token firmado por el servidor con vencimiento lejano se acepta");
  chequear(Boolean(await panel.resumenPanel({ data: { admin: tokenAdmin } })), "el token legítimo sí sirve");

  // Cambiar la clave invalida los tokens ya emitidos.
  process.env.BITLY_ADMIN_CLAVE = "clave-rotada-2026";
  chequear(
    (await panel.resumenPanel({ data: { admin: tokenAdmin } })) === null,
    "al rotar la clave los tokens viejos mueren",
  );
  process.env.BITLY_ADMIN_CLAVE = ADMIN_CLAVE;

  /* ── 2. Puertas ────────────────────────────────────────────────────── */

  console.log("\n— Puertas sin token —");
  const puertas = [
    ["resumenPanel", () => panel.resumenPanel({ data: {} })],
    ["listarEgresos", () => panel.listarEgresos({ data: {} })],
    ["resumenCodigos", () => pedidos.resumenCodigos?.({ data: {} })],
    ["adminPedidos", () => pedidos.adminPedidos({ data: {} })],
    ["adminCuentas", () => cuentas.adminCuentas({ data: {} })],
    ["asignarCodigos", () => asignaciones.asignarCodigos({ data: { folio: "FLX-A1", correos: ["x@prueba.test"] } })],
    ["revocarAsignacion", () => asignaciones.revocarAsignacion({ data: { id: "abc" } })],
    [
      "actualizarPedido",
      () => pedidos.actualizarPedido({ data: { folio: "FLX-A1", estado: "cancelado" } }),
    ],
    ["eliminarPedido", () => pedidos.eliminarPedido({ data: { folio: "FLX-A1" } })],
  ];
  for (const [nombre, llamar] of puertas) {
    const r = await conTimeout(llamar());
    const cerrado =
      r.tipo === "ok" && (r.valor === null || (typeof r.valor === "object" && r.valor.ok === false));
    chequear(cerrado, `${nombre} queda cerrado sin token`, r.tipo === "ok" ? JSON.stringify(r.valor)?.slice(0, 80) : r.tipo);
  }

  const pedidoSigue = (await store.getJson("datos", "data/pedidos.json", []))[0];
  chequear(pedidoSigue?.estado === "pagado", "el pedido no cambió con los intentos sin token");

  /* ── 3. IDOR entre compradores ─────────────────────────────────────── */

  console.log("\n— Un comprador no toca lo ajeno —");
  const roba = await asignaciones.asignarCodigos({
    data: { token: tokenB, folio: "FLX-A1", correos: ["ladron@prueba.test"] },
  });
  chequear(!roba.ok && roba.motivo === "no_es_tu_pedido", "B no puede repartir el pedido de A");

  const repartoB = await asignaciones.asignarCodigos({
    data: { token: tokenB, folio: "FLX-B1", correos: ["amigo@prueba.test"] },
  });
  chequear(repartoB.ok, "B sí reparte su propio pedido");
  const idAjeno = repartoB.ok ? repartoB.asignadas[0].codigo : "";

  const listaA = await asignaciones.misCodigos({ data: { token: tokenA } });
  chequear(
    listaA.ok && !JSON.stringify(listaA).includes(idAjeno),
    "A no ve el reparto de B en «mis códigos»",
  );

  const repartoA = await asignaciones.asignarCodigos({
    data: { token: tokenA, folio: "FLX-A1", correos: ["amigo.a@prueba.test"] },
  });
  chequear(repartoA.ok, "A reparte su único código");
  const asignacionA = repartoA.ok ? repartoA.asignadas[0] : null;

  const revocaAjena = await asignaciones.revocarAsignacion({
    data: { token: tokenA, id: "00000000" },
  });
  chequear(!revocaAjena.ok && revocaAjena.motivo === "no_encontrada", "un id inventado no revoca nada");

  const bajaAjena = await cuentas.eliminarCuenta({ data: { token: tokenA, clave: "clave-b-2026" } });
  chequear(!bajaAjena.ok && bajaAjena.motivo === "clave", "A no puede dar de baja a B con su clave");
  const dbgCuentas = await store.getJson("datos", "data/cuentas.json", []);
  chequear(
    dbgCuentas.some((c) => c.correo === "b@prueba.test" && !c.eliminada),
    "la cuenta de B sigue viva",
  );

  const cambioAjeno = await cuentas.confirmarCambio({
    data: { token: tokenB, tipo: "usuario", codigo: "123456", claveNueva: "otra-clave-2026" },
  });
  chequear(!cambioAjeno.ok, "B no puede confirmar un cambio que no pidió");
  chequear(Boolean(asignacionA), "el reparto de A quedó registrado");

  /* ── 4. Carreras ───────────────────────────────────────────────────── */

  console.log("\n— Carreras —");
  // Cuatro personas pidiendo el único código de un pedido a la vez.
  const carreras = await Promise.all(
    ["x1@prueba.test", "x2@prueba.test", "x3@prueba.test", "x4@prueba.test"].map((correo) =>
      asignaciones.asignarCodigos({ data: { admin: tokenAdmin, folio: "FLX-C1", correos: [correo] } }),
    ),
  );
  const exitos = carreras.filter((r) => r.ok && r.asignadas.length > 0).length;
  chequear(exitos <= 1, "sólo un reparto gana el último código", `ganaron ${exitos}`);
  chequear(
    carreras.every((r) => r && typeof r.ok === "boolean"),
    "las cuatro carreras responden sin excepción",
  );
  const dbgTrasCarrera = await store.getJson("datos", "data/cuentas.json", []);
  const cuentasConCodigo = dbgTrasCarrera.filter((c) => c.codigo === "CODE-C1" && !c.eliminada);
  chequear(
    cuentasConCodigo.length === 1,
    "el código no quedó duplicado en dos cuentas",
    `cuentas con CODE-C1: ${cuentasConCodigo.length}`,
  );

  // Dos revocaciones iguales a la vez: idempotentes, sin excepción.
  const repartoRev = await asignaciones.asignarCodigos({
    data: { admin: tokenAdmin, folio: "FLX-B1", correos: ["revo@prueba.test"] },
  });
  const idRev = repartoRev.ok ? repartoRev.asignadas[0]?.codigo : "";
  const asignacionesAhora = await store.getJson("datos", "data/asignaciones.json", []);
  const asignacionRev = asignacionesAhora.find((a) => a.correo === "revo@prueba.test");
  const revocaciones = await Promise.all([
    asignaciones.revocarAsignacion({ data: { admin: tokenAdmin, id: asignacionRev?.id } }),
    asignaciones.revocarAsignacion({ data: { admin: tokenAdmin, id: asignacionRev?.id } }),
    asignaciones.revocarAsignacion({ data: { admin: tokenAdmin, id: asignacionRev?.id } }),
  ]);
  chequear(
    revocaciones.every((r) => r && typeof r.ok === "boolean"),
    "revocar en paralelo no rompe nada",
    revocaciones.map((r) => r.ok).join(","),
  );
  chequear(revocaciones.every((r) => r.ok), "las tres revocaciones responden ok (idempotente)");

  // El mismo código de correo, cinco veces en paralelo: uno solo debe aplicarse.
  usarIp("10.0.0.40");
  const solicitud = await cuentas.solicitarCambio({
    data: { token: tokenB, tipo: "usuario", valor: "usuariob2" },
  });
  chequear(solicitud.ok, "B pide cambiar de usuario");
  const codigoCorreo = String(
    (globalThis.__CORREOS ?? [])
      .map((c) => String(c.text ?? ""))
      .map((t) => (t.match(/\b\d{6}\b/) ?? [])[0])
      .filter(Boolean)
      .at(-1) ?? "",
  );
  const confirmaciones = await Promise.all(
    Array.from({ length: 5 }, () =>
      cuentas.confirmarCambio({
        data: { token: tokenB, tipo: "usuario", codigo: codigoCorreo, claveNueva: "clave-b-2026" },
      }),
    ),
  );
  chequear(
    confirmaciones.every((r) => r && typeof r.ok === "boolean"),
    "confirmar el mismo código en paralelo no rompe nada",
  );

  // Dos bajas de la misma cuenta a la vez.
  usarIp("10.0.0.41");
  const bajas = await Promise.all([
    cuentas.eliminarCuenta({ data: { token: tokenB, clave: "clave-b-2026" } }),
    cuentas.eliminarCuenta({ data: { token: tokenB, clave: "clave-b-2026" } }),
  ]);
  chequear(
    bajas.every((r) => r && typeof r.ok === "boolean"),
    "dos bajas simultáneas responden sin excepción",
  );
  chequear(bajas.filter((r) => r.ok).length <= 1, "la cuenta no se da de baja dos veces");

  /* ── 5. Entradas hostiles ──────────────────────────────────────────── */

  console.log("\n— Entradas hostiles —");
  const largo = "A".repeat(100_000);
  const hostiles = [
    ["100k caracteres", largo],
    ["control chars", "\u0000\u0001\u0007\u001f\u007f"],
    ["html y script", "<script>alert(1)</script><img src=x onerror=alert(1)>"],
    ["emoji y rtl", "🔥🎵 \u202E abc"],
    ["nulos y saltos", "a\u0000b\nc\r\nd"],
    ["inyección de plantilla", "${7*7}{{7*7}}%s%d"],
  ];
  for (const [nombre, valor] of hostiles) {
    const r = await panel.crearEgreso({
      data: { admin: tokenAdmin, concepto: valor, monto: 10, categoria: "otros", fecha: hoy },
    });
    chequear(r && typeof r.ok === "boolean", `un egreso con ${nombre} se responde sin excepción`);
  }
  const egresos = await panel.listarEgresos({ data: { admin: tokenAdmin } });
  const guardado = egresos?.find((e) => String(e.concepto).includes("100k") || e.concepto.length > 50);
  chequear(!guardado || guardado.concepto.length <= 120, "el concepto se recorta, no se guarda entero", guardado?.concepto.length);
  chequear(
    (egresos ?? []).every((e) => typeof e.concepto === "string" && e.concepto.length <= 120),
    "ningún concepto queda con 100 000 caracteres",
  );

  const montosRaros = [
    ["negativo", -5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["1e15", 1e15],
    ["texto", "no-es-un-numero"],
    ["null", null],
  ];
  for (const [nombre, monto] of montosRaros) {
    const r = await panel.crearEgreso({
      data: { admin: tokenAdmin, concepto: "monto raro", monto, categoria: "otros", fecha: hoy },
    });
    chequear(!r.ok && r.motivo === "datos", `un monto ${nombre} se rechaza`);
  }

  const fechasRaras = ["9999-99-99", "0000-00-00", "2026-13-01", "", null, "ayer"];
  for (const fecha of fechasRaras) {
    const r = await panel.crearEgreso({
      data: { admin: tokenAdmin, concepto: "fecha rara", monto: 10, categoria: "otros", fecha },
    });
    chequear(!r.ok && r.motivo === "datos", `la fecha ${JSON.stringify(fecha)} se rechaza`);
  }

  const proto = JSON.parse('{"admin":"x","__proto__":{"polluted":true},"concepto":"proto"}');
  await panel.crearEgreso({ data: { ...proto, monto: 10, categoria: "otros", fecha: hoy } });
  chequear(({}).polluted === undefined, "un payload con __proto__ no contamina Object");

  const correosRaros = ["a@b", "a b@c.com", `${"a".repeat(300)}@x.com`, "sin-arroba", "@x.com", "a@.com"];
  for (const correo of correosRaros) {
    const r = await asignaciones.asignarCodigos({
      data: { admin: tokenAdmin, folio: "FLX-B1", correos: [correo] },
    });
    chequear(r && r.ok === false, `el correo ${correo.slice(0, 20)}… se rechaza sin romper`);
  }

  const usuariosRaros = ["", "a", "con espacio", "ÑANDÚ", `${"x".repeat(100)}`, "admin'--"];
  for (const usuario of usuariosRaros) {
    const r = await cuentas.solicitarCambio({
      data: { token: tokenA, tipo: "usuario", valor: usuario },
    });
    chequear(r && typeof r.ok === "boolean", `el usuario ${JSON.stringify(usuario).slice(0, 20)} no rompe`, r.motivo);
  }

  /* ── 6. Límites ────────────────────────────────────────────────────── */

  console.log("\n— Límites —");
  usarIp("10.0.0.50");
  let bloqueo = null;
  for (let i = 0; i < 8; i++) {
    const r = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: `mal-${i}` } });
    if (r.motivo === "cupo") {
      bloqueo = i + 1;
      break;
    }
  }
  chequear(bloqueo === 6, "la clave del panel se bloquea al sexto intento fallido", `bloqueó en ${bloqueo}`);
  chequear(
    (await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: ADMIN_CLAVE } })).motivo === "cupo",
    "ni con la clave correcta pasa el bloqueo",
  );
  usarIp("10.0.0.51");
  chequear(
    (await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: ADMIN_CLAVE } })).ok,
    "otra IP no hereda el bloqueo",
  );

  usarIp("10.0.0.60");
  const cuentaLimite = await crearCuenta("limite1", "limite1@prueba.test", "clave-limite-2026");
  chequear(cuentaLimite.ok, "se crea una cuenta para probar el cupo");
  const tokenLimite = cuentaLimite.ok ? cuentaLimite.token : "";
  const fallosClave = [];
  for (let i = 0; i < 7; i++) {
    fallosClave.push(
      (await cuentas.iniciarSesion({ data: { identificador: "limite1", clave: `mala-${i}` } })).ok,
    );
  }
  chequear(fallosClave.every((ok) => ok === false), "7 contraseñas erradas nunca entran");
  const trasFallos = await cuentas.iniciarSesion({ data: { identificador: "limite1", clave: "clave-limite-2026" } });
  chequear(trasFallos.ok || trasFallos.motivo === "limite", "tras la ráfaga responde ok o límite, no entra a ciegas", trasFallos.motivo);

  let registros = 0;
  usarIp("10.0.0.70");
  for (let i = 0; i < 8; i++) {
    const r = await cuentas.registrarCuenta({
      data: {
        nombre: "Rafaga",
        usuario: `rafaga${i}`,
        correo: `rafaga${i}@prueba.test`,
        clave: "clave-rafaga-2026",
      },
    });
    if (r.ok) registros++;
    else if (r.motivo === "limite") break;
  }
  chequear(registros <= 6, "las altas desde una misma IP tienen tope", `se crearon ${registros}`);
  usarIp("10.0.0.71");
  chequear(
    (await cuentas.registrarCuenta({
      data: { nombre: "Otra", usuario: "otraip", correo: "otraip@prueba.test", clave: "clave-otra-2026" },
    })).ok,
    "otra IP puede registrarse aunque la anterior esté topada",
  );

  /* ── 7. Inundación ─────────────────────────────────────────────────── */

  console.log("\n— Inundación —");
  const lecturas = await Promise.all(
    Array.from({ length: 200 }, (_, i) =>
      panel.resumenPanel({ data: { admin: i % 2 ? tokenAdmin : "token-invalido" } }),
    ),
  );
  chequear(
    lecturas.filter((r) => r === null).length === 100 && lecturas.filter(Boolean).length === 100,
    "200 resúmenes en paralelo: 100 válidos y 100 rechazados, sin excepciones",
  );

  usarIp("10.0.0.80");
  const intentos = await Promise.all(
    Array.from({ length: 200 }, () =>
      admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: "fuerza-bruta" } }),
    ),
  );
  chequear(
    intentos.every((r) => r && r.ok === false),
    "200 intentos de fuerza bruta: ninguno entra",
  );
  chequear(
    intentos.filter((r) => r.motivo === "cupo").length > 190,
    "la mayoría queda cortada por el cupo, no evaluada",
    `${intentos.filter((r) => r.motivo === "cupo").length}/200`,
  );

  const mixtas = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0
        ? cuentas.miCuenta({ data: { token: tokenA } })
        : i % 3 === 1
          ? asignaciones.misCodigos({ data: { token: tokenA } })
          : panel.listarEgresos({ data: { admin: tokenAdmin } }),
    ),
  );
  chequear(
    mixtas.every((r) => r !== undefined && r !== null),
    "100 llamadas mezcladas con token válido responden todas",
  );

  console.log("\n— Lo que quedó sano —");
  const cuentasFinal = await store.getJson("datos", "data/cuentas.json", []);
  chequear(
    cuentasFinal.every((c) => typeof c?.hash === "string" && !JSON.stringify(c).includes("clave-a-2026")),
    "ninguna cuenta guarda la contraseña en claro",
  );
  chequear(
    cuentasFinal.every((c) => !c?.clavePorDefecto || c?.origen === "invitada"),
    "sólo las invitadas nacen con contraseña por defecto",
  );
  const pedidosFinal = await store.getJson("datos", "data/pedidos.json", []);
  chequear(pedidosFinal.length === 3, "los intentos hostiles no borraron pedidos", pedidosFinal.length);
} catch (e) {
  console.error("\nEXCEPCIÓN:", e?.stack ?? e);
  fallos.push("excepción: " + (e?.message ?? e));
} finally {
  await server.close();
}

console.log(`\n${fallos.length === 0 ? "✓ Extremo: todo en verde" : `✗ ${fallos.length} fallas`}`);
if (fallos.length > 0) {
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
