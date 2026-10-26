"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronRight, Download, ListPlus, Loader2, Pause, Play } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Pista } from "@/lib/demo-catalog";

/** Deslizar a la derecha: cuántos píxeles hay que recorrer para encolar. */
const UMBRAL_COLA = 64;
/** Tope del desplazamiento, para que la fila no se vaya de largo. */
const TOPE_COLA = 92;

function Plantilla(texto: string, vars: Record<string, string | number>) {
  return texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const CLAVES_TIPO: Record<Pista["tipo"], string> = {
  track: "demoKindTrack",
  album: "demoKindAlbum",
  artist: "demoKindArtist",
  playlist: "demoKindPlaylist",
};

const mmss = (seg: number) => {
  const t = Math.max(0, Math.floor(seg));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
};

const letraDe = (texto: string) => (texto.trim()[0] ?? "\u266a").toUpperCase();

function Cover({ p, clase }: { p: Pista; clase: string }) {
  if (p.caratula) {
    return <img src={p.caratula} alt="" loading="lazy" className={`${clase} object-cover`} />;
  }
  return (
    <span
      aria-hidden
      className={`${clase} flex items-center justify-center font-black text-primary-foreground`}
      style={{ backgroundImage: "var(--gradiente-marca)" }}
    >
      {letraDe(p.titulo)}
    </span>
  );
}

export function TarjetaColeccion({
  p,
  onAbrir,
  indice = 0,
}: {
  p: Pista;
  onAbrir: () => void;
  indice?: number;
}) {
  const t = useI18n();
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={Plantilla(t("demoAbrirItem"), { nombre: p.titulo })}
      className="anim-entra group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-card/30 p-2 text-left shadow-lg shadow-black/20 backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/50 active:scale-[0.98]"
      style={{ animationDelay: `${Math.min(indice, 8) * 35}ms` }}
    >
      {/* Vidrio sobre la portada: el color que domina la carátula tiñe la
          tarjeta entera. Sin la imagen, el degradado de marca hace lo mismo. */}
      {p.caratula ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 scale-125 opacity-40 blur-2xl"
          style={{ backgroundImage: `url(${p.caratula})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      ) : (
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "var(--gradiente-marca)" }} />
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.06] via-transparent to-black/30" />
      <span className="relative block aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm">
        <Cover p={p} clase="h-full w-full" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-80" />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
          {t(CLAVES_TIPO[p.tipo])}
        </span>
        <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg transition duration-200 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
          <ChevronRight className="h-4 w-4" />
        </span>
      </span>
      <span className="min-w-0 px-0.5">
        <span className="block truncate text-xs font-bold leading-tight">{p.titulo}</span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
          {p.artista || t(CLAVES_TIPO[p.tipo])}
        </span>
      </span>
    </button>
  );
}

export function FilaCancion({
  p,
  activa,
  sonando,
  preparando,
  descargando,
  progreso,
  onReproducir,
  onDescargar,
  onEncolar,
  onAbrirCola,
  enCola = false,
  indice = 0,
}: {
  p: Pista;
  activa: boolean;
  sonando: boolean;
  preparando: boolean;
  descargando: boolean;
  progreso: number | null;
  onReproducir: () => void;
  onDescargar: () => void;
  /** Deslizar la tarjeta a la derecha: con esto nacen las colas. */
  onEncolar?: () => void;
  /** Abre la cola como ventana emergente desde la propia tarjeta. */
  onAbrirCola?: () => void;
  enCola?: boolean;
  indice?: number;
}) {
  const t = useI18n();
  const porcentaje = progreso !== null && progreso >= 0 ? progreso : null;

  // Arrastre horizontal con el dedo (o el mouse): la fila sigue al puntero y,
  // si pasa el umbral, se encola. El desplazamiento vertical lo sigue manejando
  // el contenedor (`touch-action: pan-y`).
  const [dx, setDx] = useState(0);
  const desde = useRef<number | null>(null);

  const empezar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onEncolar) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    desde.current = e.clientX;
  };
  const mover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (desde.current === null) return;
    const recorrido = e.clientX - desde.current;
    setDx(Math.max(0, Math.min(TOPE_COLA, recorrido)));
  };
  const soltar = () => {
    if (desde.current === null) return;
    desde.current = null;
    if (dx >= UMBRAL_COLA) onEncolar?.();
    setDx(0);
  };

  const enMovimiento = dx > 0;
  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Lo que queda detrás de la fila mientras se desliza. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center gap-1.5 rounded-2xl bg-primary/15 pl-3 text-[11px] font-bold text-primary transition-opacity ${
          dx > 8 ? "opacity-100" : "opacity-0"
        }`}
      >
        {enCola ? <Check className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />}
        {enCola ? t("demoColaQuitar") : t("demoEncolar")}
      </span>
    <div
      onPointerDown={empezar}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      onPointerLeave={soltar}
      style={{
        animationDelay: `${Math.min(indice, 8) * 35}ms`,
        transform: dx ? `translateX(${dx}px)` : undefined,
        touchAction: "pan-y",
      }}
      aria-busy={preparando || undefined}
      className={`anim-entra group relative flex items-center gap-2 overflow-hidden rounded-2xl border p-2 pr-1.5 backdrop-blur-xl ${
        enMovimiento ? "transition-none" : "transition duration-200"
      } ${
        preparando
          ? "border-primary/40 bg-primary/10"
          : activa
            ? "border-primary/30 bg-primary/12"
            : "border-white/10 bg-card/35 hover:border-border/70 hover:bg-card/55"
      }`}
    >
      {/* El color de la portada tiñe la fila (vidrio esmerilado). */}
      {p.caratula ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-6 w-40 scale-125 opacity-30 blur-2xl"
          style={{ backgroundImage: `url(${p.caratula})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      ) : (
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "var(--gradiente-marca)" }} />
      )}
      {/* Barra de espera: mientras se busca el audio no hay nada que oír, pero
          sí algo que ver. Sin esto, en el celular el toque parecía no hacer nada
          hasta que la pista arrancaba (o hasta que fallaba, en silencio). */}
      {preparando && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <span className="anim-espera block h-full w-1/3 rounded-full bg-primary" />
        </span>
      )}
      <button
        type="button"
        onClick={onReproducir}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`${t("demoPlayPause")}: ${p.titulo}`}
      >
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-sm sm:h-14 sm:w-14">
          <Cover p={p} clase="h-full w-full" />
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/35 transition ${
              preparando || activa ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow">
              {preparando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : activa && sonando ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5 translate-x-px" />
              )}
            </span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-bold leading-tight ${activa ? "text-primary" : ""}`}>
            {p.titulo}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
            {preparando ? (
              <span className="inline-flex items-center gap-1 font-semibold text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("demoCargandoAudio")}
              </span>
            ) : (
              [p.artista, p.album].map((s) => s.trim()).filter(Boolean).join(" \u00b7 ") || "\u00a0"
            )}
          </span>
        </span>
      </button>
      {p.duracion > 0 && (
        <span className="hidden shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground sm:block">
          {mmss(p.duracion)}
        </span>
      )}
      {onAbrirCola && (
        <button
          type="button"
          onClick={onAbrirCola}
          title={enCola ? t("demoColaAbrir") : t("demoEncolar")}
          aria-label={enCola ? t("demoColaAbrir") : t("demoEncolar")}
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 transition ${
            enCola
              ? "bg-primary/15 text-primary ring-primary/30"
              : "text-muted-foreground ring-border/50 hover:bg-primary/10 hover:text-primary hover:ring-primary/30"
          }`}
        >
          {enCola ? <Check className="h-3.5 w-3.5" /> : <ListPlus className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={onDescargar}
        disabled={descargando}
        title={Plantilla(t("demoDescargarAria"), { nombre: p.titulo })}
        aria-label={Plantilla(t("demoDescargarAria"), { nombre: p.titulo })}
        className={`relative flex h-8 shrink-0 items-center gap-1 overflow-hidden rounded-full px-2 text-[10px] font-bold ring-1 transition ${
          descargando
            ? "bg-primary/15 text-primary ring-primary/30"
            : "text-muted-foreground ring-border/50 hover:bg-primary/10 hover:text-primary hover:ring-primary/30"
        }`}
      >
        {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        <span className="hidden min-w-5 text-center tabular-nums sm:block">
          {descargando ? (porcentaje !== null ? `${porcentaje}%` : "\u2026") : ""}
        </span>
        {descargando && (
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15">
            <span
              className={`block h-full bg-primary transition-[width] duration-200 ${porcentaje === null ? "w-1/3 animate-pulse" : ""}`}
              style={porcentaje !== null ? { width: `${Math.max(4, porcentaje)}%` } : undefined}
            />
          </span>
        )}
      </button>
      {enCola && !descargando && (
        <span
          className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
          title={t("demoEnCola")}
        >
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
    </div>
  );
}

export function CabeceraDetalle({
  p,
  total,
  cargando,
  onVolver,
  onReproducirTodo,
}: {
  p: Pista;
  total: number;
  cargando: boolean;
  onVolver: () => void;
  onReproducirTodo: () => void;
}) {
  const t = useI18n();
  return (
    <div className="anim-entra relative overflow-hidden rounded-[1.4rem] border border-border/60 bg-card/50 p-3 sm:p-4">
      {p.caratula && (
        <img
          src={p.caratula}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full object-cover opacity-25 blur-3xl"
        />
      )}
      <div className="relative flex flex-col gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="inline-flex items-center gap-1 self-start rounded-full bg-card/70 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border/60 transition hover:text-primary"
        >
          <ChevronRight className="h-3 w-3 rotate-180" />
          {t("demoVolver")}
        </button>
        <div className="flex items-end gap-3 sm:gap-4">
          <span className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl shadow-xl shadow-black/20 sm:h-32 sm:w-32">
            <Cover p={p} clase="h-full w-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pb-0.5">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary ring-1 ring-primary/25">
              {t(CLAVES_TIPO[p.tipo])}
            </span>
            <h3 className="line-clamp-2 text-xl font-black leading-none sm:text-2xl">{p.titulo}</h3>
            <p className="w-full truncate text-xs font-medium text-muted-foreground sm:text-sm">
              {p.artista || "\u00a0"}
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {cargando
                ? t("demoDetalleCargando")
                : Plantilla(t(total === 1 ? "demoDetalleUna" : "demoDetalleVarias"), { n: total })}
            </p>
            <button
              type="button"
              onClick={onReproducirTodo}
              disabled={cargando || total === 0}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-95 active:scale-95 disabled:opacity-40"
            >
              {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {t("demoReproducirTodo")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
