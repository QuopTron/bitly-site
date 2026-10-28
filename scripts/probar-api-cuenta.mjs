#!/usr/bin/env node
/**
 * Prueba el CONTRATO que la APP usa contra el sitio: `POST /api/cuenta` y
 * `/api/rescate`, con los handlers REALES de esas rutas.
 *
 * Por qué existe: las dos rutas se escribieron para que el binario de Bitly
 * tenga una dirección estable (las *server functions* van con hash del build y
 * se rompen en cada despliegue), pero hasta ahora se probaba el módulo de
 * cuentas por un lado y el de rescate por otro: el contrato HTTP —el que
 * realmente viaja— no lo cubría nadie. Y fue justo lo que falló en producción:
 * `/api/cuenta` respondía 405 porque la ruta no estaba desplegada.
 *
 * Lo que se fija acá, de punta a punta:
 *   · alta desde la app → el código sale por correo (webhook local) → el código
 *     confirma y entrega sesión;
 *   · `estado` trae la CUOTA junto con la cuenta (una sola llamada al
 *     sincronizar) y `descarga` descuenta de ESA cuota: la misma que gasta la web;
 *   · el reinicio general devuelve las 75 a todos (`reiniciarCuotaGlobal`);
 *   · entrar con correo + contraseña funciona igual que confirmar;
 *   · un token viejo (firmado con el PAT de GitHub) se trata como vencido, y sin
 *     token no hay cuota ni estado: los motivos son los que la app traduce;
 *   · el rescate guarda/borra la config de la cuenta y NO acepta secretos.
 *
 * Uso: node scripts/probar-api-cuenta.mjs
 */

import { readdirSync, mkdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = (nombre) => path.join(raiz, "scripts", "pruebas", "stubs", nombre);

let ok = 0;
let fallos = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    ok++;
    console.log(`OK   ${nombre}${detalle ? `  (${detalle})` : ""}`);
  } else {
    fallos++;
    console.log(`FALLA ${nombre}${detalle ? `  (${detalle})` : ""}`);
  }
}

/* ── El correo: un webhook local que guarda el código que llega ─────────── */

const correos = [];
const webhook = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (trozo) => (cuerpo += trozo));
  req.on("end", () => {
    try {
      correos.push(JSON.parse(cuerpo || "{}"));
    } catch {
      correos.push({ text: cuerpo });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((listo) => webhook.listen(0, "127.0.0.1", listo));
const puertoWebhook = webhook.address().port;

/* ── Entorno del sitio (sin tocar la base real) ─────────────────────────── */

process.env.BITLY_SESSION_SECRET = "secreto-de-sesiones-de-prueba-2026";
process.env.BITLY_EMAIL_WEBHOOK = `http://127.0.0.1:${puertoWebhook}/correo`;
process.env.BITLY_DATA_TOKEN = "token-de-datos-de-prueba";
// El correo tiene que salir SOLO por el webhook local.
for (const clave of [
  "RESEND_API_KEY",
  "BITLY_EMAIL_FROM",
  "BITLY_SMTP_HOST",
  "BITLY_SMTP_USER",
  "BITLY_SMTP_PASS",
]) {
  delete process.env[clave];
}

function cargarEsbuild() {
  const base = path.join(raiz, "node_modules", ".pnpm");
  const carpeta = readdirSync(base).find((d) => d.startsWith("esbuild@"));
  if (!carpeta) {
    console.error("No encuentro esbuild en node_modules/.pnpm (¿pnpm install?).");
    process.exit(1);
  }
  return import(
    pathToFileURL(path.join(base, carpeta, "node_modules", "esbuild", "lib", "main.js")).href
  ).then((m) => (m.build ? m : m.default));
}

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });

/** Compila un módulo del sitio con los dobles de la plataforma del Worker. */
async function compilar(entrada, salida) {
  const destino = path.join(cache, salida);
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", ...entrada)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    alias: { "@": path.join(raiz, "src") },
    plugins: [
      {
        name: "dobles-de-prueba",
        setup(build) {
          build.onResolve({ filter: /^@tanstack\// }, () => ({ path: stub("start.mjs") }));
          build.onResolve({ filter: /^@\/server\/github-store$/ }, () => ({ path: stub("github-store.mjs") }));
          build.onResolve({ filter: /^@\/server\/ip$/ }, () => ({ path: stub("ip.mjs") }));
          build.onResolve({ filter: /^(worker-mailer|cloudflare:sockets)$/ }, () => ({
            path: "vacio",
            namespace: "vacio",
          }));
          build.onLoad({ filter: /.*/, namespace: "vacio" }, () => ({
            contents: "export default {};",
            loader: "js",
          }));
        },
      },
    ],
    outfile: destino,
    logLevel: "error",
  });
  return pathToFileURL(destino).href + `?v=${Date.now()}`;
}

const urlCuenta = await compilar(["routes", "api", "cuenta.ts"], "api-cuenta.mjs");
const urlRescate = await compilar(["routes", "api", "rescate.ts"], "api-rescate.mjs");
const urlCuota = await compilar(["server", "descargas-cuenta.ts"], "api-cuota.mjs");

const rutaCuenta = await import(urlCuenta);
const rutaRescate = await import(urlRescate);
const cuotaMod = await import(urlCuota);

const POST = rutaCuenta.Route.server.handlers.POST;
const GET_RESCATE = rutaRescate.Route.server.handlers.GET;
const POST_RESCATE = rutaRescate.Route.server.handlers.POST;

/** Llama a POST /api/cuenta como lo hace la app (token en el Bearer). */
async function api(cuerpo, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request("http://localhost/api/cuenta", {
    method: "POST",
    headers,
    body: JSON.stringify(cuerpo),
  });
  const res = await POST({ request });
  return { status: res.status, datos: await res.json().catch(() => null) };
}

/** Llama a /api/rescate (GET o POST) como lo hace la app. */
async function rescate(metodo, { token = "", cuerpo, enQuery = false } = {}) {
  const headers = {};
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (token && !enQuery) headers.authorization = `Bearer ${token}`;
  const url = enQuery
    ? `http://localhost/api/rescate?token=${encodeURIComponent(token)}`
    : "http://localhost/api/rescate";
  const request = new Request(url, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const res = await (metodo === "GET" ? GET_RESCATE({ request }) : POST_RESCATE({ request }));
  return { status: res.status, datos: await res.json().catch(() => null) };
}

const CLAVE = "clave-de-prueba-2026";
const CORREO = "nueva@ejemplo.com";

/* ── 1. El alta desde la app ────────────────────────────────────────────── */

const alta = await api({ accion: "alta", correo: CORREO, clave: CLAVE, nombre: "Nueva" });
check(
  "alta desde la app: crea la cuenta y pide el código",
  alta.datos?.ok === true && alta.datos?.pendiente === true,
  JSON.stringify(alta.datos),
);
check("alta: el código sale por correo (envío real)", alta.datos?.enviado === true);

const guardadas = JSON.parse(globalThis.__STORE?.get("data/cuentas.json") ?? "[]");
const cuentaId = guardadas[0]?.id ?? "";
check("alta: la cuenta queda marcada como creada desde la APP", guardadas[0]?.origen === "app");
check("alta: el correo NO se puede confirmar todavía", guardadas[0]?.correoConfirmado === false);

/* ── 2. El código del correo confirma y entrega sesión ──────────────────── */

const texto = String(correos.at(-1)?.text ?? "");
const codigo = (texto.match(/(?:^|\n)\s*(\d{6})\s*(?:\n|$)/) ?? texto.match(/(\d{6})/) ?? [])[1] ?? "";
check("el correo trae el código de 6 dígitos", /^\d{6}$/.test(codigo), codigo ? "(oculto)" : "sin código");

const confirmar = await api({ accion: "confirmar", correo: CORREO, codigo });
check(
  "confirmar: el código entrega la sesión",
  confirmar.datos?.ok === true && typeof confirmar.datos?.token === "string",
  JSON.stringify(confirmar.datos).slice(0, 80),
);
const token = confirmar.datos?.token ?? "";

/* ── 3. `estado`: cuenta + cuota en un solo viaje ───────────────────────── */

const estado = await api({ accion: "estado" }, token);
check(
  "estado: la app ve su cuenta",
  estado.datos?.ok === true && estado.datos?.cuenta?.correo === CORREO,
  JSON.stringify(estado.datos?.motivo ?? ""),
);
check("estado: el correo queda confirmado", estado.datos?.correoConfirmado === true);
check(
  "estado: trae la cuota completa (75)",
  estado.datos?.cuota?.limite === 75 && estado.datos?.cuota?.usadas === 0 && estado.datos?.cuota?.restantes === 75,
  JSON.stringify(estado.datos?.cuota),
);

/* ── 4. Una descarga descuenta de ESA cuota ─────────────────────────────── */

const descarga = await api(
  { accion: "descarga", titulo: "Una canción", artista: "Ana", calidad: "flac", canal: "app" },
  token,
);
check(
  "descarga: baja 1 de la cuota y devuelve el total nuevo",
  descarga.datos?.ok === true && descarga.datos?.cuota?.usadas === 1 && descarga.datos?.cuota?.restantes === 74,
  JSON.stringify(descarga.datos?.cuota),
);
const estado2 = await api({ accion: "estado" }, token);
check("el contador queda guardado (la web y la app suman juntas)", estado2.datos?.cuota?.usadas === 1);

/* ── 5. El reinicio general devuelve las 75 a todos ─────────────────────── */

const reinicio = await cuotaMod.reiniciarCuotaGlobal();
check("reinicio general: toca las cuentas registradas", reinicio.ok === true && reinicio.cuentas >= 1, JSON.stringify(reinicio));
const estado3 = await api({ accion: "estado" }, token);
check(
  "después del reinicio la cuenta vuelve a tener las 75",
  estado3.datos?.cuota?.usadas === 0 && estado3.datos?.cuota?.restantes === 75,
  JSON.stringify(estado3.datos?.cuota),
);
const resumen = await cuotaMod.resumenCuota();
check(
  "el resumen dice que todas quedaron completas",
  resumen.total === resumen.completas && resumen.gastadas === 0,
  JSON.stringify(resumen),
);

/* ── 6. Entrar con correo + contraseña ──────────────────────────────────── */

const sesion = await api({ accion: "sesion", correo: CORREO, clave: CLAVE });
check(
  "sesion: entra con correo + contraseña",
  sesion.datos?.ok === true && typeof sesion.datos?.token === "string",
  JSON.stringify(sesion.datos).slice(0, 80),
);
const sesionMala = await api({ accion: "sesion", correo: CORREO, clave: "clave-equivocada" });
check("sesion: una clave equivocada no entra", sesionMala.datos?.ok === false && sesionMala.datos?.motivo === "datos");

/* ── 7. Los tokens viejos ya no sirven ──────────────────────────────────── */

function tokenConClaveVieja(id, pat) {
  const payload = Buffer.from(JSON.stringify({ c: id, e: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  const firma = createHmac("sha256", `bitly-session-v1:${pat}`)
    .update(Buffer.from(payload, "base64url"))
    .digest("base64url");
  return `${payload}.${firma}`;
}

const viejo = tokenConClaveVieja(cuentaId, "ghp_pat-de-github-viejo");
const conViejo = await api({ accion: "estado" }, viejo);
check(
  "un token viejo (firmado con el PAT) se trata como sesión vencida",
  conViejo.status === 401 && conViejo.datos?.motivo === "sesion",
  `${conViejo.status} ${JSON.stringify(conViejo.datos)}`,
);

/* ── 8. Sin token no hay cuota ni estado ────────────────────────────────── */

const sinToken = await api({ accion: "cuota" });
check(
  "sin token la cuota no se entrega (401 + motivo sesion)",
  sinToken.status === 401 && sinToken.datos?.motivo === "sesion",
  `${sinToken.status}`,
);

/* ── 9. Los errores del contrato ────────────────────────────────────────── */

const repetida = await api({ accion: "alta", correo: CORREO, clave: CLAVE });
check("alta repetida: motivo existe", repetida.datos?.ok === false && repetida.datos?.motivo === "existe");
const corta = await api({ accion: "alta", correo: "otro@ejemplo.com", clave: "corta" });
check("alta con clave corta: motivo datos", corta.datos?.ok === false && corta.datos?.motivo === "datos");
const rara = await api({ accion: "loquesea" });
check("una acción desconocida responde 400 accion", rara.status === 400 && rara.datos?.motivo === "accion");

/* ── 10. El rescate de la cuenta ────────────────────────────────────────── */

const vacio = await rescate("GET", { token, enQuery: true });
check(
  "rescate: una cuenta nueva no tiene nada guardado",
  vacio.status === 200 && vacio.datos?.ok === true && Object.keys(vacio.datos.config ?? {}).length === 0,
  JSON.stringify(vacio.datos?.config),
);

const guardado = await rescate("POST", {
  token,
  cuerpo: {
    config: {
      mirrors: ["https://espejo1/", "https://espejo2"],
      monochrome: true,
      arcodToken: "SECRETO-QUE-NO-DEBE-VIAJAR",
      mirrorsTrucado: ["https://no"],
    },
  },
});
check(
  "rescate: guarda la config de la cuenta",
  guardado.datos?.ok === true && guardado.datos?.config?.monochrome === true,
  JSON.stringify(guardado.datos?.config),
);
check(
  "rescate: normaliza las URLs (sin barra final) y corta lo que no es URL",
  guardado.datos?.config?.mirrors?.join(",") === "https://espejo1,https://espejo2",
  JSON.stringify(guardado.datos?.config?.mirrors),
);
check(
  "rescate: los SECRETOS de la app NO viajan al sitio",
  !JSON.stringify(guardado.datos?.config ?? {}).includes("SECRETO"),
);

const releido = await rescate("GET", { token, enQuery: true });
check(
  "rescate: lo guardado se vuelve a leer igual",
  JSON.stringify(releido.datos?.config?.mirrors) === JSON.stringify(guardado.datos?.config?.mirrors),
);

const borrado = await rescate("POST", { token, cuerpo: {} });
check("rescate: un POST sin config borra (vuelve a lo de la app)", borrado.datos?.ok === true);
const trasBorrar = await rescate("GET", { token, enQuery: true });
check(
  "rescate: después de borrar no queda nada",
  Object.keys(trasBorrar.datos?.config ?? {}).length === 0,
  JSON.stringify(trasBorrar.datos?.config),
);
const sinSesion = await rescate("GET", {});
check("rescate: sin token responde 401 sesion", sinSesion.status === 401 && sinSesion.datos?.motivo === "sesion");

webhook.close();
console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
