import { createFileRoute } from "@tanstack/react-router";
import { cuentaDeToken } from "@/server/cuentas";
import { getJson, putJson } from "@/server/github-store";

/**
 * API de DATOS privados de la APP (backend Rust de Bitly).
 *
 * Por qué existe: la app guarda likes, ids de lo descargado y listas en el
 * equipo, y el usuario quiere lo mismo en el celular, la PC y la web. El
 * almacén del sitio ya resuelve esto: un JSON por cuenta dentro de
 * `bitly-data`, cifrado en reposo con `BITLY_DATA_SECRET` (ver
 * `cifrado.ts`) y con la cola por archivo de `github-store`.
 *
 * El secreto del almacén NO viaja: la app manda su token de sesión y acá se
 * resuelve la cuenta. Cada archivo es de una sola cuenta y la ruta no lleva el
 * correo, solo su SHA-256.
 *
 * Contrato (token en `Authorization: Bearer` o en `{ token }`):
 *
 *   POST { accion: "traer" }                 → { ok, documento }
 *   POST { accion: "guardar", documento }    → { ok, documento }
 *
 * El documento es `{ version: 1, actualizado, sincronizado, elementos[] }`.
 * Cada elemento es `{ tipo, id, actualizado, borrado, datos }` y se fusiona por
 * `tipo:id` con la misma regla que la app: gana el `actualizado` mayor; en
 * empate, gana el que no está borrado.
 *
 * Para no inundar el repo: se escribe **un commit** solo si el contenido cambió
 * (la marca `sincronizado` no cuenta) y se descartan documentos gigantes.
 */

const VERSION = 1;
const MAX_ELEMENTOS = 5_000;
const MAX_BYTES = 512 * 1024;
/** Mínimo entre escrituras de la misma cuenta: un commit no cuesta lo mismo que un like. */
const ESPERA_MS = 8_000;

/** Última escritura por archivo, dentro de este isolate. */
const ultimaEscritura = new Map<string, number>();

type Elemento = {
  tipo: string;
  id: string;
  actualizado: number;
  borrado?: boolean;
  datos?: unknown;
};

type Documento = {
  version: number;
  actualizado: number;
  sincronizado?: number;
  elementos: Elemento[];
};

const VACIO: Documento = { version: VERSION, actualizado: 0, sincronizado: 0, elementos: [] };

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

/** El token de sesión viaja en el cuerpo o como `Authorization: Bearer`. */
function tokenDe(request: Request, datos: Record<string, unknown>): string {
  const cuerpo = String(datos.token ?? "").trim();
  if (cuerpo) return cuerpo;
  const cabecera = request.headers.get("authorization") ?? "";
  return cabecera.toLowerCase().startsWith("bearer ") ? cabecera.slice(7).trim() : "";
}

/** La ruta del archivo: SHA-256 del id de la cuenta, sin exponer el correo. */
async function rutaDeCuenta(id: string): Promise<string> {
  const bytes = new TextEncoder().encode(id.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `data/app/${hex}.json`;
}

function normalizar(valor: unknown): Documento {
  if (!valor || typeof valor !== "object") return VACIO;
  const doc = valor as Partial<Documento>;
  if (doc.version !== VERSION || !Array.isArray(doc.elementos)) return VACIO;
  return {
    version: VERSION,
    actualizado: Number(doc.actualizado) || 0,
    sincronizado: Number(doc.sincronizado) || 0,
    elementos: doc.elementos
      .filter(
        (e): e is Elemento =>
          Boolean(e) &&
          typeof e.tipo === "string" &&
          typeof e.id === "string" &&
          e.tipo.trim() !== "" &&
          e.id.trim() !== "",
      )
      .map((e) => ({
        tipo: e.tipo.trim(),
        id: e.id.trim(),
        actualizado: Number(e.actualizado) || 0,
        borrado: Boolean(e.borrado),
        datos: e.datos ?? null,
      }))
      .slice(0, MAX_ELEMENTOS),
  };
}

/** Igual que la app: mayor `actualizado`; en empate gana el que no está borrado. */
function fusionar(base: Documento, otro: Documento): Documento {
  const mapa = new Map<string, Elemento>();
  for (const elemento of [...base.elementos, ...otro.elementos]) {
    const clave = `${elemento.tipo}:${elemento.id}`;
    const previo = mapa.get(clave);
    if (!previo || elemento.actualizado > previo.actualizado) {
      mapa.set(clave, elemento);
    } else if (elemento.actualizado === previo.actualizado && previo.borrado && !elemento.borrado) {
      mapa.set(clave, elemento);
    }
  }
  const elementos = [...mapa.values()]
    .sort((a, b) => b.actualizado - a.actualizado)
    .slice(0, MAX_ELEMENTOS);
  return {
    version: VERSION,
    actualizado: Math.max(base.actualizado, otro.actualizado),
    sincronizado: Math.max(base.sincronizado ?? 0, otro.sincronizado ?? 0),
    elementos,
  };
}

/** ¿Cambió algo que valga un commit? `sincronizado` no cuenta. */
function cambio(antes: Documento, despues: Documento): boolean {
  return JSON.stringify(antes.elementos) !== JSON.stringify(despues.elementos);
}

export const Route = createFileRoute("/api/datos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        const accion = String(cuerpo.accion ?? "").toLowerCase();
        if (accion !== "traer" && accion !== "guardar") {
          return json({ ok: false, motivo: "accion" }, 400);
        }

        const cuenta = await cuentaDeToken(tokenDe(request, cuerpo));
        if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);

        const ruta = await rutaDeCuenta(cuenta.id);
        const actual = normalizar(await getJson<unknown>("datos", ruta, VACIO));

        if (accion === "traer") return json({ ok: true, documento: actual });

        const crudo = cuerpo.documento;
        if (!crudo || typeof crudo !== "object") {
          return json({ ok: false, motivo: "documento" }, 400);
        }
        if (JSON.stringify(crudo).length > MAX_BYTES) {
          return json({ ok: false, motivo: "grande" }, 413);
        }
        const entrante = normalizar(crudo);
        if (entrante.version !== VERSION) {
          return json({ ok: false, motivo: "version" }, 400);
        }

        const ahora = Date.now();
        const previa = ultimaEscritura.get(ruta) ?? 0;
        if (ahora - previa < ESPERA_MS) {
          // La app reintenta más tarde: mejor eso que un commit por clic.
          return json({ ok: false, motivo: "espera", documento: actual }, 429);
        }

        const unido = fusionar(actual, entrante);
        unido.sincronizado = ahora;
        if (cambio(actual, unido)) {
          ultimaEscritura.set(ruta, ahora);
          const ok = await putJson("datos", ruta, unido, "app: datos de la cuenta");
          if (!ok) return json({ ok: false, motivo: "servidor" }, 502);
        }
        return json({ ok: true, documento: unido });
      },
    },
  },
});
