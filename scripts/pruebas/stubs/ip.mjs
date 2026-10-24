export async function obtenerIPCliente() {
  return globalThis.__IP ?? "127.0.0.1";
}
