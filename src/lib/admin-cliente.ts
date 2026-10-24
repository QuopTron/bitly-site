/**
 * Sesión del panel en el navegador.
 *
 * Se guarda el token firmado que devuelve el servidor, nunca la clave. El token
 * vence solo (7 días) y deja de servir si se cambia la clave del panel.
 */

const CLAVE_TOKEN = "bitly_admin_token";
const CLAVE_EXPIRA = "bitly_admin_expira";
const CLAVE_CORREO = "bitly_admin_correo";

export type SesionAdmin = { token: string; expira: string; correo: string };

export function leerSesionAdmin(): SesionAdmin | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(CLAVE_TOKEN) ?? "";
    const expira = window.localStorage.getItem(CLAVE_EXPIRA) ?? "";
    if (!token) return null;
    if (expira && Date.parse(expira) <= Date.now()) {
      olvidarSesionAdmin();
      return null;
    }
    return { token, expira, correo: window.localStorage.getItem(CLAVE_CORREO) ?? "" };
  } catch {
    return null;
  }
}

export function guardarSesionAdmin(sesion: SesionAdmin): void {
  try {
    window.localStorage.setItem(CLAVE_TOKEN, sesion.token);
    window.localStorage.setItem(CLAVE_EXPIRA, sesion.expira);
    window.localStorage.setItem(CLAVE_CORREO, sesion.correo);
  } catch {
    /* modo privado sin almacenamiento: la sesión dura lo que la pestaña */
  }
}

export function olvidarSesionAdmin(): void {
  try {
    window.localStorage.removeItem(CLAVE_TOKEN);
    window.localStorage.removeItem(CLAVE_EXPIRA);
    window.localStorage.removeItem(CLAVE_CORREO);
  } catch {
    /* nada que borrar */
  }
}
