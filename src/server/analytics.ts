/**
 * Estadísticas anónimas del sitio, guardadas en `data/analytics.json` del repo
 * privado. No se guarda IP ni nada que identifique a una persona: sólo un id
 * aleatorio por navegador, tiempo acumulado y secciones visitadas.
 *
 * El panel que las muestra está detrás de un código y la verificación ocurre
 * acá, en el servidor: el navegador nunca recibe los datos si el código no es
 * correcto.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, leerStats, putJson } from "./github-store";

const ARCHIVO = "data/analytics.json";
const MAX_SESIONES = 300;

type Sesion = {
  creado: string;
  ultimo: string;
  segundos: number;
  dispositivo: string;
  idioma: string;
  pantalla: string;
  origen: string;
  secciones: Record<string, number>;
};

type ArchivoAnalytics = {
  actualizado?: string;
  totalSesiones?: number;
  sesiones: Record<string, Sesion>;
};

export type SesionPublica = Sesion & { id: string };

export type Estadisticas = {
  vistas: number;
  descargas: number;
  comentarios: number;
  sesionesTotales: number;
  sesionesGuardadas: number;
  activas24h: number;
  segundosPromedio: number;
  segundosTotales: number;
  dispositivos: Record<string, number>;
  secciones: Record<string, number>;
  ultimas: SesionPublica[];
};

export function codigoAdminValido(codigo: unknown): boolean {
  // Sin valor por defecto A PROPÓSITO: este repositorio es público, así que un
  // código escrito acá es un código que todo el mundo conoce. Si la variable
  // falta, el panel queda cerrado (fail closed) y el error queda en el log del
  // Worker; nunca se abre con una contraseña compartida.
  const esperado = (process.env.BITLY_ADMIN_CODE ?? "").trim();
  if (!esperado) {
    console.error("[admin] falta BITLY_ADMIN_CODE: el panel privado queda deshabilitado");
    return false;
  }
  const dado = String(codigo ?? "").trim();
  if (dado.length !== esperado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i++) diferencia |= esperado.charCodeAt(i) ^ dado.charCodeAt(i);
  return diferencia === 0;
}

/**
 * Verificación del código admin con contador de FALLOS por IP.
 *
 * Comparar el código en tiempo constante evita filtrar cuántos caracteres
 * acertó, pero no frena a quien prueba miles de combinaciones. Acá se cuentan
 * sólo los intentos equivocados (así el dueño puede abrir el panel las veces que
 * quiera) y se corta tras `MAX_FALLOS` en la ventana.
 *
 * El contador vive en memoria del isolate: no es una barrera global, pero sí
 * convierte una ráfaga de fuerza bruta en unos pocos intentos útiles. La defensa
 * de verdad contra fuerza bruta distribuida es una regla de rate limiting en
 * Cloudflare, delante del sitio.
 */
const FALLOS_ADMIN = new Map<string, { n: number; t: number }>();
const VENTANA_ADMIN_MS = 10 * 60 * 1000;
const MAX_FALLOS_ADMIN = 10;

export async function adminValido(codigo: unknown): Promise<boolean> {
  let ip = "anonima";
  try {
    const { obtenerIPCliente } = await import("@/server/ip");
    ip = await obtenerIPCliente();
  } catch {
    /* fuera de una petición HTTP */
  }

  const ahora = Date.now();
  const previo = FALLOS_ADMIN.get(ip);
  const vigente = previo && ahora - previo.t <= VENTANA_ADMIN_MS ? previo : null;
  if (vigente && vigente.n >= MAX_FALLOS_ADMIN) return false;

  if (codigoAdminValido(codigo)) {
    FALLOS_ADMIN.delete(ip);
    return true;
  }

  if (vigente) vigente.n++;
  else FALLOS_ADMIN.set(ip, { n: 1, t: ahora });
  if (FALLOS_ADMIN.size > 2000) FALLOS_ADMIN.clear();
  return false;
}

function idValido(id: unknown): string | null {
  const texto = String(id ?? "").trim();
  return /^[a-z0-9-]{8,40}$/i.test(texto) ? texto : null;
}

function recortarTexto(valor: unknown, max: number, defecto: string): string {
  const texto = String(valor ?? "").trim().replace(/[\u0000-\u001f]/g, "");
  return texto ? texto.slice(0, max) : defecto;
}

async function leerArchivo(): Promise<ArchivoAnalytics> {
  const crudo = await getJson<ArchivoAnalytics>("datos", ARCHIVO, { sesiones: {} });
  return {
    ...crudo,
    sesiones: crudo && typeof crudo.sesiones === "object" && crudo.sesiones ? crudo.sesiones : {},
  };
}

function recortarSesiones(sesiones: Record<string, Sesion>): Record<string, Sesion> {
  const ordenadas = Object.entries(sesiones)
    .sort((a, b) => (a[1].ultimo < b[1].ultimo ? 1 : a[1].ultimo > b[1].ultimo ? -1 : 0))
    .slice(0, MAX_SESIONES);
  return Object.fromEntries(ordenadas);
}

/**
 * Cupo general de analítica por IP.
 *
 * Estas funciones escriben un commit en el repo privado, así que sin freno un
 * script podía inflar el historial de git y gastar la cuota de la API con sólo
 * repetir latidos. El cliente late cada 45 s: 40 escrituras cada 10 minutos
 * dejan lugar a varias pestañas y a una recarga, y cortan el abuso.
 */
const cupoAnalitica = new Map<string, { n: number; t: number }>();
const VENTANA_ANALITICA_MS = 10 * 60 * 1000;
const MAX_ANALITICA_POR_IP = 40;

async function hayCupoAnalitica(): Promise<boolean> {
  let ip = "anonima";
  try {
    const { obtenerIPCliente } = await import("@/server/ip");
    ip = await obtenerIPCliente();
  } catch {
    /* fuera de una petición HTTP */
  }
  const ahora = Date.now();
  const previo = cupoAnalitica.get(ip);
  if (!previo || ahora - previo.t > VENTANA_ANALITICA_MS) {
    cupoAnalitica.set(ip, { n: 1, t: ahora });
    if (cupoAnalitica.size > 2000) cupoAnalitica.clear();
    return true;
  }
  previo.n++;
  return previo.n <= MAX_ANALITICA_POR_IP;
}

export const registrarSesion = createServerFn({ method: "POST" })
  .validator((d: { id?: unknown; dispositivo?: unknown; idioma?: unknown; pantalla?: unknown; origen?: unknown; seccion?: unknown }) => d)
  .handler(async ({ data }): Promise<boolean> => {
    const id = idValido(data?.id);
    if (!id) return false;
    if (!(await hayCupoAnalitica())) return false;
    try {
      const archivo = await leerArchivo();
      const anterior = archivo.sesiones[id];
      const ahora = new Date().toISOString();
      const sesion: Sesion = {
        creado: anterior?.creado ?? ahora,
        ultimo: ahora,
        segundos: Number(anterior?.segundos) || 0,
        dispositivo: recortarTexto(data?.dispositivo, 20, "desconocido"),
        idioma: recortarTexto(data?.idioma, 8, "es"),
        pantalla: recortarTexto(data?.pantalla, 16, ""),
        origen: anterior?.origen ?? recortarTexto(data?.origen, 200, "/"),
        secciones: anterior?.secciones ?? {},
      };
      const seccion = recortarTexto(data?.seccion, 20, "inicio");
      sesion.secciones[seccion] = (Number(sesion.secciones[seccion]) || 0) + 1;

      const sesiones = recortarSesiones({ ...archivo.sesiones, [id]: sesion });
      await putJson(
        "datos",
        ARCHIVO,
        {
          actualizado: ahora,
          totalSesiones: (Number(archivo.totalSesiones) || 0) + (anterior ? 0 : 1),
          sesiones,
        },
        `analytics: sesión ${seccion}`,
      );
      return true;
    } catch (e) {
      console.error("[analytics] no se pudo registrar la sesión:", e instanceof Error ? e.message : e);
      return false;
    }
  });

export const latidoSesion = createServerFn({ method: "POST" })
  .validator((d: { id?: unknown; segundos?: unknown; seccion?: unknown }) => d)
  .handler(async ({ data }): Promise<boolean> => {
    const id = idValido(data?.id);
    if (!id) return false;
    const segundos = Math.max(0, Math.min(180, Math.round(Number(data?.segundos) || 0)));
    try {
      const archivo = await leerArchivo();
      const anterior = archivo.sesiones[id];
      if (!anterior) return false;
      const ahora = new Date().toISOString();
      const seccion = recortarTexto(data?.seccion, 20, "inicio");
      const sesion: Sesion = {
        ...anterior,
        ultimo: ahora,
        segundos: (Number(anterior.segundos) || 0) + segundos,
        secciones: {
          ...anterior.secciones,
          [seccion]: (Number(anterior.secciones[seccion]) || 0) + 1,
        },
      };
      await putJson(
        "datos",
        ARCHIVO,
        { ...archivo, actualizado: ahora, sesiones: recortarSesiones({ ...archivo.sesiones, [id]: sesion }) },
        `analytics: +${segundos}s`,
      );
      return true;
    } catch (e) {
      console.error("[analytics] no se pudo guardar el latido:", e instanceof Error ? e.message : e);
      return false;
    }
  });

export const verificarCodigo = createServerFn({ method: "POST" })
  .validator((d: { codigo?: unknown }) => d)
  .handler(async ({ data }): Promise<boolean> => adminValido(data?.codigo));

export const leerEstadisticas = createServerFn({ method: "POST" })
  .validator((d: { codigo?: unknown }) => d)
  .handler(async ({ data }): Promise<Estadisticas | null> => {
    if (!(await adminValido(data?.codigo))) return null;
    try {
      const [archivo, stats, vistas, opiniones] = await Promise.all([
        leerArchivo(),
        leerStats(),
        getJson<{ visitas?: number }>("datos", "data/vistas.json", { visitas: 0 }),
        getJson<unknown[]>("datos", "data/opiniones.json", []),
      ]);

      const sesiones = Object.entries(archivo.sesiones).map(([id, s]) => ({ id, ...s }));
      const ahora = Date.now();
      const dispositivos: Record<string, number> = {};
      const secciones: Record<string, number> = {};
      let segundosTotales = 0;
      let activas24h = 0;

      for (const s of sesiones) {
        segundosTotales += Number(s.segundos) || 0;
        if (ahora - new Date(s.ultimo).getTime() < 86_400_000) activas24h++;
        dispositivos[s.dispositivo] = (dispositivos[s.dispositivo] ?? 0) + 1;
        for (const [seccion, veces] of Object.entries(s.secciones)) {
          secciones[seccion] = (secciones[seccion] ?? 0) + (Number(veces) || 0);
        }
      }

      const descargas = Object.entries(stats)
        .filter(([clave, valor]) => clave !== "actualizado" && typeof valor === "number")
        .reduce((total, [, valor]) => total + (Number(valor) || 0), 0);

      return {
        vistas: Number(vistas.visitas) || 0,
        descargas,
        comentarios: Array.isArray(opiniones) ? opiniones.length : 0,
        sesionesTotales: Number(archivo.totalSesiones) || sesiones.length,
        sesionesGuardadas: sesiones.length,
        activas24h,
        segundosPromedio: sesiones.length ? Math.round(segundosTotales / sesiones.length) : 0,
        segundosTotales,
        dispositivos,
        secciones,
        ultimas: sesiones.sort((a, b) => (a.ultimo < b.ultimo ? 1 : -1)).slice(0, 20),
      };
    } catch (e) {
      console.error("[analytics] no se pudieron leer las estadísticas:", e instanceof Error ? e.message : e);
      return null;
    }
  });
