/**
 * Foto de perfil: se achica en el navegador antes de mandarla.
 *
 * Una foto de celular pesa varios MB y `bitly-data` guarda las cuentas en un
 * JSON versionado: subir el original haría un commit enorme por cada cambio de
 * avatar. Acá se pinta en un canvas a 320 px de ancho y se exporta en JPEG, así
 * lo que viaja son decenas de KB.
 *
 * El mismo tope que aplica el servidor (`MAX_FOTO` en `server/cuentas.ts`).
 */

/** Ancho al que se achica (el alto sale en proporción). */
const LADO = 320;

/** Segundo intento, más chico, si el JPEG todavía no entra en el tope. */
const LADO_MINIMO = 192;

/** Tope del `data:` ya codificado, en caracteres. */
const TOPE = 200_000;

/**
 * Devuelve la foto lista para guardar (`data:image/jpeg;base64,…`).
 *
 * Lanza si el archivo no es una imagen que el navegador pueda decodificar; el
 * panel lo muestra como error y no cambia nada.
 */
export async function achicarFoto(archivo: File): Promise<string> {
  const mapa = await createImageBitmap(archivo);
  try {
    for (const lado of [LADO, LADO_MINIMO]) {
      const foto = pintar(mapa, lado);
      if (foto.length <= TOPE) return foto;
    }
    throw new Error("foto demasiado grande");
  } finally {
    mapa.close();
  }
}

/** Pinta el mapa de bits en un canvas y lo devuelve como JPEG. */
function pintar(mapa: ImageBitmap, lado: number): string {
  const escala = Math.min(1, lado / mapa.width);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(mapa.width * escala));
  lienzo.height = Math.max(1, Math.round(mapa.height * escala));
  const pincel = lienzo.getContext("2d");
  if (!pincel) throw new Error("sin canvas");
  pincel.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL("image/jpeg", 0.85);
}
