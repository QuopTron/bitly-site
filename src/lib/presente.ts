/**
 * Latido de presencia desde el navegador.
 *
 * Una sola petición cada ~60 segundos (y enseguida al entrar, al volver a la
 * pestaña o al recuperar la conexión). Lleva un identificador aleatorio guardado
 * en `localStorage` —nunca la IP— para que el servidor cuente visitantes sin
 * sesión, más el token de la cuenta si hay sesión iniciada.
 *
 * Es "dispara y olvida": si falla (modo offline, red mala, servidor dormido) no
 * hay error visible ni reintento en bucle; el próximo minuto lo vuelve a probar.
 * `keepalive` deja que el último latido salga aunque la pestaña se esté cerrando.
 */

import { useEffect } from "react";
import { leerTokenCuenta } from "@/lib/cuentas-cliente";

const CLAVE = "bitly_presencia_id";
const INTERVALO_MS = 60_000;
/** Espera inicial: no competir con la hidratación ni con la primera visita. */
const ESPERA_INICIAL_MS = 1_500;

let idEnMemoria = "";

function azar(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identificador aleatorio y estable de este navegador (no identifica a nadie). */
function idDeVisita(): string {
  if (typeof window === "undefined") return "";
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado && guardado.length >= 16 && guardado.length <= 80) return guardado;
  } catch {
    // Sin storage: se usa uno por carga de página y listo.
  }
  if (!idEnMemoria) idEnMemoria = azar();
  try {
    localStorage.setItem(CLAVE, idEnMemoria);
  } catch {
    // modo privado: no se puede persistir, se cuenta igual en esta pestaña
  }
  return idEnMemoria;
}

/** Manda un latido. Seguro de llamar en cualquier momento. */
export function latirPresencia(): void {
  if (typeof window === "undefined") return;
  let cuerpo: string;
  try {
    cuerpo = JSON.stringify({ visita: idDeVisita(), token: leerTokenCuenta() ?? "" });
  } catch {
    return;
  }
  void fetch("/api/presente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo,
    keepalive: true,
    cache: "no-store",
    credentials: "same-origin",
  }).catch(() => undefined);
}

/**
 * Programa el latido mientras el componente esté montado.
 *
 * No late con la pestaña oculta (no suma gente que dejó el sitio abierto de
 * fondo) y sí late al volver a ella o al recuperar la red.
 */
export function useLatidoPresencia(): void {
  useEffect(() => {
    let vivo = true;
    let temporizador: number | undefined;

    const latir = () => {
      if (!vivo) return;
      if (document.visibilityState === "hidden") return;
      latirPresencia();
    };

    const programar = () => {
      if (!vivo) return;
      temporizador = window.setTimeout(() => {
        latir();
        programar();
      }, INTERVALO_MS);
    };

    const inicio = window.setTimeout(() => {
      latir();
      programar();
    }, ESPERA_INICIAL_MS);

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") latir();
    };
    const alVolverLaRed = () => latir();

    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener("online", alVolverLaRed);

    return () => {
      vivo = false;
      window.clearTimeout(inicio);
      if (temporizador) window.clearTimeout(temporizador);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("online", alVolverLaRed);
    };
  }, []);
}
