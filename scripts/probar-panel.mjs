#!/usr/bin/env node
/**
 * Suite del panel del dueño (sin navegador).
 *
 * Usa los módulos REALES de `admin` y `panel` (login, token, egresos, resumen)
 * con la base en memoria. Comprueba lo que el panel muestra y, sobre todo, que
 * sin token válido no entrega nada.
 *
 *   node scripts/probar-panel.mjs
 */

import path from "node:path";
import { ADMIN_CORREO, entornoPrueba, servidorDePrueba, stub } from "./pruebas/entorno.mjs";

entornoPrueba();
delete process.env.BITLY_ADMIN_CODE;

const server = await servidorDePrueba({
  alias: [{ find: /^@\/server\/github-store$/, replacement: stub("github-store.mjs") }],
});

const fallos = [];
function chequear(ok, texto, extra) {
  console.log(`${ok ? "  ok" : "  FALLA"} · ${texto}${extra !== undefined ? ` · ${extra}` : ""}`);
  if (!ok) fallos.push(texto);
}

const CLAVE = process.env.BITLY_ADMIN_CLAVE;
const mes = new Date().toISOString().slice(0, 7);
const ahora = new Date().toISOString();

function sembrar(ruta, valor) {
  (globalThis.__STORE ??= new Map()).set(ruta, JSON.stringify(valor));
}

function ip(nombre) {
  globalThis.__IP = nombre;
}

sembrar("data/pedidos.json", [
  { folio: "AA111", nombre: "Ana", estado: "pagado", total: 100, cantidad: 1, creado: `${mes}-02T10:00:00.000Z`, actualizado: `${mes}-03T10:00:00.000Z` },
  { folio: "BB222", nombre: "Beto", estado: "enviado", total: 50, cantidad: 2, creado: `${mes}-05T10:00:00.000Z`, actualizado: `${mes}-06T10:00:00.000Z` },
  { folio: "CC333", nombre: "Carla", estado: "revision", total: 30, cantidad: 1, creado: `${mes}-07T10:00:00.000Z`, actualizado: `${mes}-07T10:00:00.000Z` },
  { folio: "DD444", nombre: "Dani", estado: "cancelado", total: 999, cantidad: 1, creado: `${mes}-01T10:00:00.000Z`, actualizado: `${mes}-01T10:00:00.000Z` },
]);
sembrar("data/cuentas.json", [
  { id: "c1", creado: `${mes}-01T00:00:00.000Z`, codigo: "CODIGO-1", ultimaActividad: ahora },
  { id: "c2", creado: `${mes}-02T00:00:00.000Z`, codigo: null, ultimaActividad: "2020-01-01T00:00:00.000Z" },
  { id: "c3", creado: `${mes}-03T00:00:00.000Z`, eliminada: true },
]);
sembrar("data/vistas.json", { visitas: 42 });
sembrar("data/opiniones.json", [{}, {}]);
sembrar("data/analytics.json", {
  sesiones: { a: { ultimo: ahora, segundos: 30 }, b: { ultimo: "2020-01-01T00:00:00.000Z", segundos: 10 } },
});
globalThis.__STATS = { windows: 2, android: 3, actualizado: ahora };

try {
  const admin = await server.ssrLoadModule("/src/server/admin.ts");
  const panel = await server.ssrLoadModule("/src/server/panel.ts");

  console.log("— Acceso —");
  ip("acceso");
  const sinDatos = await admin.entrarPanel({ data: { correo: "", clave: "" } });
  chequear(!sinDatos.ok && sinDatos.motivo === "datos", "con campos vacíos no entra");

  const correoMalo = await admin.entrarPanel({ data: { correo: "otro@correo.com", clave: CLAVE } });
  chequear(!correoMalo.ok && correoMalo.motivo === "clave", "con otro correo no entra");

  const claveMala = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: "otra-clave" } });
  chequear(!claveMala.ok && claveMala.motivo === "clave", "con otra clave no entra");

  const ingreso = await admin.entrarPanel({
    data: { correo: "  FLOXDEV2024@gmail.COM ", clave: CLAVE },
  });
  chequear(ingreso.ok && Boolean(ingreso.token), "con el correo y la clave correctos entra");
  chequear(
    ingreso.ok && Date.parse(ingreso.expira) > Date.now() + 6 * 86_400_000,
    "el token dura 7 días",
  );
  chequear(ingreso.ok && ingreso.correo === ADMIN_CORREO, "devuelve el correo del dueño");
  const token = ingreso.ok ? ingreso.token : "";

  console.log("\n— El token es obligatorio —");
  const sinToken = await panel.resumenPanel({ data: {} });
  chequear(sinToken === null, "sin token el resumen no sale");
  const basura = await panel.resumenPanel({ data: { admin: "ADMIN-PRUEBA" } });
  chequear(basura === null, "el código viejo en texto plano ya no sirve");
  const roto = await panel.resumenPanel({ data: { admin: token.slice(0, -3) + "abc" } });
  chequear(roto === null, "un token con la firma cambiada no sirve");
  const egresoAjeno = await panel.crearEgreso({
    data: { admin: "ADMIN-PRUEBA", concepto: "intruso", monto: 5, categoria: "otros", fecha: ahora.slice(0, 10) },
  });
  chequear(!egresoAjeno.ok && egresoAjeno.motivo === "admin", "sin token no se puede cargar un egreso");
  const listaCerrada = await panel.listarEgresos({ data: { admin: "x" } });
  chequear(listaCerrada === null, "sin token no se listan los egresos");

  console.log("\n— Resumen con datos sembrados —");
  const resumen = await panel.resumenPanel({ data: { admin: token } });
  chequear(Boolean(resumen), "con token el resumen sale");
  if (resumen) {
    chequear(resumen.ingresos.total === 150, "ingresos = pedidos pagados + enviados (150)", resumen.ingresos.total);
    chequear(resumen.ingresos.mes === 150, "los 150 son de este mes", resumen.ingresos.mes);
    chequear(resumen.ingresos.pedidos === 2, "cuenta 2 pedidos cobrados", resumen.ingresos.pedidos);
    chequear(resumen.ingresos.porCobrar === 30, "por cobrar = el pedido en revisión (30)", resumen.ingresos.porCobrar);
    chequear(resumen.ingresos.ticket === 75, "ticket promedio = 150/2", resumen.ingresos.ticket);
    chequear(resumen.ingresos.porMes.length === 6, "la serie trae 6 meses");
    chequear(resumen.ingresos.porMes.at(-1)?.ingresos === 150, "el mes actual va al final de la serie");
    chequear(resumen.cuentas.total === 2, "cuenta 2 usuarios vivos (la eliminada no)", resumen.cuentas.total);
    chequear(resumen.cuentas.premium === 1, "cuenta 1 usuario premium", resumen.cuentas.premium);
    chequear(resumen.cuentas.enLinea === 1, "cuenta 1 usuario en línea", resumen.cuentas.enLinea);
    chequear(resumen.cuentas.nuevasMes === 2, "cuenta 2 altas del mes", resumen.cuentas.nuevasMes);
    chequear(resumen.trafico.vistas === 42, "vistas = 42", resumen.trafico.vistas);
    chequear(resumen.trafico.descargas === 5, "descargas = 2+3", resumen.trafico.descargas);
    chequear(resumen.trafico.opiniones === 2, "opiniones = 2", resumen.trafico.opiniones);
    chequear(resumen.trafico.sesiones === 2, "sesiones = 2", resumen.trafico.sesiones);
    chequear(resumen.trafico.segundosPromedio === 20, "tiempo promedio = 20 s", resumen.trafico.segundosPromedio);
    chequear(
      resumen.movimientos.some((m) => m.tipo === "ingreso" && m.titulo.includes("AA111")),
      "los ingresos aparecen en movimientos",
    );
  }

  console.log("\n— Egresos —");
  const invalidoMonto = await panel.crearEgreso({
    data: { admin: token, concepto: "Cero", monto: 0, categoria: "otros", fecha: ahora.slice(0, 10) },
  });
  chequear(!invalidoMonto.ok && invalidoMonto.motivo === "datos", "un monto en 0 se rechaza");

  const invalidoCategoria = await panel.crearEgreso({
    data: { admin: token, concepto: "Raro", monto: 10, categoria: "inventada", fecha: ahora.slice(0, 10) },
  });
  chequear(!invalidoCategoria.ok && invalidoCategoria.motivo === "datos", "una categoría inventada se rechaza");

  const invalidoFecha = await panel.crearEgreso({
    data: { admin: token, concepto: "Sin fecha", monto: 10, categoria: "otros", fecha: "ayer" },
  });
  chequear(!invalidoFecha.ok && invalidoFecha.motivo === "datos", "una fecha inválida se rechaza");

  const corto = await panel.crearEgreso({
    data: { admin: token, concepto: "x", monto: 10, categoria: "otros", fecha: ahora.slice(0, 10) },
  });
  chequear(!corto.ok && corto.motivo === "datos", "un concepto de una letra se rechaza");

  const nuevo = await panel.crearEgreso({
    data: {
      admin: token,
      concepto: "  Hosting y dominio  ",
      monto: 150.555,
      categoria: "servicios",
      fecha: ahora.slice(0, 10),
    },
  });
  chequear(nuevo.ok, "carga un egreso válido");

  const lista = await panel.listarEgresos({ data: { admin: token } });
  chequear(Array.isArray(lista) && lista.length === 1, "el egreso queda en la lista");
  chequear(lista?.[0]?.concepto === "Hosting y dominio", "guarda el concepto sin espacios de más", lista?.[0]?.concepto);
  chequear(lista?.[0]?.monto === 150.56, "guarda el monto redondeado a 2 decimales", lista?.[0]?.monto);

  const conEgreso = await panel.resumenPanel({ data: { admin: token } });
  chequear(conEgreso?.egresos.total === 150.56, "el resumen suma el egreso", conEgreso?.egresos.total);
  chequear(conEgreso?.balance.total === -0.56, "el balance descuenta el egreso", conEgreso?.balance.total);
  chequear(
    conEgreso?.movimientos.some((m) => m.tipo === "egreso" && m.titulo === "Hosting y dominio"),
    "el egreso aparece en movimientos",
  );

  const id = lista?.[0]?.id ?? "";
  const borrado = await panel.eliminarEgreso({ data: { admin: token, id } });
  chequear(borrado.ok, "borra el egreso");
  const borradoOtraVez = await panel.eliminarEgreso({ data: { admin: token, id } });
  chequear(!borradoOtraVez.ok && borradoOtraVez.motivo === "datos", "borrar dos veces el mismo egreso falla");
  const idFalso = await panel.eliminarEgreso({ data: { admin: token, id: "eg-000000000000" } });
  chequear(!idFalso.ok && idFalso.motivo === "datos", "un id inventado se rechaza");
  const vacio = await panel.resumenPanel({ data: { admin: token } });
  chequear(vacio?.egresos.total === 0, "el resumen vuelve a 0 egresos", vacio?.egresos.total);

  console.log("\n— Cambio de clave y cupo —");
  process.env.BITLY_ADMIN_CLAVE = "otra-clave-distinta-2026";
  ip("clave-cambiada");
  const conClaveNueva = await admin.entrarPanel({
    data: { correo: ADMIN_CORREO, clave: "otra-clave-distinta-2026" },
  });
  chequear(conClaveNueva.ok, "la clave nueva entra");
  const tokenViejo = await panel.resumenPanel({ data: { admin: token } });
  chequear(tokenViejo === null, "el token firmado con la clave vieja deja de servir");
  const tokenNuevo = await panel.resumenPanel({
    data: { admin: conClaveNueva.ok ? conClaveNueva.token : "" },
  });
  chequear(Boolean(tokenNuevo), "el token nuevo sí sirve");

  process.env.BITLY_ADMIN_CLAVE = CLAVE;
  ip("fuerza-bruta");
  for (let i = 0; i < 5; i++) await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: `mal-${i}` } });
  const bloqueado = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: CLAVE } });
  chequear(
    !bloqueado.ok && bloqueado.motivo === "cupo",
    "tras 5 fallos seguidos bloquea aunque la clave sea correcta",
  );
  ip("otra-ip");
  const desdeOtraIp = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: CLAVE } });
  chequear(desdeOtraIp.ok, "otra IP no queda castigada por los fallos ajenos");

  console.log("\n— Sin clave configurada —");
  delete process.env.BITLY_ADMIN_CLAVE;
  delete process.env.BITLY_ADMIN_CODE;
  ip("sin-clave");
  const cerrado = await admin.entrarPanel({ data: { correo: ADMIN_CORREO, clave: "" } });
  chequear(!cerrado.ok && cerrado.motivo === "clave", "sin BITLY_ADMIN_CLAVE el panel queda cerrado");
} finally {
  await server.close();
}

console.log("");
if (fallos.length) {
  console.error(`✗ ${fallos.length} prueba(s) fallaron:`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ Panel: todo en verde");
