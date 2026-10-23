export const VISTAS = [
  { id: "inicio", clave: "navInicio" },
  { id: "instalar", clave: "navInstalar" },
  { id: "planes", clave: "navPlanes" },
  { id: "demo", clave: "navDemo" },
] as const;

export type VistaId = (typeof VISTAS)[number]["id"];

export const EVENTO_NAVEGAR = "bitly:navegar";

export function esVista(id: string): id is VistaId {
  return VISTAS.some((v) => v.id === id);
}

export function navegarA(id: VistaId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_NAVEGAR, { detail: id }));
}
