/**
 * Pedidos guardados en este navegador.
 *
 * El servidor no usa cookies ni cuentas: al crear un pedido devuelve un token
 * de seguimiento y acá se guarda junto al folio. Con eso el comprador puede
 * cerrar la página y volver a ver su estado y su código sin crear contraseña.
 */

export type PedidoLocal = {
  folio: string;
  token: string;
  creado: string;
};

const CLAVE = "bitly_pedidos";

export function leerPedidosLocales(): PedidoLocal[] {
  if (typeof window === "undefined") return [];
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as unknown;
    if (!Array.isArray(crudo)) return [];
    return crudo.filter(
      (p): p is PedidoLocal =>
        Boolean(p) &&
        typeof p === "object" &&
        typeof (p as PedidoLocal).folio === "string" &&
        typeof (p as PedidoLocal).token === "string",
    );
  } catch {
    return [];
  }
}

export function guardarPedidoLocal(pedido: PedidoLocal): void {
  if (typeof window === "undefined") return;
  try {
    const actuales = leerPedidosLocales().filter((p) => p.folio !== pedido.folio);
    localStorage.setItem(CLAVE, JSON.stringify([pedido, ...actuales].slice(0, 20)));
  } catch {
    // Sin almacenamiento el seguimiento vive sólo en esta pestaña.
  }
}

export function quitarPedidoLocal(folio: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(leerPedidosLocales().filter((p) => p.folio !== folio)));
  } catch {
    // nada
  }
}

export function hoyISO(): string {
  return new Date().toISOString();
}
