#!/usr/bin/env node
/**
 * Vendoriza las extensiones de la app Bitly para la demo del sitio.
 *
 * Lee `../../bitly-extensions/extensions/*-extracted/{index.js,manifest.json}`
 * y genera:
 *
 *   src/server/extensions/vendor/<id>.ts        la extensión envuelta en una
 *                                               función `crear(entorno)` que
 *                                               recibe el shim del host
 *   src/server/extensions/vendor/index.ts       registro de creadores
 *   src/lib/extensiones-meta/index.ts           manifests (datos tipados)
 *
 * ¿Por qué envolver y no `eval`/`new Function`? Cloudflare Workers prohíbe
 * evaluar código en tiempo de petición, así que el fuente se convierte en un
 * módulo normal en build time y en runtime solo se INVOCAN funciones. El
 * wrapper además inyecta `registerExtension`, `http`, `fetch`, `log`,
 * `storage`, `utils`, `gobackend` y un `Math` determinista por búsqueda.
 *
 * Uso:  node scripts/sync-extensiones.mjs   (o pnpm extensiones)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = process.env.BITLY_EXTENSIONES_DIR
  ? path.resolve(process.env.BITLY_EXTENSIONES_DIR)
  : path.resolve(raiz, "..", "bitly-extensions", "extensions");

const IDS = [
  "spotify-web",
  "amazon",
  "soundcloud",
  "ytmusic-spotiflac",
  "deezer",
  "pandora",
  "qobuz-web",
  "tidal-web",
];

if (!existsSync(ORIGEN)) {
  console.error(`No encuentro las extensiones en ${ORIGEN}`);
  console.error("Define BITLY_EXTENSIONES_DIR si viven en otra ruta.");
  process.exit(1);
}

function escribir(ruta, contenido) {
  mkdirSync(path.dirname(ruta), { recursive: true });
  const previo = existsSync(ruta) ? readFileSync(ruta, "utf8") : null;
  if (previo === contenido) return false;
  writeFileSync(ruta, contenido, "utf8");
  return true;
}

function sinBOM(texto) {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

const plantilla = (id, version, fuente) => `// @ts-nocheck
// GENERADO por scripts/sync-extensiones.mjs — NO EDITAR A MANO.
// Fuente: bitly-extensions/extensions/${id}-extracted/index.js (v${version}).
//
// El fuente corre dentro de una función: las declaraciones de la extensión
// quedan aisladas por sandbox y los identificadores del host se inyectan por
// parámetro (el módulo ES es estricto, así que nada depende del modo sloppy).
// Math y Date también se inyectan: son los mismos que el runtime, pero con un
// valor determinista por corrida para que las firmas que arma la extensión no
// cambien entre una corrida y la siguiente.

export type ApiExtension = Record<string, any>;

export function crear(entorno: any): ApiExtension | null {
  const { http, fetch, log, storage, utils, gobackend, Math, Date } = entorno;
  let __api: any = null;
  function registerExtension(def: any) {
    __api = def;
  }

${fuente.replace(/\s+$/, "")}

  return __api;
}
`;

const creadores = [];
const manifests = [];
let cambios = 0;

for (const id of IDS) {
  const carpeta = path.join(ORIGEN, `${id}-extracted`);
  const rutaFuente = path.join(carpeta, "index.js");
  const rutaManifest = path.join(carpeta, "manifest.json");
  if (!existsSync(rutaFuente)) {
    console.error(`Falta ${rutaFuente}`);
    process.exit(1);
  }

  const fuente = sinBOM(readFileSync(rutaFuente, "utf8"));
  const manifest = JSON.parse(sinBOM(readFileSync(rutaManifest, "utf8")));

  if (escribir(path.join(raiz, "src", "server", "extensions", "vendor", `${id}.ts`), plantilla(id, manifest.version, fuente))) {
    cambios++;
  }
  creadores.push(`import { crear as crear_${id.replace(/-/g, "_")} } from "./${id}";`);

  manifests.push(
    `  ${JSON.stringify(id)}: ${JSON.stringify(
      {
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        description: manifest.description ?? "",
        permissions: manifest.permissions?.network ?? [],
        searchBehavior: manifest.searchBehavior ?? null,
      },
      null,
      2,
    )},`,
  );
}

const indiceVendor = `// GENERADO por scripts/sync-extensiones.mjs — NO EDITAR A MANO.
${creadores.join("\n")}

export type Creador = (entorno: any) => any;

export const creadores: Record<string, Creador> = {
${IDS.map((id) => `  ${JSON.stringify(id)}: crear_${id.replace(/-/g, "_")},`).join("\n")}
};
`;

if (escribir(path.join(raiz, "src", "server", "extensions", "vendor", "index.ts"), indiceVendor)) {
  cambios++;
}

const indiceMeta = `// GENERADO por scripts/sync-extensiones.mjs — NO EDITAR A MANO.
// Datos de los manifests de las extensiones que ofrece la demo.

export type FiltroBusqueda = { id: string; label?: string; icon?: string };

export type SearchBehavior = {
  enabled?: boolean;
  primary?: boolean;
  placeholder?: string;
  icon?: string;
  thumbnailRatio?: string;
  filters?: FiltroBusqueda[];
};

export type ManifestExtension = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  permissions: string[];
  searchBehavior: SearchBehavior | null;
};

export const MANIFESTS: Record<string, ManifestExtension> = {
${manifests.join("\n")}
};
`;

if (escribir(path.join(raiz, "src", "lib", "extensiones-meta", "index.ts"), indiceMeta)) {
  cambios++;
}

console.log(
  cambios === 0
    ? "Extensiones al día: nada que regenerar."
    : `Extensiones vendorizadas: ${cambios} archivo(s) regenerado(s).`,
);
