/**
 * Cifrado de la búsqueda de la demo: ECDH P-256 + HKDF-SHA256 + AES-256-GCM.
 *
 * Capa de aplicación sobre TLS (esto NO reemplaza a HTTPS): sirve para que la
 * consulta del visitante no viaje en claro dentro del cuerpo de la petición,
 * así un interceptor de borde, un registro de acceso o un sniffing de nivel
 * aplicación no ve qué busca nadie. La clave efímera se renueva por sesión.
 *
 * El mismo módulo lo usan el navegador (`src/lib/demo-api.ts`) y el servidor
 * (`src/server/demo-proxy.ts`): solo WebCrypto, disponible en ambos.
 */

const SALTO = new TextEncoder().encode("bitly-demo-busqueda|v1");
const ETIQUETA = new TextEncoder().encode("bitly-demo-consulta|v1");

export type Cifrado = { iv: string; datos: string };

function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function desdeBase64(texto: string): Uint8Array<ArrayBuffer> {
  const bin = atob(texto);
  const salida = new Uint8Array<ArrayBuffer>(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) salida[i] = bin.charCodeAt(i);
  return salida;
}

/** Par efímero de la sesión (la privada nunca sale del equipo que la creó). */
export async function generarPar(): Promise<{ privada: CryptoKey; publica: CryptoKey; jwk: JsonWebKey }> {
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  return { privada: par.privateKey, publica: par.publicKey, jwk };
}

export async function importarPublica(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

/** Clave AES-256 compartida a partir de la pública del otro lado. */
export async function derivarClave(privada: CryptoKey, publicaAjena: CryptoKey): Promise<CryptoKey> {
  // ECDH → 256 bits → HKDF → AES-256-GCM. El salto y la etiqueta atan la
  // clave a esta demo, así una clave derivada en otro contexto no sirve.
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicaAjena }, privada, 256);
  const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALTO, info: ETIQUETA },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function cifrar(clave: CryptoKey, texto: string): Promise<Cifrado> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    clave,
    new TextEncoder().encode(texto),
  );
  return { iv: aBase64(iv), datos: aBase64(new Uint8Array(datos)) };
}

export async function descifrar(clave: CryptoKey, { iv, datos }: Cifrado): Promise<string> {
  const descifrado = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: desdeBase64(iv) },
    clave,
    desdeBase64(datos),
  );
  return new TextDecoder().decode(descifrado);
}
