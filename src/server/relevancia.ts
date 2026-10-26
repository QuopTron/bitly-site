/**
 * ¿Los resultados de un catálogo no tienen NADA que ver con lo que se buscó?
 *
 * Pasa con folklore de nicho: el catálogo no encuentra al artista y devuelve el
 * disco de otro (buscar «Los Thuthanaka» traía temas de WEED420). Como había
 * resultados, la búsqueda terminaba ahí y YouTube nunca se consultaba: la
 * canción existe, pero el sitio decía que no.
 *
 * La señal de desvío es fuerte y conservadora a propósito:
 *
 *  · ninguna palabra SIGNIFICATIVA de la consulta (3 letras o más, sin
 *    artículos ni preposiciones) aparece en el título ni en el artista de
 *    ningún resultado, Y
 *  · todos los resultados son del MISMO artista.
 *
 * Lo de "significativa" no es un detalle: con la prueba ingenua, «Los
 * Thuthanaka» no se marcaba porque «Los» aparece en «La Guerra De Los Sexos»,
 * así que el desvío seguía pasando y YouTube no se consultaba nunca.
 *
 * Así una búsqueda por género («jazz», «guitarra») NO se marca como desviada:
 * ahí los resultados son de artistas distintos y el género es el filtro. Sólo
 * cae la típica respuesta de «te muestro el disco de otro».
 *
 * Vive en su propio módulo (sin `createServerFn`) para poder probarla sola.
 */

import { fieldScore } from "@/server/matching";
import type { Item } from "@/server/extensions";

/**
 * Palabras que no identifican nada: si contaran, «Los Thuthanaka» coincidiría
 * con cualquier título que tenga «Los».
 */
const VACIAS = new Set([
  "los", "las", "les", "del", "de", "desde", "para", "por", "que", "con", "una",
  "uno", "unos", "unas", "the", "and", "for", "with", "from", "vol", "feat",
]);

/** ¿Algún resultado contiene una palabra significativa de la consulta? */
export function tocaConsulta(items: Item[], consulta: string): boolean {
  const tokens = consulta
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !VACIAS.has(t.toLowerCase()));
  if (tokens.length === 0) return false;
  return items.some((i) =>
    tokens.some((t) => fieldScore(t, `${i.titulo} ${i.artista}`) >= 2),
  );
}

export function pareceDesvio(items: Item[], consulta: string): boolean {
  if (items.length === 0) return false;
  if (tocaConsulta(items, consulta)) return false;

  const artistas = new Set(
    items.map((i) => i.artista.trim().toLowerCase()).filter((a) => a.length > 0),
  );
  return artistas.size <= 1;
}
