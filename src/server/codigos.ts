/**
 * Emisión de códigos Premium desde el sitio.
 *
 * Un código que la app acepte tiene que ser de una de estas dos formas:
 *
 *   BITLY2.<payload>.<firma>   payload = {"p","t","e","i"}, firma Ed25519
 *   <payloadB64>.<firmaB64>    formato viejo, HMAC con un secreto que viaja
 *                              dentro del binario (cualquiera puede falsificarlo)
 *
 * El sitio NO puede inventar un código al azar: la app verifica la firma Ed25519
 * contra una clave PÚBLICA embebida, y firmar requiere la clave privada. Por eso
 * acá se firma con la clave privada guardada como secreto del Worker
 * (`BITLY_CODIGOS_CLAVE`); nunca se escribe en el repo ni se manda al navegador.
 *
 * Si el secreto no está configurado, el fallback es NO inventar nada: se toma un
 * código `activo` del registro que ya existe (`bitly_codes_premium`) y se asigna
 * automáticamente al pedido. Ese camino no necesita firma, pero depende de que
 * el registro tenga códigos libres.
 */

import { leerRegistroCodigos } from "@/lib/premium-check";
import { registrarEmitidos } from "@/server/codigos-emitidos";

/** Prefijo del formato firmado; la app lo usa para decidir el validador. */
const PREFIJO = "BITLY2.";
/** Palabra autorizada por la app (`appValidWords`). */
const PALABRA = "pablo";
/** Tier que la app entiende como Premium. */
const TIER = "premium";
/** Mismos días que emite el script de escritorio (`generar_codigo.py`). */
const DIAS = 365;
/** Tope de códigos por pedido: más que esto no es una compra, es una reventa. */
export const MAX_CODIGOS = 10;

export type ResultadoEmision =
  | { ok: true; codigos: string[]; origen: "firma" | "registro" }
  | { ok: false; motivo: "sin_clave" | "sin_stock" | "servidor" };

/* ── Utilidades base64url ──────────────────────────────────────────────── */

function deB64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function deB64url(texto: string): Uint8Array {
  const normal = texto.replace(/-/g, "+").replace(/_/g, "/");
  return deB64(normal + "=".repeat((4 - (normal.length % 4)) % 4));
}

function b64url(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* ── Firma Ed25519 ─────────────────────────────────────────────────────── */

/**
 * Importa la clave privada del secreto `BITLY_CODIGOS_CLAVE`.
 *
 * Acepta las formas en que uno pega una clave en `wrangler secret put`:
 *   · PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`), con \n reales o escapados;
 *   · base64/base64url de la semilla de 32 bytes;
 *   · base64 de la clave de 64 bytes (semilla + pública, como la imprime libsodium).
 *
 * La semilla se envuelve en un PKCS#8 antes de importarla: WebCrypto trata
 * `raw` como clave PÚBLICA, así que `importKey("raw", semilla, …, ["sign"])`
 * falla en el runtime del Worker (y en Node). Envolviéndola funciona igual que
 * el PEM.
 *
 * Devuelve `null` si no hay secreto o si no se puede importar: el que llama
 * decide qué hacer, y así un secreto mal pegado no rompe la compra entera.
 */
async function clavePrivada(): Promise<CryptoKey | null> {
  const crudo = (process.env.BITLY_CODIGOS_CLAVE ?? "").trim();
  if (!crudo) return null;

  try {
    if (crudo.includes("BEGIN")) {
      const cuerpo = crudo.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      return await crypto.subtle.importKey(
        "pkcs8",
        deB64(cuerpo) as BufferSource,
        { name: "Ed25519" },
        false,
        ["sign"],
      );
    }
    const semilla = deB64url(crudo);
    if (semilla.length < 32) return null;
    // Con 64 bytes el primero es la semilla; el resto es la pública (se ignora).
    // PKCS#8 de una Ed25519: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 + semilla.
    const sobre = new Uint8Array(16 + 32);
    sobre.set(deB64("MC4CAQAwBQYDK2VwBCIEIA=="), 0);
    sobre.set(semilla.slice(0, 32), 16);
    return await crypto.subtle.importKey("pkcs8", sobre as BufferSource, { name: "Ed25519" }, false, [
      "sign",
    ]);
  } catch (e) {
    console.error("[codigos] la clave de firma no se pudo importar:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** ¿Se pueden firmar códigos en este despliegue? Lo muestra el panel. */
export function firmaConfigurada(): boolean {
  return Boolean((process.env.BITLY_CODIGOS_CLAVE ?? "").trim());
}

/**
 * Arma un código firmado.
 *
 * El payload se firma TAL CUAL viaja (los mismos bytes), no re-serializado: es
 * la misma regla que sigue la app, así no hay forma de que los dos lados no
 * coincidan. `e` va en segundos de época y `i` es el identificador que después
 * permite encontrar el código en el registro.
 */
async function firmar(clave: CryptoKey, folio: string, indice: number): Promise<string> {
  // Ed25519 firma de forma DETERMINISTA: con el mismo payload y la misma clave
  // sale la misma firma. Por eso el identificador lleva azar; si no, revalidar
  // un pedido devolvería los códigos exactos que ya se le mandaron al comprador.
  const azar = new Uint8Array(4);
  crypto.getRandomValues(azar);
  const sufijo = [...azar].map((b) => b.toString(16).padStart(2, "0")).join("");
  const payload = new TextEncoder().encode(
    JSON.stringify({
      p: PALABRA,
      t: TIER,
      e: Math.floor(Date.now() / 1000) + DIAS * 24 * 60 * 60,
      i: `${folio}-${indice}-${sufijo}`.slice(0, 60),
    }),
  );
  const firma = new Uint8Array(await crypto.subtle.sign("Ed25519", clave, payload as BufferSource));
  return `${PREFIJO}${b64url(payload)}.${b64url(firma)}`;
}

/* ── Emisión ───────────────────────────────────────────────────────────── */

/**
 * Códigos `activo` del registro que todavía no se entregaron.
 *
 * El registro se lee de `bitly_codes_premium` (sigue siendo la fuente que mira
 * la app) y se descartan los que ya están en otros pedidos: si el mismo código
 * se entrega dos veces, el segundo comprador se encuentra con "código usado".
 */
async function libresDelRegistro(cantidad: number, enUso: Set<string>): Promise<string[]> {
  try {
    const registro = await leerRegistroCodigos();
    const libres: string[] = [];
    for (const [codigo, estado] of registro) {
      if (estado !== "activo" || enUso.has(codigo)) continue;
      libres.push(codigo);
      if (libres.length >= cantidad) break;
    }
    return libres;
  } catch (e) {
    console.error("[codigos] no se pudo leer el registro:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Emite `cantidad` códigos para un pedido.
 *
 * Primero intenta firmarlos (formato nuevo: la app los acepta sin depender del
 * registro y nadie más puede fabricarlos). Si no hay clave de firma, cae al
 * registro existente, que es lo que el panel ya ofrecía a mano — pero elegido
 * automáticamente, sin que el admin tenga que buscar uno.
 *
 * `enUso` son los códigos ya entregados en cualquier pedido: nunca se repiten.
 */
export async function emitirCodigos(
  cantidad: number,
  folio: string,
  enUso: Set<string>,
): Promise<ResultadoEmision> {
  const cuantos = Math.min(Math.max(1, Math.trunc(cantidad)), MAX_CODIGOS);

  try {
    const clave = await clavePrivada();
    if (clave) {
      const codigos: string[] = [];
      for (let i = 0; i < cuantos; i++) {
        let codigo = await firmar(clave, folio, i + 1);
        // Colisión prácticamente imposible (hay firma aleatoria en Ed25519),
        // pero si el mismo folio se re-emite dos veces el payload se repite:
        // se descarta cualquier código que ya esté en uso.
        let intento = 0;
        while (enUso.has(codigo) && intento++ < 4) {
          codigo = await firmar(clave, folio, i + 1 + intento * MAX_CODIGOS);
        }
        codigos.push(codigo);
        enUso.add(codigo);
      }
      // La demo acredita Premium consultando esta lista: un código firmado no
      // está en el registro de la app y sin este paso sonaría estándar.
      await registrarEmitidos(codigos, folio);
      return { ok: true, codigos, origen: "firma" };
    }
  } catch (e) {
    console.error("[codigos] firma falló:", e instanceof Error ? e.message : e);
  }

  const libres = await libresDelRegistro(cuantos, enUso);
  if (libres.length < cuantos) {
    return { ok: false, motivo: libres.length > 0 ? "sin_stock" : "sin_clave" };
  }
  for (const codigo of libres) enUso.add(codigo);
  return { ok: true, codigos: libres, origen: "registro" };
}
