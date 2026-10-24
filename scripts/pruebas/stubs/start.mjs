export function createServerFn() {
  const api = {
    validator() { return api; },
    middleware() { return api; },
    handler(fn) { return async (arg) => fn(arg); },
  };
  return api;
}
export function createMiddleware() { return { server: (f) => f, client: (f) => f }; }
