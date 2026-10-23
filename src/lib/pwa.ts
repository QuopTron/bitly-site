/**
 * PWA: registro del service worker, detección del modo app y bloqueo de
 * descarga del audio.
 *
 * Tres cosas viven acá:
 *
 * 1. `registrarServiceWorker()` — da de alta `/sw.js`. Sólo en producción y
 *    sólo una vez: en desarrollo el SW estorba (sirve un bundle viejo y hay
 *    que apretar Ctrl+Shift+R).
 *
 * 2. `esStandalone()` / `useEsStandalone()` — ¿está corriendo como app
 *    instalada? El display-mode standalone es el de Android/Chrome; en iOS
 *    Safari "Agregar a pantalla de inicio" pone `navigator.standalone`. Esa
 *    señal es la que usa el reproductor para cerrar la posibilidad de guardar
 *    el audio.
 *
 * 3. `bloquearDescarga()` — apaga lo que permitiría bajar la canción desde la
 *    PWA: el menú contextual sobre el reproductor y los atajos de
 *    guardar/imprimir/fuentes. No toca el resto de la página: afuera del
 *    marcador `[data-bloqueo-descarga]` el clic derecho sigue normal.
 *
 * Ninguna de estas barreras es un candado de seguridad — el audio se sirve
 * cifrado y no expone URL, pero con devtools siempre se puede. Lo que hacen es
 * que guardar la pista no sea una acción a un clic dentro de la app instalada.
 */

import { useCallback, useEffect, useState } from "react";

/** ¿Está abierta como app instalada (y no como pestaña del navegador)? */
export function esStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.matchMedia?.("(display-mode: minimal-ui)").matches) return true;
    // iOS Safari / Home Screen.
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  } catch {
    /* navegadores viejos sin matchMedia */
  }
  return false;
}

/** Lo mismo que `esStandalone`, pero reactivo: cambia si el usuario instala. */
export function useEsStandalone(): boolean {
  const [valor, setValor] = useState(false);
  useEffect(() => {
    const leer = () => setValor(esStandalone());
    leer();
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(display-mode: standalone)");
      mq.addEventListener?.("change", leer);
    } catch {
      /* sin soporte: se queda en el valor leído una vez */
    }
    return () => mq?.removeEventListener?.("change", leer);
  }, []);
  return valor;
}

/** Registra el service worker. Seguro de llamar varias veces. */
export function registrarServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // En dev el bundler no versiona igual que en prod: un SW cacheado deja la
  // pestaña pegada al bundle viejo. Además las capturas de QA miden la página
  // real, no una servida desde caché.
  if (import.meta.env.DEV) return;

  const registrar = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((e) => console.warn("[pwa] no se pudo registrar el SW:", e?.message ?? e));
  };

  if (document.readyState === "complete") registrar();
  else window.addEventListener("load", registrar, { once: true });
}

/**
 * Instalación desde el propio sitio.
 *
 * Chrome/Edge disparan `beforeinstallprompt` cuando la app cumple los
 * requisitos (manifest, iconos y service worker). Guardamos ese evento para
 * ofrecer un botón "Instalar app" y, si el visitante acepta, avisamos con
 * `true` para poder contarlo como una descarga más.
 */
type EventoInstalacion = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let eventoInstalacion: EventoInstalacion | null = null;
let yaInstalada = false;
const suscriptores = new Set<() => void>();

function avisarInstalacion() {
  suscriptores.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  yaInstalada = esStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    eventoInstalacion = e as EventoInstalacion;
    avisarInstalacion();
  });
  window.addEventListener("appinstalled", () => {
    eventoInstalacion = null;
    yaInstalada = true;
    avisarInstalacion();
  });
}

/** ¿El navegador ya nos dio un evento de instalación pendiente? */
export function pwaInstalable(): boolean {
  return Boolean(eventoInstalacion) && !yaInstalada;
}

/** Estado reactivo + acción para abrir el diálogo nativo de instalación. */
export function useInstalacionPwa() {
  const [disponible, setDisponible] = useState(false);
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    const leer = () => {
      setDisponible(pwaInstalable());
      setInstalada(yaInstalada || esStandalone());
    };
    leer();
    suscriptores.add(leer);
    return () => {
      suscriptores.delete(leer);
    };
  }, []);

  const instalar = useCallback(async (): Promise<boolean> => {
    const evento = eventoInstalacion;
    if (!evento) return false;
    try {
      await evento.prompt();
      const eleccion = await evento.userChoice;
      if (eleccion.outcome !== "accepted") return false;
      eventoInstalacion = null;
      yaInstalada = true;
      avisarInstalacion();
      return true;
    } catch {
      return false;
    }
  }, []);

  return { disponible: disponible && !instalada, instalada, instalar };
}

/** Atajos que guardan, imprimen o exponen el origen de la página. */
const ATAJOS_BLOQUEADOS = new Set(["s", "p", "u"]);

/**
 * Apaga la descarga del audio dentro de la PWA instalada.
 *
 * Devuelve la función que lo deshace (el `cleanup` del `useEffect`). Sólo hace
 * falta llamarlo cuando `esStandalone()` es verdadero: en el navegador normal
 * no se toca nada.
 */
export function bloquearDescarga(): () => void {
  if (typeof document === "undefined") return () => {};

  const alMenu = (e: MouseEvent) => {
    const destino = e.target as HTMLElement | null;
    if (destino?.closest("[data-bloqueo-descarga]")) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const alTecho = (e: Event) => {
    const destino = e.target as HTMLElement | null;
    if (destino?.closest("[data-bloqueo-descarga]")) e.preventDefault();
  };

  const aLaTecla = (e: KeyboardEvent) => {
    const combinada = e.ctrlKey || e.metaKey;
    if (!combinada) return;
    const tecla = e.key.toLowerCase();
    if (ATAJOS_BLOQUEADOS.has(tecla)) {
      e.preventDefault();
      return;
    }
    // DevTools / ver código: sólo con el reproductor a la vista, así quien
    // está leyendo el resto de la página no se encuentra con atajos muertos.
    if (e.shiftKey && ["i", "j", "c"].includes(tecla) && document.activeElement?.closest("[data-bloqueo-descarga]")) {
      e.preventDefault();
    }
  };

  document.addEventListener("contextmenu", alMenu, { capture: true });
  document.addEventListener("dragstart", alTecho, { capture: true });
  document.addEventListener("keydown", aLaTecla);

  return () => {
    document.removeEventListener("contextmenu", alMenu, { capture: true });
    document.removeEventListener("dragstart", alTecho, { capture: true });
    document.removeEventListener("keydown", aLaTecla);
  };
}
