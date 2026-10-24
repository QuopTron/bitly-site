/* Correo de prueba: no envía nada, guarda el mensaje para leer el código. */
export function correoConfigurado() {
  return true;
}
export function correoAdmin() {
  return "admin@prueba.test";
}
export async function enviarCorreo(correo) {
  (globalThis.__CORREOS ??= []).push(correo);
  return { ok: true, via: "webhook" };
}
