/**
 * Archivo FRÍO del caché de audio: un repo privado de GitHub.
 *
 * KV es rápido pero chico (1 GB en el plan gratis) y vence. Este almacén guarda
 * todo lo que se sembró alguna vez, sin vencimiento, con la API de contenidos.
 *
 * Cómo está armado:
 *
 * - La ruta sale del `SHA-256` de `ISRC|calidad`: `audio/<2 hex>/<hex>/…`.
 * - El repo se elige por esos dos primeros hex: `indice = hex[0..2] % repos`.
 *   Es determinista, así que para leer se sabe el repo sin preguntar a los demás.
 * - El archivo se parte en trozos de 8 MB (la API de contenidos manda base64 y
 *   hay que cuidar la memoria del Worker) y se escribe el manifiesto al final.
 * - **Se crea una sola vez**: si el archivo ya existe, GitHub contesta 422 y se
 *   toma como éxito. Nada de leer-modificar-escribir ni de manejar `sha`.
 * - Las lecturas van por `raw.githubusercontent.com` con el token: el repo es
 *   privado y así no se gasta la cuota de la API.
 *
 * Variables: `BITLY_AUDIO_REPOS` (lista separada por comas) y
 * `BITLY_AUDIO_TOKEN` (fine-grained, Contents: RW, solo esos repos).
 */

import type { Almacen, Archivo } from "./almacen";
import { partir, unir, type Manifiesto } from "./trozos";

const API = "https://api.github.com";
const CRUDO = "https://raw.githubusercontent.com";
const RAMA = "main";
/** 8 MB: el base64 que manda la API no pasa de ~11 MB por escritura. */
const TROZO_BYTES = 8 * 1024 * 1024;

export type Config = { token: string; repos: string[] };

/** Lee la configuración del entorno. `null` = no hay archivo frío. */
export function configurar(): Config | null {
  const token = String(process.env?.BITLY_AUDIO_TOKEN ?? "").trim();
  const repos = String(process.env?.BITLY_AUDIO_REPOS ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  return token && repos.length > 0 ? { token, repos } : null;
}

/** De la ruta interna al repo y a la carpeta dentro del repo. */
function destino(cfg: Config, ruta: string): { repo: string; base: string } | null {
  const hex = ruta.startsWith("audio/") ? ruta.slice("audio/".length) : "";
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const indice = parseInt(hex.slice(0, 2), 16) % cfg.repos.length;
  return { repo: cfg.repos[indice]!, base: `audio/${hex.slice(0, 2)}/${hex}` };
}

/** base64 sin reventar la pila: `String.fromCharCode(...bytes)` no aguanta 8 MB. */
function base64(bytes: Uint8Array): string {
  let binario = "";
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) {
    binario += String.fromCharCode(...bytes.subarray(i, i + paso));
  }
  return btoa(binario);
}

export function crear(cfg: Config): Almacen {
  const cabeceras = {
    authorization: `Bearer ${cfg.token}`,
    "user-agent": "bitly-audio",
  };

  /** Lectura directa del archivo, sin cuota de API. */
  const crudo = (repo: string, camino: string, metodo = "GET") =>
    fetch(`${CRUDO}/${repo}/${RAMA}/${camino}`, { method: metodo, headers: cabeceras });

  /** Crea el archivo. Si ya estaba, no es un error. */
  async function subir(repo: string, camino: string, bytes: Uint8Array): Promise<void> {
    const respuesta = await fetch(`${API}/repos/${repo}/contents/${camino}`, {
      method: "PUT",
      headers: { ...cabeceras, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({
        message: `audio: ${camino}`,
        content: base64(bytes),
        branch: RAMA,
      }),
    });
    if (respuesta.ok || respuesta.status === 422) return;
    throw new Error(`audio: GitHub contestó ${respuesta.status}`);
  }

  async function manifiesto(repo: string, base: string): Promise<Manifiesto | null> {
    const respuesta = await crudo(repo, `${base}/man.json`).catch(() => null);
    if (!respuesta?.ok) return null;
    const valor = (await respuesta.json().catch(() => null)) as Manifiesto | null;
    return valor && Number(valor.trozos) > 0 ? valor : null;
  }

  return {
    nombre: `github(${cfg.repos.length})`,

    async leer(ruta): Promise<Archivo | null> {
      const donde = destino(cfg, ruta);
      if (!donde) return null;
      const man = await manifiesto(donde.repo, donde.base);
      if (!man) return null;
      const cuerpo = unir(man.trozos, async (indice) => {
        const respuesta = await crudo(donde.repo, `${donde.base}/trozo-${indice}.bin`).catch(
          () => null,
        );
        return respuesta?.ok ? respuesta.arrayBuffer() : null;
      });
      return {
        cuerpo,
        tipo: man.tipo || "application/octet-stream",
        bytes: Number(man.bytes) || 0,
      };
    },

    async hay(ruta) {
      const donde = destino(cfg, ruta);
      if (!donde) return false;
      const respuesta = await crudo(donde.repo, `${donde.base}/man.json`, "HEAD").catch(
        () => null,
      );
      return Boolean(respuesta?.ok);
    },

    async guardar(ruta, cuerpo, tipo, bytes) {
      const donde = destino(cfg, ruta);
      if (!donde) return false;
      const trozos = await partir(cuerpo, TROZO_BYTES, (indice, trozo) =>
        subir(donde.repo, `${donde.base}/trozo-${indice}.bin`, trozo),
      );
      if (trozos === 0) return false;
      const man: Manifiesto = { trozos, bytes, tipo };
      await subir(
        donde.repo,
        `${donde.base}/man.json`,
        new TextEncoder().encode(JSON.stringify(man)),
      );
      return true;
    },

    // El conteo de pedidos vive en la capa caliente: acá sería un commit por minuto.
    async leerTexto() {
      return null;
    },
    async escribirTexto() {
      return;
    },
  };
}
