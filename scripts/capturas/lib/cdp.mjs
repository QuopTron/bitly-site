/**
 * Utilidades mínimas de Chrome DevTools Protocol, compartidas por los scripts
 * de capturas (capturar.mjs y reemplazar.mjs).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

export const CHROME_POR_DEFECTO =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Últimos mensajes de consola de la página (sirven para explicar los timeouts). */
export const CONSOLA = [];

export class CDP {
  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, mal) => {
      ws.onopen = ok;
      ws.onerror = () => mal(new Error("No se pudo abrir la conexión CDP"));
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pendientes = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === "Runtime.consoleAPICalled" || m.method === "Runtime.exceptionThrown") {
        const args = m.params?.args ?? [m.params?.exceptionDetails?.exception];
        const texto = args
          .map((a) => (a && typeof a === "object" ? a.value ?? a.description ?? a.type : String(a)))
          .join(" ");
        CONSOLA.push(`${m.params.type ?? "exception"}: ${String(texto).slice(0, 160)}`);
        if (CONSOLA.length > 60) CONSOLA.shift();
      }
      if (m.id === undefined) return;
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      if (m.error) p.mal(new Error(m.error.message));
      else p.ok(m.result);
    };
    ws.onclose = () => {
      for (const p of this.pendientes.values()) p.mal(new Error("CDP cerrado"));
      this.pendientes.clear();
    };
  }

  enviar(method, params = {}, sessionId) {
    const id = ++this.n;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((ok, mal) => this.pendientes.set(id, { ok, mal }));
  }

  cerrar() {
    try {
      this.ws.close();
    } catch {}
  }
}

export async function esperarChrome(puerto, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await dormir(250);
  }
  throw new Error("Chrome no respondió en el puerto " + puerto);
}

/**
 * Borra el perfil temporal. En Windows Chrome suelta los archivos un instante
 * después de morir: sin reintentos, `rmSync` falla con EPERM y se lleva puesto
 * el código de salida del harness aunque las aserciones hayan pasado.
 */
export function limpiarPerfil(perfil) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * Abre Chrome sin ventana en segundo plano.
 *
 * @param {{puerto: number, perfil: string, chrome?: string, extra?: string[]}} opciones
 * @returns {Promise<{browser: CDP, cerrar: () => Promise<void>}>}
 */
export async function abrirChrome({ puerto, perfil, chrome = CHROME_POR_DEFECTO, extra = [] }) {
  if (!fs.existsSync(chrome)) throw new Error(`No encontré Chrome en ${chrome} (usá CHROME_PATH=…)`);
  // Si una corrida anterior quedó a medio morir, el perfil puede estar tomado:
  // se reintenta en vez de abortar.
  limpiarPerfil(perfil);

  const proceso = spawn(
    chrome,
    [
      "--headless",
      `--remote-debugging-port=${puerto}`,
      `--user-data-dir=${perfil}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--allow-file-access-from-files",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      ...extra,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const info = await esperarChrome(puerto);
  const browser = await CDP.conectar(info.webSocketDebuggerUrl);
  return {
    browser,
    info,
    async cerrar() {
      browser.cerrar();
      proceso.kill();
      await dormir(300);
      limpiarPerfil(perfil);
    },
  };
}

/* ─────────────────────────── Sesiones ─────────────────────────── */

export async function nuevaSesion(browser, viewport) {
  const { targetId } = await browser.enviar("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.enviar("Target.attachToTarget", { targetId, flatten: true });
  const ses = {
    id: sessionId,
    ev: (m, p = {}) => browser.enviar(m, p, sessionId),
    async cerrar() {
      await browser.enviar("Target.closeTarget", { targetId });
    },
  };
  await ses.ev("Page.enable");
  await ses.ev("Runtime.enable");
  // Guarda errores de la página para poder explicar mejor los timeouts.
  await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "window.__errores=[];" +
      "addEventListener('error',e=>window.__errores.push(String(e.message||e.error)));" +
      "addEventListener('unhandledrejection',e=>window.__errores.push('rejection: '+String(e.reason)));",
  });
  if (viewport) await aplicarViewport(ses, viewport);
  return ses;
}

export async function aplicarViewport(ses, { w, h, dpr = 2, movil = false }) {
  await ses.ev("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: dpr,
    mobile: movil,
    screenWidth: w,
    screenHeight: h,
  });
  await ses.ev("Emulation.setTouchEmulationEnabled", movil ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

export async function js(ses, expresion) {
  const r = await ses.ev("Runtime.evaluate", {
    expression: expresion,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "Error al evaluar JS");
  return r.result.value;
}
