/**
 * Server-only helper para obtener la IP del cliente sin tocar imports de
 * @tanstack/react-start/server desde módulos que el cliente pueda importar.
 */

export async function obtenerIPCliente(): Promise<string> {
  try {
    const servidor = await import("@tanstack/react-start/server");
    return servidor.getRequestIP({ xForwardedFor: true }) ?? "anonima";
  } catch {
    return "anonima";
  }
}
