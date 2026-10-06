/**
 * Datos de contacto, en un solo lugar.
 *
 * Los usan el pie de página y la burbuja flotante de Premium. Estaban duplicados
 * dentro de la burbuja: si cambia el número, había que acordarse de tocar los dos
 * lugares (y el del pie salía con otro formato). Acá vive la única copia.
 */

export const WHATSAPP = "+59173427418";
export const INSTAGRAM = "flox_devs_sucre";
export const INSTAGRAM_URL = "https://www.instagram.com/flox_devs_sucre/";
export const TIKTOK = "floxdevsucre";
export const TIKTOK_URL = "https://www.tiktok.com/@floxdevsucre";

/** Enlace de WhatsApp con el mensaje ya escrito. */
export function enlaceWhatsApp(texto: string): string {
  return `https://wa.me/${WHATSAPP.replace("+", "")}?text=${encodeURIComponent(texto)}`;
}
