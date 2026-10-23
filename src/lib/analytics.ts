/**
 * Seguimiento anónimo de la sesión: id aleatorio en `localStorage`, tiempo
 * visible en el sitio y sección actual. Se envía al servidor al entrar y cada
 * 45 s (o al ocultar la pestaña), que lo acumula en GitHub.
 *
 * No guarda IP, nombre ni ningún dato personal. Si el navegador bloquea el
 * almacenamiento, la sesión igual funciona con un id temporal en memoria.
 */

import { useEffect } from "react";
import { getLanguage } from "@/lib/i18n";
import { latidoSesion, registrarSesion } from "@/server/analytics";

const CLAVE = "bitly_sesion_id";
const INTERVALO_MS = 45_000;

let id: string | null = null;
let seccion = "inicio";
let ultimoLatido = Date.now();
let arrancada = false;
let timer: ReturnType<typeof setInterval> | null = null;

function idSesion(): string {
  if (id) return id;
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado && /^[a-z0-9-]{8,40}$/i.test(guardado)) {
      id = guardado;
      return id;
    }
  } catch {
    /* modo privado */
  }
  const nuevo =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  id = nuevo;
  try {
    localStorage.setItem(CLAVE, nuevo);
  } catch {
    /* sin storage: queda en memoria */
  }
  return nuevo;
}

function dispositivo(): string {
  const ancho = window.innerWidth;
  if (ancho < 640) return "celular";
  if (ancho < 1024) return "tablet";
  return "escritorio";
}

async function latir(): Promise<void> {
  if (!arrancada || document.hidden) return;
  const ahora = Date.now();
  const segundos = Math.round((ahora - ultimoLatido) / 1000);
  if (segundos < 5) return;
  ultimoLatido = ahora;
  try {
    await latidoSesion({ data: { id: idSesion(), segundos: Math.min(180, segundos), seccion } });
  } catch {
    /* sin red: el próximo latido lo reintenta */
  }
}

function alOcultar() {
  if (document.hidden) void latir();
}

function detener() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", alOcultar);
  window.removeEventListener("pagehide", alOcultar);
  arrancada = false;
}

function iniciar() {
  if (arrancada || typeof window === "undefined") return;
  arrancada = true;
  ultimoLatido = Date.now();
  void registrarSesion({
    data: {
      id: idSesion(),
      dispositivo: dispositivo(),
      idioma: getLanguage(),
      pantalla: `${window.innerWidth}x${window.innerHeight}`,
      origen: window.location.pathname + window.location.hash,
      seccion,
    },
  }).catch(() => undefined);
  timer = setInterval(() => void latir(), INTERVALO_MS);
  document.addEventListener("visibilitychange", alOcultar);
  window.addEventListener("pagehide", alOcultar);
}

/** Actualiza la sección actual y manda el tiempo acumulado de la anterior. */
export function marcarSeccion(vista: string) {
  if (vista === seccion) return;
  void latir();
  seccion = vista;
}

/** Arranca una sola vez por pestaña y refleja la vista activa. */
export function useAnalitica(vista: string) {
  useEffect(() => {
    marcarSeccion(vista);
  }, [vista]);

  useEffect(() => {
    iniciar();
    return () => detener();
  }, []);
}
