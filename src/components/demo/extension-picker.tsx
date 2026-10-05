"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  CirclePlay,
  Cloud,
  Disc,
  Disc3,
  Music,
  Radio,
  ShoppingBag,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EXTENSIONES, type ExtensionId } from "@/lib/demo-extensiones";

/** Icono por extensión (el mismo criterio que `iconosFuente` de la app). */
const ICONOS: Record<ExtensionId, LucideIcon> = {
  deezer: Disc3,
  "spotify-web": Music,
  soundcloud: Cloud,
  "ytmusic-spotiflac": CirclePlay,
  "qobuz-web": Disc,
  "tidal-web": Waves,
  amazon: ShoppingBag,
  pandora: Radio,
};

export function colorDeFuente(id: ExtensionId): string {
  return EXTENSIONES.find((e) => e.id === id)?.color ?? "#1DB954";
}

/** Icono de la fuente, teñido con su color de marca. */
export function IconoFuente({ id, className = "" }: { id: ExtensionId; className?: string }) {
  const Icono = ICONOS[id] ?? Music;
  return <Icono className={className} style={{ color: colorDeFuente(id) }} />;
}

/**
 * Selector de fuente: botón circular con el icono de la fuente activa que abre
 * un panel con las 8 extensiones. Es el mismo patrón que el `AcordeonFuente`
 * de la app, resuelto con un popover propio.
 */
export default function ExtensionPicker({
  valor,
  onCambiado,
}: {
  valor: ExtensionId;
  onCambiado: (id: ExtensionId) => void;
}) {
  const t = useI18n();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const alClicar = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alClicar);
    document.addEventListener("keydown", alEsc);
    return () => {
      document.removeEventListener("mousedown", alClicar);
      document.removeEventListener("keydown", alEsc);
    };
  }, [abierto]);

  const activa = EXTENSIONES.find((e) => e.id === valor) ?? EXTENSIONES[0];
  const color = colorDeFuente(activa.id);

  return (
    <div ref={caja} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={`${t("demoSourcePicker")}: ${activa.nombre}`}
        title={`${t("demoSourcePicker")}: ${activa.nombre}`}
        className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-border/70 transition hover:ring-primary/40"
        style={{ backgroundColor: `${color}1F` }}
      >
        <IconoFuente id={activa.id} className="h-4 w-4" />
      </button>

      {abierto && (
        <div
          role="listbox"
          aria-label={t("demoSourcePicker")}
          className="absolute left-0 top-full z-30 mt-2 max-h-60 w-48 overflow-y-auto rounded-2xl border border-border bg-card/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur"
        >
          {EXTENSIONES.map((e) => {
            const sel = e.id === valor;
            return (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => {
                  onCambiado(e.id);
                  setAbierto(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs font-semibold transition ${
                  sel ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${e.color}22` }}
                >
                  <IconoFuente id={e.id} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{e.nombre}</span>
                {sel && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
