/**
 * Reglas de los chats: qué cuenta como nombre/asunto/mensaje válido y cuántos
 * hilos se abren por IP.
 *
 * Vive aparte de `src/server/chats.ts` por la misma razón que
 * `opiniones-reglas.ts`: así se prueba sola, sin red y sin el runtime del
 * servidor. No tiene secretos, así que también puede importarla el cliente.
 *
 * Abrir un chat cuesta un Issue en el repo, así que el cupo es bastante más
 * corto que el de las opiniones: un Issue de más no se puede deshacer con un
 * DELETE limpio (queda el historial).
 */

import { crearCupo } from "./opiniones-reglas";

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 24;
export const ASUNTO_MIN = 4;
export const ASUNTO_MAX = 90;
export const MENSAJE_MIN = 10;
export const MENSAJE_MAX = 1500;

/** Topes del cupo de apertura de chats. */
export const VENTANA_MS = 10 * 60 * 1000;
export const MAX_POR_IP = 2;
export const MAX_GLOBAL = 15;

/**
 * Cupo de chats: la misma fábrica que usan las opiniones, con los topes de
 * arriba. Instancia aparte — abrir un chat y publicar una opinión son cuotas
 * distintas y una no debería comerse la de la otra.
 */
export const hayCupoChat = crearCupo(MAX_POR_IP, MAX_GLOBAL, VENTANA_MS);

/**
 * Normaliza y valida un texto: colapsa los espacios repetidos, recorta los
 * extremos y comprueba el largo. Devuelve `null` si no sirve.
 */
export function limpiarTexto(valor: unknown, min: number, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (limpio.length < min || limpio.length > max) return null;
  return limpio;
}

/**
 * Resumen de un cuerpo de Issue para mostrarlo en la tarjeta: quita los saltos
 * de línea y los marcados habituales de Markdown, corta en `max`, y se queda
 * sólo con lo que escribió la persona — el pie que agrega `cuerpoDeChat` va
 * después del `---` y no aporta nada en la tarjeta.
 *
 * No es un parseo — React escapa al renderizar, así que sólo hay que evitar
 * que un bloque de código o el pie ocupen toda la tarjeta.
 */
export function resumirCuerpo(cuerpo: unknown, max = 160): string {
  if (typeof cuerpo !== "string") return "";
  // GitHub devuelve `\r\n` en los cuerpos escritos desde la web: sin unificar,
  // el corte del pie no encuentra `\n---\n` y se cuela en la tarjeta.
  const limpio = cuerpo.replace(/\r\n/g, "\n");
  // El pie vive después de la primera regla horizontal.
  const propio = limpio.split(/\n-{3,}\s*\n/)[0] ?? "";
  const plano = propio
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plano.length > max ? `${plano.slice(0, max - 1).trimEnd()}…` : plano;
}

/**
 * Cuerpo del Issue: deja el nombre de quien escribe a la vista, así quien
 * responde desde GitHub sabe con quién habla y el sitio no necesita cuentas.
 */
export function cuerpoDeChat(nombre: string, mensaje: string): string {
  return [`**De:** ${nombre}`, "", mensaje, "", "---", "_Enviado desde bitly-site_"].join("\n");
}

/**
 * "1 hilo" / "2 hilos", "1 respuesta" / "0 respuestas".
 *
 * En español el singular va en 1 y el plural en cualquier otro número —
 * incluido el 0, que se lee mal en singular.
 */
export function plural(n: number, uno: string, muchos: string): string {
  return n === 1 ? uno.replace("{n}", String(n)) : muchos.replace("{n}", String(n));
}
