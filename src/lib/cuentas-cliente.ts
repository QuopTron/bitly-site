/**
 * Token de la cuenta en este navegador.
 *
 * Se guarda aparte de los pedidos a propósito: el token de pedido sirve para
 * seguir UNA compra; este identifica la cuenta y se manda sólo a las server
 * functions de cuentas/pedidos. Si el visitante borra el storage, puede volver
 * a entrar con correo y contraseña.
 */

import { useEffect, useState } from "react";

const CLAVE = "bitly_cuenta_token";

/**
 * Avisa al resto de la página que la sesión cambió (entrar o salir).
 * La cuota de la demo escucha este evento para pasar a "ilimitado" en el acto,
 * sin recargar: el token vive en localStorage y el mismo tab no recibe `storage`.
 */
function avisarCambioCuenta(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("bitly-cuenta"));
}

export function leerTokenCuenta(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const token = localStorage.getItem(CLAVE);
    return token && token.length < 500 ? token : null;
  } catch {
    return null;
  }
}

export function guardarTokenCuenta(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLAVE, token);
  } catch {
    // sin storage la sesión vive sólo en esta pestaña
  }
  avisarCambioCuenta();
}

/**
 * ¿Hay sesión iniciada? Reactivo: se entera al entrar, al salir y al cambiar
 * el storage desde otra pestaña.
 *
 * Ojo: dice que el navegador TIENE token, no que el servidor lo acepte; para
 * eso está `miCuenta` (lo usa la cuota de la demo). Alcanza para decidir qué
 * mostrar: comprar con comprobante y el estado del pedido son cosas de sesión.
 */
export function useHayCuenta(): boolean {
  const [hay, setHay] = useState(false);

  useEffect(() => {
    const revisar = () => setHay(Boolean(leerTokenCuenta()));
    // Se lee después de hidratar, no en el primer render: en el servidor no hay
    // localStorage y el HTML saldría distinto al del cliente.
    revisar();
    window.addEventListener("bitly-cuenta", revisar);
    window.addEventListener("storage", revisar);
    return () => {
      window.removeEventListener("bitly-cuenta", revisar);
      window.removeEventListener("storage", revisar);
    };
  }, []);

  return hay;
}

export function quitarTokenCuenta(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
  avisarCambioCuenta();
}
