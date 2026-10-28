/**
 * Utilidades compartidas por las pruebas del panel del dueño.
 *
 * Las pruebas corren contra el repo de DATOS DE PRUEBA (`QuopTron/bitly-chats`)
 * para no tocar la base real, y usan el correo apagado salvo que se pida un
 * webhook local. Todas leen `.env` (token, secreto de cifrado) del proyecto.
 *
 * Los módulos del servidor se cargan con Vite en modo middleware, así se prueba
 * el código real (`src/server/*`) sin levantar el sitio entero.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "vite";

export const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const stub = (nombre) => path.join(raiz, "scripts/pruebas/stubs", nombre);
export const REPO_PRUEBA = "QuopTron/bitly-chats";
export const ADMIN_CORREO = "floxdev2024@gmail.com";
export const ADMIN_CLAVE = "clave-prueba-panel-2026";
/**
 * Secreto con el que las pruebas FIRMAN sus sesiones. El sitio no emite ninguna
 * sin un secreto propio (`sin_secreto`), así que sin esto no se puede ni entrar;
 * la clave es de mentira y sólo vive en el proceso de la prueba.
 */
export const SECRETO_SESION_PRUEBA = "secreto-de-sesion-de-prueba-2026";

/** Lee `.env` a un objeto (no imprime valores). */
export function leerEnv() {
  const env = {};
  const ruta = path.join(raiz, ".env");
  if (!fs.existsSync(ruta)) return env;
  for (const linea of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith("#")) continue;
    const i = linea.indexOf("=");
    if (i < 0) continue;
    let valor = linea.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    env[linea.slice(0, i).trim()] = valor;
  }
  return env;
}

/** Variables del sitio apuntando al repo de prueba y sin correo. */
export function entornoPrueba(extra = {}) {
  const env = {
    ...leerEnv(),
    BITLY_DATA_REPO: REPO_PRUEBA,
    BITLY_ADMIN_EMAIL: ADMIN_CORREO,
    BITLY_ADMIN_CLAVE: ADMIN_CLAVE,
    BITLY_ADMIN_SECRET: "secreto-prueba-panel-2026",
    // El sitio NO emite sesiones sin el secreto dedicado (responde
    // `sin_secreto`, a propósito). La siembra de las pruebas crea cuentas y
    // pide sesión, así que sin esto `verificar-panel` y `verificar-cambio`
    // fallaban en el primer paso.
    BITLY_SESSION_SECRET: SECRETO_SESION_PRUEBA,
    RESEND_API_KEY: "",
    BITLY_EMAIL_WEBHOOK: "",
    BITLY_SMTP_HOST: "",
    BITLY_SMTP_USER: "",
    BITLY_SMTP_PASS: "",
    ...extra,
  };
  for (const [clave, valor] of Object.entries(env)) process.env[clave] = valor;
  return env;
}

/**
 * Vite en modo middleware para cargar los módulos del servidor con los stubs
 * de la plataforma. Caché propia: compartir `node_modules/.vite` con el dev
 * server hace que el navegador pida dependencias con un hash viejo (504).
 */
export async function servidorDePrueba({ alias = [] } = {}) {
  return createServer({
    configFile: false,
    root: raiz,
    cacheDir: path.join(raiz, "scripts", ".cache", "vite-pruebas"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: {
      alias: [
        { find: /^@tanstack\/react-start$/, replacement: stub("start.mjs") },
        { find: /^@\/server\/ip$/, replacement: stub("ip.mjs") },
        ...alias,
        { find: /^@\//, replacement: path.join(raiz, "src") + "/" },
      ],
    },
    ssr: { noExternal: ["@tanstack/react-start"] },
  });
}

/**
 * Apaga lo que esté escuchando en un puerto de prueba.
 *
 * Una corrida anterior que murió a medias deja el servidor vivo y la prueba
 * siguiente termina hablando con el proceso viejo (con otra clave, otro build).
 * Sólo se usa en puertos que son de las pruebas (3010, 3011, 8788).
 */
export async function liberarPuerto(puerto) {
  if (process.platform !== "win32") return;
  const salida = await new Promise((ok) => {
    const p = spawn("netstat", ["-ano"], { stdio: ["ignore", "pipe", "ignore"] });
    let texto = "";
    p.stdout?.on("data", (t) => (texto += t));
    p.on("exit", () => ok(texto));
    p.on("error", () => ok(""));
  });
  const pids = new Set();
  for (const linea of salida.split(/\r?\n/)) {
    if (!linea.includes(`:${puerto} `) || !linea.includes("LISTENING")) continue;
    const pid = linea.trim().split(/\s+/).at(-1);
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }
  for (const pid of pids) {
    await new Promise((ok) => {
      const t = spawn("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      t.on("exit", ok);
      t.on("error", ok);
    });
  }
  if (pids.size > 0) await new Promise((ok) => setTimeout(ok, 800));
}

async function responde(url, ms = 60_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 308) return true;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 400));
  }
  return false;
}

/**
 * Levanta `vite dev` en un puerto con el entorno de prueba y espera a que
 * responda. Devuelve `cerrar()` para apagarlo.
 */
export async function levantarDev({ puerto = 3001, extra = {} } = {}) {
  await liberarPuerto(puerto);
  const env = { ...process.env, ...entornoPrueba(extra) };
  const proceso = spawn("npx", ["vite", "dev", "--port", String(puerto), "--strictPort"], {
    cwd: raiz,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env,
  });
  const log = [];
  proceso.stdout?.on("data", (t) => log.push(String(t)));
  proceso.stderr?.on("data", (t) => log.push(String(t)));

  const url = `http://localhost:${puerto}/`;
  if (!(await responde(url))) {
    proceso.kill();
    console.error(log.join("").slice(-1500));
    throw new Error(`el dev server no respondió en ${url}`);
  }

  return {
    url,
    log,
    async cerrar() {
      // En Windows, matar el `npx` deja vivo el vite que lanzó: hay que bajar
      // el árbol entero o el puerto queda tomado por un servidor viejo.
      if (process.platform === "win32" && proceso.pid) {
        await new Promise((ok) => {
          const tarea = spawn("taskkill", ["/PID", String(proceso.pid), "/T", "/F"], {
            stdio: "ignore",
          });
          tarea.on("exit", ok);
          tarea.on("error", ok);
        });
      } else {
        proceso.kill();
      }
      await new Promise((ok) => setTimeout(ok, 600));
    },
  };
}

export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
