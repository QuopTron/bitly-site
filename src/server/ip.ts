/**
 * Server-only helper para obtener la IP del cliente sin tocar imports de
 * @tanstack/react-start/server desde módulos que el cliente pueda importar.
 *
 * El orden importa: la IP alimenta los cupos de la demo, del registro, de los
 * pedidos y del panel admin. Confiar en `X-Forwarded-For` a ciegas deja que
 * cualquiera invente una IP por request (el encabezado lo escribe el cliente) y
 * saltee todos esos límites. En Cloudflare el valor bueno está en
 * `CF-Connecting-IP`, que el edge sobrescribe y no se puede falsificar. Si algún
 * día el sitio corre detrás de otro proxy, se usa la ÚLTIMA entrada de
 * `X-Forwarded-For`, que es la que agregó el proxy más cercano, no la primera
 * (la del atacante).
 */

export async function obtenerIPCliente(): Promise<string> {
  try {
    const servidor = await import("@tanstack/react-start/server");
    const cabeceras = servidor.getRequestHeaders();

    const cf = cabeceras.get("cf-connecting-ip")?.trim();
    if (cf) return limitar(cf);

    const reenviadas = cabeceras.get("x-forwarded-for");
    if (reenviadas) {
      const partes = reenviadas.split(",").map((p) => p.trim()).filter(Boolean);
      const ultima = partes[partes.length - 1];
      if (ultima) return limitar(ultima);
    }

    const real = cabeceras.get("x-real-ip")?.trim();
    if (real) return limitar(real);

    return limitar(servidor.getRequestIP() ?? "anonima");
  } catch {
    return "anonima";
  }
}

/** Recorta y sanea: sólo se usa como clave de cupo, pero no queremos basura. */
function limitar(valor: string): string {
  return valor.replace(/[^\dA-Za-z.:_-]/g, "").slice(0, 64) || "anonima";
}
