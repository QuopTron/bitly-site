import { createFileRoute } from "@tanstack/react-router";
import { cuentaDeToken } from "@/server/cuentas";
import { getJson, putJson } from "@/server/github-store";

/**
 * API del CATÁLOGO de resoluciones para la APP (backend Rust de Bitly).
 *
 * Qué resuelve: hoy una canción se busca en todas las fuentes hasta que alguna
 * contesta. Acá se recuerda, por canción, qué proveedor la sirvió y cuál acaba
 * de fallar. La próxima búsqueda —de este usuario o de cualquier otro— arranca
 * por la fuente que ya funcionó y no insiste con la rota.
 *
 * Qué NO guarda: audio, datos del usuario, ni quién aportó qué. Solo
 * `clave → [proveedor, id, calidad, visto, fallo]`, donde la clave es el ISRC
 * (o una identidad normalizada artista|título|duración).
 *
 * Contrato:
 *
 *   POST { accion: "traer", claves: string[] }          → { ok, documento }
 *   POST { accion: "aportar", token, documento }        → { ok, documento }
 *
 * `traer` es público: el índice no tiene nada privado, así también acelera a
 * quien no tiene cuenta. `aportar` exige sesión para que nadie ensucie el
 * índice de forma anónima.
 *
 * Para no inundar el repo: 16 archivos (shards) en vez de uno solo, se escribe
 * únicamente el shard que cambió, y como mucho una vez cada 15 s por shard. El
 * catálogo es una caché: si se pierde un aporte, se vuelve a aprender solo.
 */

const VERSION = 1;
const SHARDS = 16;
const MAX_CLAVES = 100;
const MAX_APORTES = 50;
const MAX_ENTRADAS_POR_SHARD = 800;
const MAX_FUENTES = 4;
const MAX_BYTES = 512 * 1024;
const VIDA_MS = 30 * 24 * 60 * 60 * 1_000;
const VIDA_FALLO_MS = 6 * 60 * 60 * 1_000;
const ESPERA_MS = 15_000;
/**
 * Margen para relojes adelantados. Sin esto, un cliente 1 s por delante del
 * servidor manda `visto` en el futuro, `vigente` lo descarta y el aporte se
 * pierde con un `ok:true` que miente. Cinco minutos cubren cualquier desfase
 * razonable sin dejar entrar datos viejos.
 */
const MARGEN_RELOJ_MS = 5 * 60 * 1_000;

type Fuente = {
  proveedor: string;
  id?: string;
  calidad?: string;
  visto: number;
  fallo?: boolean;
};

type Entrada = { clave: string; fuentes: Fuente[] };

type Documento = { version: number; actualizado: number; entradas: Entrada[] };

const VACIO: Documento = { version: VERSION, actualizado: 0, entradas: [] };

/** Última escritura por shard, dentro de este isolate. */
const ultimaEscritura = new Map<string, number>();

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

/** La misma normalización que la app: ISRC en mayúsculas, sin signos raros. */
function clave(valor: unknown): string {
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\-_|]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function vigente(fuente: Fuente, ahora: number): boolean {
  const edad = ahora - fuente.visto;
  return edad >= -MARGEN_RELOJ_MS && edad <= (fuente.fallo ? VIDA_FALLO_MS : VIDA_MS);
}

/** La mejor fuente viva de una entrada, para devolverle a la app. */
function mejor(entrada: Entrada, ahora: number): Fuente | undefined {
  return entrada.fuentes
    .filter((fuente) => !fuente.fallo && fuente.proveedor.trim() !== "")
    .filter((fuente) => vigente(fuente, ahora))
    .sort((a, b) => b.visto - a.visto)[0];
}

function normalizar(valor: unknown): Documento {
  if (!valor || typeof valor !== "object") return VACIO;
  const doc = valor as Partial<Documento>;
  if (!Array.isArray(doc.entradas)) return VACIO;
  const entradas: Entrada[] = [];
  for (const cruda of doc.entradas) {
    const entrada = cruda as Partial<Entrada>;
    const llave = clave(entrada.clave);
    if (!llave || !Array.isArray(entrada.fuentes)) continue;
    const fuentes: Fuente[] = [];
    for (const crudaFuente of entrada.fuentes) {
      const fuente = crudaFuente as Partial<Fuente>;
      const proveedor = String(fuente.proveedor ?? "").trim();
      if (!proveedor) continue;
      fuentes.push({
        proveedor,
        id: String(fuente.id ?? "").trim(),
        calidad: String(fuente.calidad ?? "").trim(),
        visto: Number(fuente.visto) || 0,
        fallo: Boolean(fuente.fallo),
      });
    }
    if (fuentes.length > 0) entradas.push({ clave: llave, fuentes });
  }
  return {
    version: VERSION,
    actualizado: Number(doc.actualizado) || 0,
    entradas: entradas.slice(0, MAX_ENTRADAS_POR_SHARD),
  };
}

/** Gana la fuente más nueva de cada proveedor; un fallo nuevo tapa la buena. */
function fusionar(base: Documento, otro: Documento, ahora: number): Documento {
  const porClave = new Map<string, Map<string, Fuente>>();
  for (const entrada of [...base.entradas, ...otro.entradas]) {
    const llave = clave(entrada.clave);
    if (!llave) continue;
    const fuentes = porClave.get(llave) ?? new Map<string, Fuente>();
    for (const fuente of entrada.fuentes) {
      const proveedor = fuente.proveedor.trim().toLowerCase();
      const previa = fuentes.get(proveedor);
      if (!previa || fuente.visto >= previa.visto) fuentes.set(proveedor, fuente);
    }
    porClave.set(llave, fuentes);
  }

  const entradas: Entrada[] = [];
  for (const [llave, fuentes] of porClave) {
    const vivas = [...fuentes.values()]
      .filter((fuente) => vigente(fuente, ahora))
      .sort((a, b) => b.visto - a.visto)
      .slice(0, MAX_FUENTES);
    if (vivas.length > 0) entradas.push({ clave: llave, fuentes: vivas });
  }
  entradas.sort((a, b) => {
    const ultima = (e: Entrada) => Math.max(0, ...e.fuentes.map((f) => f.visto));
    return ultima(b) - ultima(a);
  });
  return {
    version: VERSION,
    actualizado: Math.max(base.actualizado, otro.actualizado, ahora),
    entradas: entradas.slice(0, MAX_ENTRADAS_POR_SHARD),
  };
}

/** Shard estable por clave: el mismo ISRC cae siempre en el mismo archivo. */
async function shardDe(llave: string): Promise<number> {
  const bytes = new TextEncoder().encode(llave);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash)[0] % SHARDS;
}

function rutaShard(shard: number): string {
  return `data/catalogo/${String(shard).padStart(2, "0")}.json`;
}

/** Cuánto cambió de verdad (la marca de tiempo no justifica un commit). */
function cambio(antes: Documento, despues: Documento): boolean {
  return JSON.stringify(antes.entradas) !== JSON.stringify(despues.entradas);
}

export const Route = createFileRoute("/api/catalogo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cuerpo: Record<string, unknown>;
        try {
          cuerpo = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        if (JSON.stringify(cuerpo).length > MAX_BYTES) {
          return json({ ok: false, motivo: "grande" }, 413);
        }
        const accion = String(cuerpo.accion ?? "").toLowerCase();
        const ahora = Date.now();

        if (accion === "traer") {
          const pedidas = Array.isArray(cuerpo.claves) ? cuerpo.claves : [];
          const claves = [...new Set(pedidas.map(clave).filter(Boolean))].slice(0, MAX_CLAVES);
          if (claves.length === 0) return json({ ok: true, documento: VACIO });

          const buscadas = new Map<string, number>();
          for (const llave of claves) buscadas.set(llave, await shardDe(llave));

          const shards = [...new Set(buscadas.values())];
          const documentos = await Promise.all(
            shards.map((shard) =>
              getJson<unknown>("datos", rutaShard(shard), VACIO).then(normalizar),
            ),
          );
          const entradas: Entrada[] = [];
          for (const documento of documentos) {
            for (const entrada of documento.entradas) {
              if (!buscadas.has(entrada.clave)) continue;
              const fuente = mejor(entrada, ahora);
              if (fuente) entradas.push({ clave: entrada.clave, fuentes: [fuente] });
            }
          }
          return json({ ok: true, documento: { version: VERSION, actualizado: ahora, entradas } });
        }

        if (accion === "aportar") {
          const token = String(cuerpo.token ?? "").trim();
          const cuenta = await cuentaDeToken(token);
          if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);

          const entrada = normalizar(cuerpo.documento);
          if (entrada.entradas.length === 0) return json({ ok: true, documento: VACIO });

          // Un aporte toca como mucho 8 shards: un commit por shard, no uno por
          // canción.
          const porShard = new Map<number, Entrada[]>();
          for (const item of entrada.entradas.slice(0, MAX_APORTES)) {
            const shard = await shardDe(item.clave);
            const lista = porShard.get(shard) ?? [];
            lista.push(item);
            porShard.set(shard, lista);
          }
          const shards = [...porShard.keys()].slice(0, 8);
          const devueltas: Entrada[] = [];
          let escritos = 0;

          for (const shard of shards) {
            const ruta = rutaShard(shard);
            const previa = normalizar(await getJson<unknown>("datos", ruta, VACIO));
            const unido = fusionar(previa, { ...VACIO, entradas: porShard.get(shard) ?? [] }, ahora);
            devueltas.push(...unido.entradas);
            if (!cambio(previa, unido)) continue;

            const ultima = ultimaEscritura.get(ruta) ?? 0;
            if (ahora - ultima < ESPERA_MS) continue;
            ultimaEscritura.set(ruta, ahora);
            if (await putJson("datos", ruta, unido, "app: catálogo de resoluciones")) {
              escritos += 1;
            }
          }
          return json({
            ok: true,
            documento: { version: VERSION, actualizado: ahora, entradas: devueltas },
            escritos,
          });
        }

        return json({ ok: false, motivo: "accion" }, 400);
      },

      // El contrato es POST. Sin esto, un GET caía en la SPA y devolvía 200 con
      // HTML: un cliente roto creía que el catálogo había contestado.
      GET: async () => json({ ok: false, motivo: "metodo" }, 405),
      PUT: async () => json({ ok: false, motivo: "metodo" }, 405),
      PATCH: async () => json({ ok: false, motivo: "metodo" }, 405),
      DELETE: async () => json({ ok: false, motivo: "metodo" }, 405),
    },
  },
});
