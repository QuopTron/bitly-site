/**
 * Enlace de referido de un revendedor.
 *
 * El slug viaja en `?ref=` (o en `/r/<slug>`, que redirige a `?ref=`). Se guarda
 * en el navegador para que la persona no pierda la atribución si navega antes de
 * comprar o de registrarse: el pedido y la cuenta se crean minutos u horas
 * después, y el servidor sólo recibe el slug en ese momento.
 *
 * Es del lado del cliente a propósito: el servidor no puede saber de dónde vino
 * una visita. El slug NO es secreto ni prueba nada: el servidor lo valida contra
 * `data/revendedores.json` y descarta uno suspendido o inventado.
 */

const CLAVE = "bitly_ref";
/** Un referido dura 60 días: más que eso ya no es la misma campaña. */
const VIGENCIA_MS = 60 * 24 * 60 * 60 * 1000;

type Guardado = { slug: string; t: number };

export function normalizarRef(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function leerCrudo(): Guardado | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as unknown;
    if (!crudo || typeof crudo !== "object") return null;
    const slug = normalizarRef((crudo as Guardado).slug);
    const t = Number((crudo as Guardado).t);
    if (!slug || !Number.isFinite(t)) return null;
    if (Date.now() - t > VIGENCIA_MS) {
      localStorage.removeItem(CLAVE);
      return null;
    }
    return { slug, t };
  } catch {
    return null;
  }
}

/** Guarda un slug (lo llama `/r/<slug>` o `capturarReferido`). */
export function guardarReferido(slug: unknown): string | null {
  const limpio = normalizarRef(slug);
  if (typeof window === "undefined" || !limpio) return null;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ slug: limpio, t: Date.now() }));
  } catch {
    // sin storage el referido vive sólo en esta pestaña
  }
  return limpio;
}

/**
 * Lee `?ref=` de la URL y, si viene, lo guarda. Devuelve el slug vigente.
 *
 * Se llama una vez en el layout raíz, así funciona también cuando la persona
 * entra directo a una sección con `#hash`.
 */
export function capturarReferido(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const enUrl = normalizarRef(url.searchParams.get("ref"));
    if (enUrl) return guardarReferido(enUrl);
  } catch {
    // URL rara: se usa lo que ya estuviera guardado
  }
  return leerCrudo()?.slug ?? null;
}

/** Slug vigente para mandar al crear un pedido o una cuenta. */
export function referidoActual(): string | null {
  if (typeof window === "undefined") return null;
  return leerCrudo()?.slug ?? null;
}

export function olvidarReferido(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
}
