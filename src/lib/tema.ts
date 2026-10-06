/**
 * Tema del sitio: una sola dueña de la clave y de cómo se aplica.
 *
 * El tema se marca con una clase en `<html>`: `light`, `dark`, o ninguna (que es
 * el oscuro de marca declarado en `:root`; `.dark` es idéntico a propósito).
 *
 * Antes la preferencia se GUARDABA en `localStorage` pero nadie la leía al
 * cargar: al recargar, el tema volvía siempre al de fábrica. Acá vive la clave,
 * su lectura y el script mínimo que la aplica ANTES del primer pintado
 * (`SCRIPT_TEMA_INICIAL`), que es lo que evita el destello claro al entrar.
 */

export const CLAVE_TEMA = "bitly_theme";

export type Tema = "light" | "dark";

/** Lo guardado, con el oscuro como respuesta si no hay nada (o no hay storage). */
export function temaGuardado(): Tema {
  try {
    return localStorage.getItem(CLAVE_TEMA) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Aplica el tema a `<html>` y lo recuerda. Único lugar que toca la clase. */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  raiz.classList.remove("light", "dark");
  raiz.classList.add(tema);
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    /* modo privado sin storage: el tema vale para esta visita */
  }
}

/**
 * Script que va inline en el `<head>`: corre antes de que se pinte nada, así el
 * tema guardado se ve desde el primer cuadro. No depende de React ni del bundle.
 */
export const SCRIPT_TEMA_INICIAL =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)});` +
  `var r=document.documentElement;r.classList.remove("light","dark");` +
  `r.classList.add(t==="light"?"light":"dark");}catch(e){}})();`;
