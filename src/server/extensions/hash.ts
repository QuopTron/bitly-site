/**
 * Hash en JavaScript puro para el shim de las extensiones.
 *
 * Las extensiones piden `utils.md5(texto)` y `utils.hmacSHA1(key, datos)`
 * de forma SÍNCRONA (el TOTP de Spotify se calcula dentro de una petición),
 * y WebCrypto solo ofrece SHA-1/HMAC de forma asíncrona. Como el runtime de
 * las extensiones corre funciones síncronas, estos dos algoritmos se
 * implementan acá: son chicos, deterministas y no dependen de ninguna
 * dependencia de npm.
 *
 * Referencias: RFC 1321 (MD5), FIPS 180-4 (SHA-1), RFC 2104 (HMAC).
 */

/* ── MD5 ─────────────────────────────────────────────────────────── */

function rotar(x: number, n: number) {
  return (x << n) | (x >>> (32 - n));
}

function md5(cadena: string): string {
  const bytes = new TextEncoder().encode(cadena);
  const n = bytes.length;
  const largo = n * 8;
  const tam = (((n + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(tam);
  buf.set(bytes);
  buf[n] = 0x80;
  // Longitud en bits, en little-endian, en los últimos 8 bytes.
  const vista = new DataView(buf.buffer);
  vista.setUint32(tam - 8, largo >>> 0, true);
  vista.setUint32(tam - 4, Math.floor(largo / 0x100000000), true);

  const K = new Uint32Array(64).map((_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000),
  );
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let bloque = 0; bloque < tam; bloque += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = vista.getUint32(bloque + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const tmp = D;
      D = C;
      C = B;
      B = B + rotar((A + F + K[i] + M[g]) >>> 0, S[i]);
      A = tmp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const salida = new Uint8Array(16);
  const sv = new DataView(salida.buffer);
  sv.setUint32(0, a0, true);
  sv.setUint32(4, b0, true);
  sv.setUint32(8, c0, true);
  sv.setUint32(12, d0, true);
  return [...salida].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── SHA-1 ───────────────────────────────────────────────────────── */

function sha1(datos: Uint8Array): Uint8Array {
  const n = datos.length;
  const largo = n * 8;
  const tam = (((n + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(tam);
  buf.set(datos);
  buf[n] = 0x80;
  const vista = new DataView(buf.buffer);
  vista.setUint32(tam - 8, Math.floor(largo / 0x100000000), false);
  vista.setUint32(tam - 4, largo >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let bloque = 0; bloque < tam; bloque += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(bloque + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotar(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (rotar(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotar(b, 30);
      b = a;
      a = tmp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const salida = new Uint8Array(20);
  const sv = new DataView(salida.buffer);
  sv.setUint32(0, h0, false);
  sv.setUint32(4, h1, false);
  sv.setUint32(8, h2, false);
  sv.setUint32(12, h3, false);
  sv.setUint32(16, h4, false);
  return salida;
}

/* ── Expuestos para el shim ──────────────────────────────────────── */

/** `utils.md5(texto)` → hex en minúsculas. */
export function md5Hex(texto: string): string {
  return md5(texto);
}

/** `utils.hmacSHA1(clave, datos)` con arreglos de bytes, como en la app. */
export function hmacSha1(clave: number[] | Uint8Array, datos: number[] | Uint8Array): number[] {
  const k = Uint8Array.from(clave ?? []);
  const bloque = 64;
  let llave = k.length > bloque ? sha1(k) : k;
  if (llave.length < bloque) {
    const ext = new Uint8Array(bloque);
    ext.set(llave);
    llave = ext;
  }

  const ipad = new Uint8Array(bloque);
  const opad = new Uint8Array(bloque);
  for (let i = 0; i < bloque; i++) {
    ipad[i] = llave[i] ^ 0x36;
    opad[i] = llave[i] ^ 0x5c;
  }

  const cuerpo = Uint8Array.from(datos ?? []);
  const dentro = new Uint8Array(bloque + cuerpo.length);
  dentro.set(ipad);
  dentro.set(cuerpo, bloque);
  const h1 = sha1(dentro);

  const fuera = new Uint8Array(bloque + h1.length);
  fuera.set(opad);
  fuera.set(h1, bloque);
  return Array.from(sha1(fuera));
}
