import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, MessageSquare, Quote, Star } from "lucide-react";
import { useI18n, useLanguage } from "@/lib/i18n";

const NOTAS = [1, 2, 3, 4, 5];
const VELOCIDAD = 0.5;

export type Opinion = { id: number; nombre: string; estrellas: number; texto: string; creado: string };

export const con = (texto: string, vars: Record<string, string | number>) =>
  texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export function cuando(iso: string, es: boolean): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return es ? "recién" : "just now";
  if (min < 60) return es ? `hace ${min} min` : `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return es ? `hace ${h} h` : `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return es ? `hace ${d} día${d === 1 ? "" : "s"}` : `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(es ? "es" : "en", { day: "numeric", month: "short", year: "numeric" });
}

export function Estrellas({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={etiqueta}>
      {NOTAS.map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`h-3.5 w-3.5 ${n <= Math.round(valor) ? "fill-primary text-primary" : "text-muted-foreground/50"}`}
        />
      ))}
    </span>
  );
}

type Props = {
  opiniones: Opinion[] | null;
  /** 2 tarjetas por vista en el modal, 3 en la portada. */
  columnas?: 2 | 3;
};

/** Carrusel infinito y continuo, sin flechas ni puntos: fluye solo y se puede arrastrar. */
export default function CarruselOpiniones({ opiniones, columnas = 2 }: Props) {
  const t = useI18n();
  const [lang] = useLanguage();
  const es = lang === "es";
  const pista = useRef<HTMLDivElement | null>(null);
  const posicion = useRef(0);
  const periodo = useRef(0);
  const velocidad = useRef(0);
  const pausado = useRef(false);
  const arrastre = useRef<{ id: number; x: number; desde: number } | null>(null);
  const aplicar = useRef<() => void>(() => {});

  useEffect(() => {
    const el = pista.current;
    if (!opiniones || opiniones.length < 2 || !el) {
      posicion.current = 0;
      if (el) el.style.transform = "";
      return;
    }

    const total = opiniones.length;
    const medir = () => {
      const primera = el.children[0] as HTMLElement | undefined;
      const copia = el.children[total] as HTMLElement | undefined;
      if (!primera || !copia) return;
      const largo = copia.offsetLeft - primera.offsetLeft;
      if (largo > 0) periodo.current = largo;
    };
    const normalizar = () => {
      const largo = periodo.current;
      if (largo > 0) posicion.current = ((posicion.current % largo) + largo) % largo;
    };
    const pintar = () => {
      normalizar();
      el.style.transform = `translate3d(${-posicion.current}px, 0, 0)`;
    };
    aplicar.current = pintar;
    medir();
    pintar();

    const observador = new ResizeObserver(medir);
    const primera = el.children[0];
    const copia = el.children[total];
    if (primera) observador.observe(primera);
    if (copia) observador.observe(copia);

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido) {
      return () => {
        observador.disconnect();
        aplicar.current = () => {};
      };
    }

    let raf = 0;
    let ultimo = performance.now();
    const paso = (ahora: number) => {
      const dt = Math.min(64, ahora - ultimo);
      ultimo = ahora;
      const objetivo = pausado.current || arrastre.current ? 0 : VELOCIDAD;
      const suavizado = 1 - Math.exp(-dt / 180);
      velocidad.current += (objetivo - velocidad.current) * suavizado;
      if (velocidad.current < 0.002) velocidad.current = 0;
      if (velocidad.current > 0) {
        posicion.current += (velocidad.current * dt) / 16.67;
        pintar();
      }
      raf = requestAnimationFrame(paso);
    };

    raf = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(raf);
      observador.disconnect();
      aplicar.current = () => {};
    };
  }, [opiniones]);

  const bajar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!opiniones || opiniones.length < 2 || (e.pointerType === "mouse" && e.button !== 0)) return;
    arrastre.current = { id: e.pointerId, x: e.clientX, desde: posicion.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const mover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const actual = arrastre.current;
    if (!actual || actual.id !== e.pointerId) return;
    posicion.current = actual.desde - (e.clientX - actual.x);
    aplicar.current();
  };

  const soltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (arrastre.current?.id !== e.pointerId) return;
    arrastre.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (opiniones === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("opinionesLista")}
      </div>
    );
  }

  if (opiniones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-xs text-muted-foreground">{t("opinionesSinOpiniones")}</p>
      </div>
    );
  }

  const unica = opiniones.length === 1;
  const lista = unica ? opiniones : [...opiniones, ...opiniones];
  const ancho = unica
    ? "w-full sm:w-[70%] lg:w-[52%]"
    : columnas === 3
      ? "w-[84%] sm:w-[45%] lg:w-[31%]"
      : "w-[88%] sm:w-[47%]";

  return (
    <div
      className="relative select-none"
      onMouseEnter={() => {
        pausado.current = true;
      }}
      onMouseLeave={() => {
        pausado.current = false;
      }}
      onFocusCapture={() => {
        pausado.current = true;
      }}
      onBlurCapture={() => {
        pausado.current = false;
      }}
    >
      <div
        role="group"
        aria-label={t("opinionesLista")}
        className={`overflow-hidden ${unica ? "" : "cursor-grab touch-pan-y active:cursor-grabbing"}`}
        onPointerDown={bajar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
      >
        <div
          ref={pista}
          className={`relative flex w-full gap-3 pb-1 will-change-transform ${unica ? "justify-center" : ""}`}
        >
          {lista.map((o, i) => (
            <article
              key={`${o.id}-${i}`}
              aria-hidden={!unica && i >= opiniones.length ? true : undefined}
              className={`relative shrink-0 rounded-2xl border border-border/70 bg-background/40 p-2 ${ancho}`}
            >
              <Quote aria-hidden className="absolute bottom-3 right-3 h-4 w-4 text-primary/15" />
              <div className="flex items-center gap-2">
                <span aria-hidden className="mancha flex h-7 w-7 shrink-0 items-center justify-center bg-primary/15 text-[10px] font-bold uppercase text-primary">
                  {o.nombre.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{o.nombre}</span>
                <Estrellas valor={o.estrellas} etiqueta={con(t("opinionesEstrella"), { n: o.estrellas })} />
              </div>
              <p className="mt-2 line-clamp-2 text-[0.72rem] leading-relaxed text-muted-foreground">{o.texto}</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground">{cuando(o.creado, es)}</p>
            </article>
          ))}
        </div>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent sm:w-12"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:w-12"
      />
    </div>
  );
}
