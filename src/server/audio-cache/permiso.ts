/**
 * Permiso firmado para aportar un audio.
 *
 * El conteo de pedidos vive en KV, que no tiene incrementos atómicos ni lectura
 * consistente entre centros de datos: un `PUT` podía caer en otra instancia y
 * ver un número viejo aunque la canción ya hubiera cruzado el umbral. En vez de
 * revalidar ese contador, el sitio firma un permiso cuando decide que hay que
 * sembrar, y el aporte lo presenta.
 *
 * El permiso va atado a `clave|calidad` y vence: no sirve para otra canción ni
 * para siempre. Se firma con `BITLY_SESSION_SECRET` (HMAC-SHA256), el mismo
 * secreto que ya usa el sitio para las sesiones. Sin secreto no hay permiso y el
 * servidor vuelve al chequeo por contador.
 */

const VIDA_MS = 15 * 60 * 1000;

function secreto(): string {
  return String(process.env?.BITLY_SESSION_SECRET ?? "").trim();
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function firmaDe(texto: string, clave: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(texto)));
}

/** Comparación sin cortar en el primer byte distinto. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let distinto = 0;
  for (let i = 0; i < a.length; i += 1) distinto |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return distinto === 0;
}

/** `exp.firma` para `clave|calidad`, o `null` si el sitio no tiene secreto. */
export async function firmar(clave: string, calidad: string): Promise<string | null> {
  const llave = secreto();
  if (!llave) return null;
  const exp = Date.now() + VIDA_MS;
  return `${exp}.${await firmaDe(`${clave}|${calidad}|${exp}`, llave)}`;
}

/** Si el permiso es de esta canción, lo firmó el sitio y no venció. */
export async function verificar(
  permiso: unknown,
  clave: string,
  calidad: string,
): Promise<boolean> {
  const llave = secreto();
  const texto = String(permiso ?? "").trim();
  if (!llave || !texto) return false;
  const [expTxt, firma] = texto.split(".");
  const exp = Number(expTxt);
  if (!Number.isFinite(exp) || exp < Date.now() || !firma) return false;
  return iguales(await firmaDe(`${clave}|${calidad}|${exp}`, llave), firma);
}
