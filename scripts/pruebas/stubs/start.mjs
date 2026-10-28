export function createServerFn() {
  const api = {
    validator() { return api; },
    middleware() { return api; },
    handler(fn) { return async (arg) => fn(arg); },
  };
  return api;
}
export function createMiddleware() { return { server: (f) => f, client: (f) => f }; }
// Las rutas de /api/* se declaran con esto: devuelve el objeto tal cual, así la
// prueba puede llamar a los handlers de verdad (`Route.server.handlers.POST`).
export function createFileRoute(id) {
  const ruta = (opciones) => ({ id, ...opciones });
  return Object.assign(ruta, { id });
}
