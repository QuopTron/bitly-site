/**
 * Libro de revendedores.
 *
 * Un revendedor es una cuenta normal del sitio con un `slug` de referido. El
 * vínculo vive en `bitly-data` (`data/revendedores.json`) para que el panel del
 * dueño, el panel del revendedor y la atribución de pedidos lean exactamente lo
 * mismo desde GitHub.
 *
 * Este archivo NO es una server function: sólo lee y escribe el libro. Así lo
 * pueden usar `cuentas.ts`, `pedidos.ts` y `asignaciones.ts` sin armar ciclos de
 * imports.
 */

import { getJson, putJson } from "@/server/github-store";

const ARCHIVO = "data/revendedores.json";
const MAX = 500;

export type EstadoRevendedor = "activo" | "suspendido" | "baneado";

export type RevendedorGuardado = {
  id: string;
  /** Cuenta del sitio que opera el panel de revendedor. */
  cuentaId: string;
  /** Identificador del enlace: `?ref=slug`. */
  slug: string;
  nombre: string;
  correo: string;
  /** Porcentaje que se lleva el revendedor (0-100). Sólo informativo. */
  comision: number;
  estado: EstadoRevendedor;
  creado: string;
  actualizado: string;
  motivoBaneo?: string;
  baneadoEn?: string;
};

export function limpiar(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

export function slugValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,31}$/.test(slug);
}

export function normalizarSlug(slug: unknown): string {
  return limpiar(slug, 32)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function nuevoIdRevendedor(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `rev_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function leerRevendedores(): Promise<RevendedorGuardado[]> {
  const lista = await getJson<RevendedorGuardado[]>("datos", ARCHIVO, []);
  return Array.isArray(lista)
    ? lista.filter((r) => r && typeof r.id === "string" && typeof r.cuentaId === "string")
    : [];
}

export async function guardarRevendedores(
  lista: RevendedorGuardado[],
  mensaje: string,
): Promise<boolean> {
  return putJson("datos", ARCHIVO, lista.slice(0, MAX), mensaje);
}

export async function revendedorPorId(id: string): Promise<RevendedorGuardado | null> {
  if (!id) return null;
  return (await leerRevendedores()).find((r) => r.id === id) ?? null;
}

export async function revendedorPorCuenta(
  cuentaId: string,
): Promise<RevendedorGuardado | null> {
  if (!cuentaId) return null;
  return (await leerRevendedores()).find((r) => r.cuentaId === cuentaId) ?? null;
}

export async function revendedorPorSlug(slug: string): Promise<RevendedorGuardado | null> {
  const buscado = normalizarSlug(slug);
  if (!buscado) return null;
  return (await leerRevendedores()).find((r) => r.slug === buscado) ?? null;
}

/**
 * Resuelve un `?ref=` a un revendedor que puede vender.
 *
 * Un revendedor suspendido o baneado no atribuye pedidos nuevos: si sigue
 * repartiendo su enlace, esas ventas no le cuentan ni le habilitan el panel.
 */
export async function revendedorActivoPorSlug(
  slug: unknown,
): Promise<RevendedorGuardado | null> {
  const encontrado = await revendedorPorSlug(normalizarSlug(slug));
  return encontrado?.estado === "activo" ? encontrado : null;
}
