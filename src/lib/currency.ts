import { useState, useEffect } from "react";

const RATES_URL = "https://open.er-api.com/v6/latest/BOB";
const MARKUP = 1.15;

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

let rates: Record<string, number> | null = null;
let current: Code = "BOB";
const listeners: Array<(c: Code) => void> = [];

function getStored(): Code {
  try {
    const v = localStorage.getItem("bitly_currency") as Code | null;
    return v && CODES.includes(v) ? v : "BOB";
  } catch {
    return "BOB";
  }
}

current = getStored();

export async function initRates() {
  try {
    const r = await fetch(RATES_URL);
    const d = await r.json();
    if (d?.rates) rates = d.rates;
  } catch {}
}

export function setCurrency(code: Code) {
  current = code;
  try { localStorage.setItem("bitly_currency", code); } catch {}
  listeners.forEach((fn) => fn(code));
  window.dispatchEvent(new CustomEvent("currencychange"));
}

export function getCurrency(): Code {
  return current;
}

export function useCurrency(): [Code, (c: Code) => void] {
  const [code, setCode] = useState(current);
  useEffect(() => {
    listeners.push(setCode);
    return () => {
      const idx = listeners.indexOf(setCode);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);
  return [code, setCurrency];
}

export function convert(priceBOB: number, to?: Code): number {
  const c = to ?? current;
  if (c === "BOB" || !rates) return priceBOB;
  const rate = rates[c];
  if (!rate) return priceBOB;
  return Math.round(priceBOB * rate * MARKUP);
}

export function format(priceBOB: number, to?: Code): string {
  const c = to ?? current;
  return `${INFO[c].sym} ${convert(priceBOB, c).toLocaleString()}`;
}
