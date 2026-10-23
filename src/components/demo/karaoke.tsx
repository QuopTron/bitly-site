"use client";

import { useEffect, useState } from "react";
import type { Pista } from "@/lib/demo-catalog";
import { letrasDe } from "@/lib/demo-catalog";

type Linea = { t: number; texto: string };

/** Convierte LRC (`[mm:ss.xx] letra`, con varios timestamps por línea) a líneas. */
export function parseLrc(lrc: string): Linea[] {
  const lineas: Linea[] = [];
  for (const cruda of lrc.split(/\r?\n/)) {
    const texto = cruda
      .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();
    if (!texto) continue;
    for (const m of cruda.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)) {
      const min = Number(m[1]);
      const seg = Number(m[2]);
      const frac = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
      lineas.push({ t: min * 60 + seg + Number(frac) / 1000, texto });
    }
  }
  return lineas.sort((a, b) => a.t - b.t);
}

type Estado = {
  cargando: boolean;
  lineas: Linea[];
  plana: string | null;
};

/**
 * Ventana de letra centrada, estilo karaoke: el verso actual queda pintado en
 * el centro y los vecinos se apagan; al avanzar, las líneas entran y salen.
 * La letra llega del servidor (LRCLIB); tocar un verso salta a su segundo.
 */
export default function Karaoke({
  pista,
  avance,
  onBuscar,
}: {
  pista: Pista;
  avance: number;
  onBuscar: (seg: number) => void;
}) {
  const [estado, setEstado] = useState<Estado>({ cargando: true, lineas: [], plana: null });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ cargando: true, lineas: [], plana: null });

    const cargar = async (restantes: number): Promise<void> => {
      const letras = await letrasDe(pista).catch(() => null);
      if (!vivo) return;
      const lineas = letras?.lrc ? parseLrc(letras.lrc) : [];
      const plana = letras?.plana ?? null;
      // Sin datos (o con un LRC que no se pudo parsear) se reintenta: LRCLIB
      // falla de forma transitoria y antes el ♪ quedaba pegado toda la sesión.
      if (lineas.length === 0 && !plana && restantes > 1) {
        await new Promise((r) => setTimeout(r, 700));
        if (vivo) await cargar(restantes - 1);
        return;
      }
      setEstado({ cargando: false, lineas, plana });
    };

    void cargar(3);
    return () => {
      vivo = false;
    };
  }, [pista, intento]);

  // La letra se adelanta 0.5 s: el verso se pinta justo cuando empieza a
  // cantarse, no cuando el oído ya lo escuchó (el ojo va detrás del audio).
  let actual = -1;
  for (let i = 0; i < estado.lineas.length; i++) {
    if (estado.lineas[i].t <= avance + 0.5) actual = i;
    else break;
  }

  const centro = actual >= 0 ? actual : 0;
  const inicio = Math.max(0, Math.min(centro - 1, estado.lineas.length - 3));
  const visibles = estado.lineas.slice(inicio, inicio + 3);
  const plana = estado.plana?.split(/\r?\n/).find((l) => l.trim()) ?? null;

  if (!estado.cargando && visibles.length === 0 && !plana) {
    return (
      <div
        data-karaoke="1"
        className="mx-auto flex h-[44px] max-w-full items-center justify-center overflow-hidden rounded-[1.2rem_1.8rem_1.1rem_1.7rem] border border-white/10 bg-white/[0.04] px-3 text-center backdrop-blur-md"
      >
        <button
          type="button"
          onClick={() => setIntento((n) => n + 1)}
          title="Reintentar letra"
          className="text-[11px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/80"
        >
          ♪
        </button>
      </div>
    );
  }

  return (
    <div
      data-karaoke="1"
      className="relative mx-auto flex h-[44px] max-w-full flex-col justify-center overflow-hidden rounded-[1.2rem_1.8rem_1.1rem_1.7rem] border border-white/10 bg-white/[0.04] px-3 text-center shadow-inner backdrop-blur-md"
    >
      {estado.cargando ? (
        <span className="animate-pulse text-center text-[11px] text-muted-foreground/40">♪ · · ·</span>
      ) : visibles.length > 0 ? (
        <div
          className="flex flex-col justify-center gap-px"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)",
          }}
        >
          {visibles.map((linea, i) => {
            const indice = inicio + i;
            const activa = indice === actual;
            return (
              <button
                key={`${linea.t}-${indice}`}
                type="button"
                data-activa={activa ? "1" : undefined}
                onClick={() => onBuscar(linea.t)}
                className={`block w-full truncate text-center leading-tight transition-all duration-300 ${
                  activa
                    ? "anim-entra bg-gradient-to-r from-primary to-accent bg-clip-text text-[12px] font-bold text-transparent"
                    : "text-[10px] font-medium text-muted-foreground/45 hover:text-muted-foreground/80"
                }`}
              >
                {linea.texto}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="truncate text-center text-[11px] font-medium text-muted-foreground/60">{plana}</span>
      )}
    </div>
  );
}
