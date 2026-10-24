/**
 * Cifrado en reposo de la base de datos del sitio.
 *
 * La base es un repo privado de GitHub (`bitly-data`): privado alcanza para que
 * no lo lea cualquiera, pero no para que el CONTENIDO quede en claro en cada
 * commit, en los diffs, en la caché de GitHub o en una copia del repo. Con
 * `BITLY_DATA_SECRET` definido, `github-store` guarda cada archivo cifrado con
 * AES-256-GCM y una clave derivada (HKDF-SHA256) de ese secreto; sin la clave,
 * lo que hay en el repo son bytes opacos.
 *
 * Formato de un JSON cifrado (sigue siendo JSON para que sea un archivo más):
 *
 *   { "_cifrado": "aes-256-gcm", "v": 1, "iv": "<b64>", "datos": "<b64>" }
 *
 * Formato de un binario cifrado (comprobantes): los bytes son
 * `BLY1` + iv(12) + ciphertext. La marca de 4 bytes deja distinguir un archivo
 * cifrado de uno viejo en claro, así la migración no rompe nada: se lee lo que
 * haya y se reescribe cifrado la próxima vez que se guarde.
 *
 * El secreto vive SÓLO en el servidor (secreto del Worker / .env local). Si se
 * pierde o se cambia, los datos viejos no se pueden leer: hay que elegir uno y
 * guardarlo, como la clave de las sesiones.
 */

const MARCA = "aes-256-gcm";
const VERSION = 1;
/** "BLY1" en ASCII: cabecera de los binarios cifrados. */
const MAGIA = new Uint8Array([0x42, 0x4c, 0x59, 0x31]);
const SAL = "bitly-data-v1";
const INFO = "bitly-data/aes-256-gcm";
const IV_BYTES = 12;

export type Sobre = { _cifrado: string; v: number; iv: string; datos: string };

function secreto(): string | null {
  const s = (process.env.BITLY_DATA_SECRET ?? "").trim();
  // Un secreto corto es peor que ninguno: da falsa sensación de seguridad.
  return s.length >= 16 ? s : null;
}

/** ¿Hay clave? Si no, se guarda en claro (desarrollo y deploys sin configurar). */
export function cifradoActivo(): boolean {
  return secreto() !== null;
}

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

let claveCache: Promise<CryptoKey> | null = null;

function clave(): Promise<CryptoKey> {
  if (claveCache) return claveCache;
  const s = secreto();
  if (!s) return Promise.reject(new Error("Falta BITLY_DATA_SECRET"));
  claveCache = (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(codificador.encode(s)),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: codificador.encode(SAL), info: codificador.encode(INFO) },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return claveCache;
}

/* ── base64 ────────────────────────────────────────────────────────── */

export function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

/** Base64 de un texto UTF-8 (lo que se manda a la Contents API). */
export function textoABase64(texto: string): string {
  return aBase64(codificador.encode(texto));
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/* ── Texto (archivos JSON) ─────────────────────────────────────────── */

async function cifrar(bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const salida = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await clave(),
    new Uint8Array(bytes),
  );
  const junto = new Uint8Array(iv.length + salida.byteLength);
  junto.set(iv, 0);
  junto.set(new Uint8Array(salida), iv.length);
  return junto;
}

async function descifrar(junto: Uint8Array): Promise<Uint8Array> {
  if (junto.length <= IV_BYTES) throw new Error("dato cifrado incompleto");
  const iv = new Uint8Array(junto.subarray(0, IV_BYTES));
  const datos = junto.subarray(IV_BYTES);
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await clave(),
    new Uint8Array(datos),
  );
  return new Uint8Array(claro);
}

/** ¿Este JSON ya parseado es un sobre cifrado? */
export function esSobre(valor: unknown): valor is Sobre {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<Sobre>;
  return v._cifrado === MARCA && typeof v.iv === "string" && typeof v.datos === "string";
}

/** Cifra un texto y devuelve el sobre JSON (ya formateado para el archivo). */
export async function cifrarTexto(texto: string): Promise<string> {
  const bytes = await cifrar(codificador.encode(texto));
  const sobre: Sobre = {
    _cifrado: MARCA,
    v: VERSION,
    iv: aBase64(bytes.subarray(0, IV_BYTES)),
    datos: aBase64(bytes.subarray(IV_BYTES)),
  };
  return JSON.stringify(sobre, null, 2) + "\n";
}

/** Descifra un sobre y devuelve el texto original. */
export async function descifrarSobre(sobre: Sobre): Promise<string> {
  const iv = deBase64(sobre.iv);
  const datos = deBase64(sobre.datos);
  const junto = new Uint8Array(iv.length + datos.length);
  junto.set(iv, 0);
  junto.set(datos, iv.length);
  return decodificador.decode(await descifrar(junto));
}

/* ── Binarios (comprobantes) ───────────────────────────────────────── */

/** Cifra un archivo en base64 y devuelve base64 con la marca "BLY1". */
export async function cifrarBase64(contenido: string): Promise<string> {
  const claro = deBase64(contenido);
  const cifrado = await cifrar(claro);
  const junto = new Uint8Array(MAGIA.length + cifrado.length);
  junto.set(MAGIA, 0);
  junto.set(cifrado, MAGIA.length);
  return aBase64(junto);
}

/** Descifra si el archivo trae la marca; si no, lo devuelve tal cual. */
export async function descifrarBase64(contenido: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = deBase64(contenido);
  } catch {
    return contenido;
  }
  if (bytes.length < MAGIA.length + IV_BYTES) return contenido;
  if (!MAGIA.every((b, i) => bytes[i] === b)) return contenido;
  const claro = await descifrar(bytes.subarray(MAGIA.length));
  return aBase64(claro);
}
