const datos = (globalThis.__STORE ??= new Map());
export async function getJson(_repo, ruta, defecto) {
  return datos.has(ruta) ? JSON.parse(datos.get(ruta)) : defecto;
}
export async function putJson(_repo, ruta, valor) {
  datos.set(ruta, JSON.stringify(valor));
  return true;
}
export async function leerStats() { return globalThis.__STATS ?? {}; }
export async function getArchivo() { return null; }
export async function putArchivo() { return true; }
export async function borrarArchivo() { return true; }
