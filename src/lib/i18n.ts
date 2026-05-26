import { useState, useEffect } from "react";
import { DICT } from "./translations";

type Lang = "es" | "en";
let currentLang: Lang = "es";
const listeners: Array<(lang: Lang) => void> = [];

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "es";
  const stored = localStorage.getItem("bitly_lang") as Lang | null;
  return stored === "es" || stored === "en" ? stored : "es";
}

currentLang = getInitialLang();

export function setLanguage(lang: Lang) {
  currentLang = lang;
  if (typeof window !== "undefined") localStorage.setItem("bitly_lang", lang);
  listeners.forEach((fn) => fn(lang));
  window.dispatchEvent(new CustomEvent("langchange"));
}

export function getLanguage(): Lang {
  return currentLang;
}

export function useLanguage(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    listeners.push(setLang);
    return () => {
      const idx = listeners.indexOf(setLang);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);
  return [lang, setLanguage];
}

export function useI18n(): (key: string) => string {
  const [lang] = useLanguage();
  return (key: string) => {
    const pair = DICT[key];
    return pair ? pair[lang === "en" ? 1 : 0] : key;
  };
}

export function i18n(key: string): string {
  const pair = DICT[key];
  return pair ? pair[currentLang === "en" ? 1 : 0] : key;
}
