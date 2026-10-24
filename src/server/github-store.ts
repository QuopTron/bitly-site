/**
 * Almacenamiento del sitio en GitHub (Contents API).
 *
 * Reemplaza a Supabase: en vez de tablas y claves públicas, la base de datos es
 * JSON versionado dentro de un repo privado. Cada escritura es un commit, así
 * que todo queda auditado y editable a mano desde la web de GitHub.
 *
 * Las tres piezas son `getJson` (leer con caché), `putJson` (escribir con `sha`
 * y reintento) y `cola` (serializa escrituras al mismo archivo para que dos
 * visitas simultáneas no se pisen). El token vive SOLO en el servidor: viaja
 * como secreto del Worker y nunca llega al navegador.
 *
 * Multi-repo: `REPOS` mapea una clave a un repo distinto, así el mismo motor
 * sirve la base de datos (`bitly-data`) y los chats (`bitly-chats`) sin
 * duplicar código. Para sumar otro repo basta con una línea en `REPOS`.
 *
 * CIFRADO: si `BITLY_DATA_SECRET` está definido, cada archivo se guarda cifrado
 * (AES-256-GCM, ver `src/server/cifrado.ts`) y se descifra al leer. Los archivos
 * viejos en claro se siguen leyendo sin migración manual: la próxima escritura
 * los deja cifrados. Sin el secreto (por ejemplo en local) todo va en claro.
 */

import {
  aBase64,
  cifradoActivo,
  cifrarBase64,
  cifrarTexto,
  descifrarBase64,
  descifrarSobre,
  esSobre,
  textoABase64,
} from "@/server/cifrado";

const API = "https://api.github.com";
const RAMA = "main";

/** Repos que maneja el sitio. Agregar uno = agregar una entrada acá. */
const REPOS = {
  datos: { variable: "BITLY_DATA_REPO", defecto: "QuopTron/bitly-data" },
  chats: { variable: "BITLY_CHATS_REPO", defecto: "QuopTron/bitly-chats" },
} as const;

export type RepoClave = keyof typeof REPOS;

/**
 * Token con permiso `contents: write`.
 *
 * `BITLY_DATA_TOKEN` es el que conviene configurar; `BITLY_CODES_TOKEN` es el
 * respaldo y ya existe en producción (el mismo PAT que usa el canje de códigos),
 * así el deploy no necesita ninguna variable nueva para arrancar.
 */
function token(): string {
  const t = process.env.BITLY_DATA_TOKEN || process.env.BITLY_CODES_TOKEN;
  if (!t) throw new Error("Falta BITLY_DATA_TOKEN en el servidor");
  return t;
}

export function repoDe(clave: RepoClave): string {
  const cfg = REPOS[clave];
  return process.env[cfg.variable] || cfg.defecto;
}

/** Llamada a la API con las cabeceras que GitHub exige (sin User-Agent da 403). */
async function gh(ruta: string, init?: RequestInit): Promise<Response> {
  const opciones: RequestInit = {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bitly-site",
      ...(init?.headers ?? {}),
    },
  };
  // `AbortSignal.timeout` no existe en todos los runtimes: si falta, se va sin
  // timeout y listo (peor caso, una petición colgada; mejor que romper).
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    opciones.signal = AbortSignal.timeout(15_000);
  }
  return fetch(`${API}${ruta}`, opciones);
}

/** Reintenta con espera creciente: la red de cara al público es floja. */
async function conReintentos(ruta: string, init?: RequestInit): Promise<Response | null> {
  let ultimo: Response | null = null;
  for (let intento = 0; intento < 4; intento++) {
    try {
      const r = await gh(ruta, init);
      // 404/409/422 son respuestas útiles, no fallos de red: no se repiten.
      if (r.ok || r.status === 404 || r.status === 409 || r.status === 422) return r;
      ultimo = r;
    } catch {
      ultimo = null;
    }
    if (intento < 3) await new Promise((r) => setTimeout(r, 400 * (intento + 1)));
  }
  return ultimo;
}

// ── Caché de lectura ────────────────────────────────────────────────────────
// Los datos del sitio cambian poco y se leen en cada visita. Un TTL corto baja
// muchísimo el uso de la API sin que nadie note la demora; el valor recién
// escrito se mete a mano, así la propia escritura nunca sirve datos viejos.
const TTL_LECTURA_MS = 30_000;
const cache = new Map<string, { valor: unknown; expira: number }>();

function leerCache<T>(llave: string): T | undefined {
  const e = cache.get(llave);
  if (!e) return undefined;
  if (e.expira < Date.now()) {
    cache.delete(llave);
    return undefined;
  }
  return e.valor as T;
}

function escribirCache(llave: string, valor: unknown) {
  cache.set(llave, { valor, expira: Date.now() + TTL_LECTURA_MS });
}

export function olvidar(ruta: string) {
  cache.delete(ruta);
}

/** Serializa escrituras al mismo archivo dentro de este isolado. */
const colas = new Map<string, Promise<unknown>>();
function cola<T>(llave: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colas.get(llave) ?? Promise.resolve();
  const mia = previa.then(tarea, tarea);
  colas.set(llave, mia.catch(() => undefined));
  return mia;
}

/**
 * Lee un JSON del repo. Devuelve `defecto` si no existe o si la red falla:
 * el sitio prefiere arrancar con valores por defecto a no arrancar.
 */
export async function getJson<T>(clave: RepoClave, ruta: string, defecto: T): Promise<T> {
  const repo = repoDe(clave);
  const llave = `${repo}/${ruta}`;
  const guardado = leerCache<T>(llave);
  if (guardado !== undefined) return guardado;

  try {
    const r = await conReintentos(
      `/repos/${repo}/contents/${ruta}?ref=${RAMA}`,
      { headers: { Accept: "application/vnd.github.raw+json" } },
    );
    if (r && r.ok) {
      const crudo = JSON.parse(await r.text()) as unknown;
      if (esSobre(crudo)) {
        try {
          const valor = JSON.parse(await descifrarSobre(crudo)) as T;
          escribirCache(llave, valor);
          return valor;
        } catch (e) {
          // Archivo cifrado con otro secreto (o sin `BITLY_DATA_SECRET`): se
          // avisa en el log y se sigue con el valor por defecto, no se rompe.
          console.error(
            `[datos] ${ruta} está cifrado y no se pudo abrir (¿BITLY_DATA_SECRET?):`,
            e instanceof Error ? e.message : e,
          );
          return defecto;
        }
      }
      const valor = crudo as T;
      escribirCache(llave, valor);
      return valor;
    }
  } catch {
    /* sin red o JSON mal formado: se cae al defecto */
  }
  return defecto;
}

/**
 * Escribe un JSON en el repo (create o update).
 *
 * El `sha` es obligatorio para sobrescribir: sin él GitHub responde 422. Se
 * obtiene con un GET previo, y si otra escritura lo adelantó (409) se vuelve a
 * leer y se reintenta. Todo va en cola por archivo, así que dentro del mismo
 * Worker no debería llegar el 409; el reintento cubre los otros Workers.
 */
export async function putJson(
  clave: RepoClave,
  ruta: string,
  valor: unknown,
  mensaje: string,
): Promise<boolean> {
  const repo = repoDe(clave);
  const llave = `${repo}/${ruta}`;
  return cola(llave, async () => {
    const texto = JSON.stringify(valor, null, 2) + "\n";
    const contenido = textoABase64(cifradoActivo() ? await cifrarTexto(texto) : texto);

    const buscarSha = async (): Promise<string | undefined> => {
      const r = await conReintentos(`/repos/${repo}/contents/${ruta}?ref=${RAMA}`);
      if (r && r.ok) {
        const datos = (await r.json().catch(() => null)) as { sha?: string } | null;
        return datos?.sha;
      }
      return undefined; // 404 = todavía no existe
    };

    const mandar = async (sha?: string): Promise<Response | null> =>
      conReintentos(`/repos/${repo}/contents/${ruta}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: mensaje, content: contenido, branch: RAMA, ...(sha ? { sha } : {}) }),
      });

    let sha = await buscarSha();
    let r = await mandar(sha);

    if (r && (r.status === 409 || (r.status === 422 && !sha))) {
      sha = await buscarSha();
      r = await mandar(sha);
    }

    const ok = Boolean(r?.ok);
    if (ok) escribirCache(llave, valor);
    else console.error(`[datos] no se pudo escribir ${ruta}: ${r?.status ?? "sin respuesta"}`);
    return ok;
  });
}

// ── Archivos binarios ───────────────────────────────────────────────────────
// Los comprobantes de pago se guardan como archivo (en base64) dentro del repo:
// no tienen sentido metidos en un JSON. Con `BITLY_DATA_SECRET` van cifrados con
// la marca "BLY1" delante, así GitHub no muestra la imagen/PDF en claro.

/** Escribe un archivo binario (ya en base64) en el repo. */
export async function putArchivo(
  clave: RepoClave,
  ruta: string,
  contenidoB64: string,
  mensaje: string,
): Promise<boolean> {
  const repo = repoDe(clave);
  const llave = `${repo}/${ruta}`;
  return cola(llave, async () => {
    const contenido = cifradoActivo() ? await cifrarBase64(contenidoB64) : contenidoB64;

    const buscarSha = async (): Promise<string | undefined> => {
      const r = await conReintentos(`/repos/${repo}/contents/${ruta}?ref=${RAMA}`);
      if (r && r.ok) {
        const datos = (await r.json().catch(() => null)) as { sha?: string } | null;
        return datos?.sha;
      }
      return undefined;
    };

    const mandar = async (sha?: string): Promise<Response | null> =>
      conReintentos(`/repos/${repo}/contents/${ruta}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: mensaje,
          content: contenido,
          branch: RAMA,
          ...(sha ? { sha } : {}),
        }),
      });

    let sha = await buscarSha();
    let r = await mandar(sha);
    if (r && (r.status === 409 || (r.status === 422 && !sha))) {
      sha = await buscarSha();
      r = await mandar(sha);
    }

    const ok = Boolean(r?.ok);
    if (!ok) console.error(`[datos] no se pudo escribir ${ruta}: ${r?.status ?? "sin respuesta"}`);
    return ok;
  });
}

/**
 * Borra un archivo del repo.
 *
 * Lo usan los pedidos: cuando el admin elimina uno, el comprobante no puede
 * quedarse para siempre. Es idempotente a propósito: si el archivo ya no está
 * (404), devuelve `true` y el pedido se puede terminar de limpiar.
 */
export async function borrarArchivo(clave: RepoClave, ruta: string, mensaje: string): Promise<boolean> {
  const repo = repoDe(clave);
  const llave = `${repo}/${ruta}`;
  return cola(llave, async () => {
    const r = await conReintentos(`/repos/${repo}/contents/${ruta}?ref=${RAMA}`);
    if (r && r.status === 404) return true;
    if (!r || !r.ok) {
      console.error(`[datos] no se pudo leer ${ruta} para borrarlo: ${r?.status ?? "sin respuesta"}`);
      return false;
    }
    const datos = (await r.json().catch(() => null)) as { sha?: string } | null;
    if (!datos?.sha) return false;

    const borrado = await conReintentos(`/repos/${repo}/contents/${ruta}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: mensaje, sha: datos.sha, branch: RAMA }),
    });
    if (!borrado?.ok) {
      console.error(`[datos] no se pudo borrar ${ruta}: ${borrado?.status ?? "sin respuesta"}`);
      return false;
    }
    return true;
  });
}

/** Lee un archivo binario del repo y lo devuelve en base64 (sin data URL). */
export async function getArchivo(clave: RepoClave, ruta: string): Promise<string | null> {
  const repo = repoDe(clave);
  try {
    const r = await conReintentos(`/repos/${repo}/contents/${ruta}?ref=${RAMA}`);
    if (!r || !r.ok) return null;
    const datos = (await r.json()) as { content?: unknown; encoding?: unknown };
    if (typeof datos.content === "string" && datos.encoding === "base64" && datos.content.length > 0) {
      // Si el archivo está cifrado se abre acá; si es viejo y está en claro,
      // `descifrarBase64` lo devuelve tal cual.
      return await descifrarBase64(datos.content.replace(/\s+/g, ""));
    }

    // Los archivos de MÁS DE 1 MB llegan con `content` vacío: la Contents API
    // se niega a devolver blobs grandes en JSON («This API returns blobs up to
    // 1 MB in size»). Un comprobante escaneado pasa ese límite sin esfuerzo, y
    // el panel se quedaba diciendo que el pedido no tenía archivo.
    // Con el media type `raw` sí vienen hasta 100 MB: el cuerpo son los BYTES
    // del archivo (el sobre `BLY1`), así que se pasan a base64 para que el
    // descifrado sea el mismo camino que con los archivos chicos.
    const crudo = await conReintentos(`/repos/${repo}/contents/${ruta}?ref=${RAMA}`, {
      headers: { Accept: "application/vnd.github.raw" },
    });
    if (!crudo || !crudo.ok) return null;
    const bytes = new Uint8Array(await crudo.arrayBuffer());
    if (bytes.length === 0) return null;
    return await descifrarBase64(aBase64(bytes));
  } catch (e) {
    console.error(`[datos] no se pudo abrir ${ruta}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── API genérica ────────────────────────────────────────────────────────────
// Para lo que no es un archivo del repo (Issues, releases): misma cabecera,
// mismos reintentos y el mismo token, pero sin el caché de lectura de 30 s.

/** GET a la API de GitHub. `null` ante cualquier fallo. */
export async function apiGet<T>(ruta: string): Promise<T | null> {
  const r = await conReintentos(ruta);
  if (!r || !r.ok) return null;
  try {
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * POST a la API de GitHub, con UN solo intento.
 *
 * Sin reintento a propósito: si la respuesta se pierde después de que GitHub
 * procesó el pedido, repetirlo crearía el recurso dos veces (un Issue duplicado
 * en `bitly-chats`). Mejor devolver `null` y que quien llama reintente a mano.
 */
export async function apiPost<T>(ruta: string, cuerpo: unknown): Promise<T | null> {
  try {
    const r = await gh(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ── Contadores ──────────────────────────────────────────────────────────────
// Leer-modificar-escribir sobre el mismo archivo. Con caché de 30 s en la
// lectura, dos visitas seguidas pueden pisarse: por eso `putJson` reintenta y
// por eso los contadores guardan el total leído como piso, nunca menos.

/**
 * `data/stats.json`: un contador por plataforma más la marca de cuándo se
 * escribió. El índice abierto es a propósito —hay plataformas nuevas (tv, ios)
 * que se agregan sin tocar el tipo— y admite `string` por `actualizado`.
 */
export type Stats = {
  actualizado?: string;
  windows?: number;
  android?: number;
  ios?: number;
  macos?: number;
  tv?: number;
  [plataforma: string]: number | string | undefined;
};

export async function leerStats(): Promise<Stats> {
  return getJson<Stats>("datos", "data/stats.json", { actualizado: undefined, windows: 0, android: 0, ios: 0, macos: 0 });
}

/** Suma una descarga en la plataforma indicada y devuelve el total nuevo. */
export async function sumarDescarga(plataforma: string): Promise<number> {
  const stats = await leerStats();
  const actual = Number(stats[plataforma]) || 0;
  const siguiente: Stats = { ...stats, [plataforma]: actual + 1, actualizado: new Date().toISOString() };
  // Si la escritura falla, el visitante igual ve el número subir (optimista);
  // el total real vuelve a llegarse en la próxima lectura.
  await putJson("datos", "data/stats.json", siguiente, `stats: +1 ${plataforma}`);
  return Number(siguiente[plataforma]) || 0;
}

export type RegistroVistas = { visitas: number; actualizado?: string };

/** Suma una visita y devuelve el total. */
export async function sumarVista(): Promise<number> {
  const actual = await getJson<RegistroVistas>("datos", "data/vistas.json", { visitas: 0 });
  const siguiente: RegistroVistas = { visitas: (Number(actual.visitas) || 0) + 1, actualizado: new Date().toISOString() };
  await putJson("datos", "data/vistas.json", siguiente, "vistas: +1");
  return Number(siguiente.visitas) || 0;
}
