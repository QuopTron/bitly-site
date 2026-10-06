import { useState, useEffect } from "react";
import { getLanguage } from "./i18n";

const RATES_URL = "https://open.er-api.com/v6/latest/BOB";

/** Cuánto rinde una cotización guardada: el cambio no se mueve en el día. */
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_KEY = "bitly_rates";

/**
 * Margen sobre la cotización real para las monedas que NO son BOB.
 *
 * El precio se piensa en bolivianos (Bs 30) y BOB se muestra tal cual; el
 * resto tiene que quedar un poco MÁS alto que la conversión pelada, no al
 * cambio. Con 1.20 los 30 Bs daban US$ 3 (regalado) y € 3; con 1.60 quedan
 * en US$ 4 y € 4. `scripts/capturas/revision` comprueba el valor en pantalla.
 */
const MARKUP = 1.6;

export const CODES = ["BOB", "USD", "EUR", "ARS", "PEN", "CLP", "BRL", "MXN", "COP"] as const;
export type Code = (typeof CODES)[number];

export const INFO: Record<Code, { sym: string; label: string }> = {
  BOB: { sym: "Bs",  label: "BOB" },
  USD: { sym: "US$", label: "USD" },
  EUR: { sym: "€",   label: "EUR" },
  ARS: { sym: "$",   label: "ARS" },
  PEN: { sym: "S/",  label: "PEN" },
  CLP: { sym: "$",   label: "CLP" },
  BRL: { sym: "R$",  label: "BRL" },
  MXN: { sym: "$",   label: "MXN" },
  COP: { sym: "$",   label: "COP" },
};

/**
 * Paso de redondeo "lindo" por moneda: 30 Bs no puede valer US$ 3,05 ni
 * COL$ 13.221. Se redondea al múltiplo de este paso para que el precio se lea
 * como una decisión y no como el resultado de una calculadora.
 */
const PASO: Record<Code, number> = {
  BOB: 1,
  USD: 1,
  EUR: 1,
  ARS: 100,
  PEN: 1,
  CLP: 100,
  BRL: 5,
  MXN: 5,
  COP: 500,
};

let rates: Record<string, number> | null = null;
let current: Code = "BOB";
let cargando: Promise<void> | null = null;

/**
 * Los suscriptores no reciben la moneda: se los invoca para que lean el módulo
 * de vuelta. Así, cuando llegan las cotizaciones (un evento posterior al
 * montaje), el mismo `setCode` dispara un re-render con el precio ya convertido.
 */
const listeners: Array<() => void> = [];

function leerCache(): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = localStorage.getItem(CACHE_KEY);
    if (!crudo) return null;
    const dato = JSON.parse(crudo);
    if (!dato?.rates || typeof dato.ts !== "number") return null;
    if (Date.now() - dato.ts > CACHE_TTL) return null;
    return dato.rates as Record<string, number>;
  } catch {
    return null;
  }
}

function guardarCache(r: Record<string, number>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rates: r }));
  } catch (e) {
    console.error("[Bitly] Failed to cache exchange rates:", e);
  }
}

function getStored(): Code {
  if (typeof window === "undefined") return "BOB";
  try {
    const v = localStorage.getItem("bitly_currency") as Code | null;
    return v && CODES.includes(v) ? v : "BOB";
  } catch {
    return "BOB";
  }
}

function avisar() {
  listeners.forEach((fn) => fn());
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("currencychange"));
}

if (typeof window !== "undefined") {
  current = getStored();
  // Las tasas del caché se aplican ya, sin esperar la red: así quien entró
  // con USD guardado ve el precio convertido en el primer render y no el de
  // bolivianos con símbolo de dólar pegado.
  rates = leerCache();
}

/**
 * Trae las cotizaciones. Deduplicada (index y la burbuja la llaman) y con
 * caché en localStorage, así una visita no vuelve a pegarle a la API.
 */
export function initRates(): Promise<void> {
  if (rates) return Promise.resolve();
  if (cargando) return cargando;
  cargando = (async () => {
    try {
      const r = await fetch(RATES_URL);
      const d = await r.json();
      if (d?.rates) {
        rates = d.rates;
        guardarCache(d.rates);
        avisar();
      }
    } catch (e) {
      console.error("[Bitly] Failed to fetch exchange rates:", e);
    } finally {
      cargando = null;
    }
  })();
  return cargando;
}

export function setCurrency(code: Code) {
  current = code;
  try { localStorage.setItem("bitly_currency", code); } catch (e) { console.error("[Bitly] Failed to save currency:", e); }
  avisar();
}

export function getCurrency(): Code {
  return current;
}

export function useCurrency(): [Code, (c: Code) => void] {
  // El contador, no la moneda: cuando llegan las cotizaciones la moneda no
  // cambió y un setState con el mismo valor no re-renderiza — el precio
  // recién convertido se quedaría sin pintar.
  const [, setTick] = useState(0);
  useEffect(() => {
    const sincronizar = () => setTick((n) => n + 1);
    listeners.push(sincronizar);
    return () => {
      const idx = listeners.indexOf(sincronizar);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);
  return [current, setCurrency];
}

/**
 * Moneda en la que conviene escribir hoy el precio.
 *
 * Sin cotización a mano (red caída o aún cargando) no se inventa nada: el
 * número de bolivianos se queda con su símbolo de bolivianos. Antes salía
 * «US$ 30» por un precio de 30 Bs, que es una mentira cara.
 */
function efectiva(c: Code): Code {
  if (c === "BOB") return c;
  return rates && typeof rates[c] === "number" ? c : "BOB";
}

function locale(): string {
  return getLanguage() === "en" ? "en-US" : "es-BO";
}

export function convert(priceBOB: number, to?: Code): number {
  const c = efectiva(to ?? current);
  if (c === "BOB") return priceBOB;
  if (priceBOB === 0) return 0;
  const rate = rates![c];
  const exacto = priceBOB * rate * MARKUP;
  const paso = PASO[c] ?? 1;
  // Nunca por debajo de un paso: un precio de 0 no existe.
  return Math.max(paso, Math.round(exacto / paso) * paso);
}

export function format(priceBOB: number, to?: Code): string {
  const c = efectiva(to ?? current);
  return `${INFO[c].sym} ${convert(priceBOB, c).toLocaleString(locale())}`;
}
