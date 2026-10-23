/**
 * Datos del sitio servidos desde GitHub (`QuopTron/bitly-data`).
 *
 * Antes esto era Supabase: una tabla por cosa, claves públicas, RPCs y row
 * level security. Ahora la base de datos es JSON versionado en un repo
 * privado y todo pasa por acá, que es lo único que ve el token.
 *
 * Las funciones de lectura se usan tanto en el `loader` (SSR/prerender) como
 * desde el cliente: TanStack Start las ejecuta en el servidor cuando corre en
 * el servidor y hace una llamada HTTP cuando corre en el navegador, así el
 * mismo código sirve para las dos caras y el secreto nunca viaja.
 */

import { createServerFn } from "@tanstack/react-start";
import { getJson, leerStats, sumarDescarga, sumarVista } from "./github-store";
import { normalizarReparto } from "@/lib/opiniones-reglas";

export type InfoApp = {
  name: string;
  tagline: string;
  description: string;
  windows_url: string | null;
  android_url: string | null;
  version: string;
};

export type StatsSitio = { windows: number; android: number; ios?: number; macos?: number; tv?: number; pwa?: number };

export type OpinionPublicada = {
  id: number;
  nombre: string;
  estrellas: number;
  texto: string;
  creado: string;
};

export type ResumenSitio = {
  opiniones: number;
  promedio: number;
  vistas: number;
  reparto: number[];
};

export type DatosSitio = { info: InfoApp; stats: StatsSitio; vistas: number };

export const INFO_POR_DEFECTO: InfoApp = {
  name: "Bitly",
  tagline: "Tu música, sin límites",
  description: "",
  windows_url: null,
  android_url: null,
  version: "1.0.0",
};

/** Fila cruda de `data/opiniones.json`. */
type OpinionCruda = OpinionPublicada & { aprobado?: boolean };

/** Las opiniones van más nuevas primero; las no aprobadas no se publican. */
function ordenarYFiltrar(lista: OpinionCruda[]): OpinionPublicada[] {
  return (Array.isArray(lista) ? lista : [])
    .filter((o) => o && o.aprobado !== false && typeof o.texto === "string")
    .sort((a, b) => (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : 0))
    .map((o) => ({ id: o.id, nombre: o.nombre, estrellas: o.estrellas, texto: o.texto, creado: o.creado }));
}

/**
 * Info de la app + descargas por plataforma.
 *
 * Cada consulta tiene su propio `try` dentro de `getJson` (que ya devuelve el
 * defecto ante cualquier fallo), así que una build sin red publica igual con
 * los valores por defecto en vez de romper el prerender.
 */
export const leerDatosSitio = createServerFn({ method: "POST" }).handler(
  async (): Promise<DatosSitio> => {
    const [info, stats, vistas] = await Promise.all([
      getJson<InfoApp | null>("datos", "data/app_info.json", null),
      leerStats(),
      getJson<{ visitas?: number }>("datos", "data/vistas.json", { visitas: 0 }),
    ]);
    return {
      info: info && typeof info.tagline === "string" ? info : INFO_POR_DEFECTO,
      vistas: Number(vistas.visitas) || 0,
      stats: {
        windows: Number(stats.windows) || 0,
        android: Number(stats.android) || 0,
        ios: Number(stats.ios) || 0,
        macos: Number(stats.macos) || 0,
        tv: Number(stats.tv) || 0,
        pwa: Number(stats.pwa) || 0,
      },
    };
  },
);

/**
 * Opiniones aprobadas + resumen en un solo viaje.
 *
 * El resumen (cantidad, promedio, vistas y reparto de notas) se calcula acá en
 * vez de pedirlo aparte: leer un archivo cuesta lo mismo que leer dos.
 */
export const leerOpiniones = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ resumen: ResumenSitio; opiniones: OpinionPublicada[] }> => {
    const [crudas, vistas] = await Promise.all([
      getJson<OpinionCruda[]>("datos", "data/opiniones.json", []),
      getJson<{ visitas: number }>("datos", "data/vistas.json", { visitas: 0 }),
    ]);

    const opiniones = ordenarYFiltrar(crudas);
    const suma = opiniones.reduce((acc, o) => acc + (Number(o.estrellas) || 0), 0);
    const reparto = [1, 2, 3, 4, 5].map((n) => opiniones.filter((o) => Number(o.estrellas) === n).length);

    return {
      resumen: {
        opiniones: opiniones.length,
        promedio: opiniones.length ? Math.round((suma / opiniones.length) * 10) / 10 : 0,
        vistas: Number(vistas.visitas) || 0,
        reparto: normalizarReparto(reparto),
      },
      // 25 opiniones de muestra + la del visitante, sin recortar el carrusel.
      opiniones: opiniones.slice(0, 26),
    };
  },
);

/** Suma una visita (una por sesión) y devuelve el total. */
export const registrarVista = createServerFn({ method: "POST" }).handler(
  async (): Promise<number | null> => {
    try {
      return await sumarVista();
    } catch (e) {
      console.error("[datos] no se pudo contar la vista:", e instanceof Error ? e.message : e);
      return null;
    }
  },
);

/**
 * Sólo se aceptan assets de las releases públicas. Así una llamada inventada
 * no puede inflar el contador con cualquier URL.
 */
function urlDeDescarga(valor: string): string | null {
  try {
    const url = new URL(valor);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "github.com") {
      if (!/^\/quoptron\/bitly-releases\/releases\/download\//i.test(url.pathname)) return null;
    } else if (host !== "objects.githubusercontent.com" && host !== "release-assets.githubusercontent.com") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** HEAD (con Range de respaldo) para no contar un click si el archivo no existe. */
async function archivoDisponible(url: string): Promise<boolean> {
  const signal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(12_000) : undefined;
  const cabeceras = { "User-Agent": "bitly-site" };

  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow", headers: cabeceras, signal });
    if (r.ok) {
      const bytes = Number(r.headers.get("content-length") || 0);
      const tipo = r.headers.get("content-type") || "";
      if (bytes > 0 || r.headers.get("content-disposition") || tipo.includes("octet-stream")) return true;
    }
  } catch {
    /* se prueba con GET parcial */
  }

  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { ...cabeceras, Range: "bytes=0-0" },
      signal,
    });
    const ok = r.ok || r.status === 206;
    await r.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

/** Suma una descarga real, verificando que el archivo exista antes de contar. */
export const registrarDescarga = createServerFn({ method: "POST" })
  .validator((d: { plataforma?: unknown; url?: unknown }) => d)
  .handler(async ({ data }): Promise<number | null> => {
    const plataforma = String(data?.plataforma ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,20}$/.test(plataforma)) return null;

    const urlCruda = typeof data?.url === "string" ? data.url.trim() : "";
    if (urlCruda) {
      const url = urlDeDescarga(urlCruda);
      if (!url || !(await archivoDisponible(url))) return null;
    } else if (plataforma !== "pwa") {
      return null;
    }

    try {
      return await sumarDescarga(plataforma);
    } catch (e) {
      console.error("[datos] no se pudo contar la descarga:", e instanceof Error ? e.message : e);
      return null;
    }
  });
