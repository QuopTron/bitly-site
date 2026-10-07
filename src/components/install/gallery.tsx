import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type Captura = {
  src: string;
  /** Texto alternativo (accesibilidad). */
  alt: string;
  /** Título corto de la captura. */
  titulo: string;
  /** Explicación de una línea. */
  pie?: string;
  /**
   * Ancho y alto reales de la imagen.
   *
   * Van como atributos del `<img>` para que el navegador reserve el espacio
   * antes de que la imagen llegue: sin esto, cada captura empujaba el contenido
   * hacia abajo al cargar (y un salto de ancla terminaba en el lugar equivocado).
   */
  w?: number;
  h?: number;
};

export type TipoMarco = "telefono" | "ventana" | "plano" | "tv";

/* ─────────────────────────── Marcos ─────────────────────────── */

/** Celular: bisel redondeado + cámara, para que la captura quede prolija. */
function MarcoTelefono({ src, alt, w, h }: { src: string; alt: string; w?: number; h?: number }) {
  return (
    <span className="relative block rounded-[2rem] border border-border/70 bg-[#0a0d12] p-[5px] shadow-xl shadow-black/50 ring-1 ring-white/[0.06]">
      <span className="relative block overflow-hidden rounded-[1.6rem] bg-black">
        <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block w-full" />
        <span className="pointer-events-none absolute left-1/2 top-[7px] h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/20" />
      </span>
    </span>
  );
}

/** Escritorio: barra de navegador con la dirección del sitio. */
function MarcoVentana({ src, alt, url, w, h }: { src: string; alt: string; url: string; w?: number; h?: number }) {
  return (
    <span className="block overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-xl shadow-black/40 ring-1 ring-white/[0.04]">
      <span className="flex items-center gap-2 border-b border-border/50 bg-card/90 px-3 py-2">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto max-w-[70%] truncate rounded-md bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
          {url}
        </span>
      </span>
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block w-full" />
    </span>
  );
}

/** Diálogos y pantallas sueltas: tarjeta limpia sin cromo. */
function MarcoPlano({ src, alt, w, h }: { src: string; alt: string; w?: number; h?: number }) {
  return (
    <span className="block overflow-hidden rounded-xl border border-border/70 bg-black/40 shadow-xl shadow-black/40 ring-1 ring-white/[0.04]">
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block w-full" />
    </span>
  );
}

/** Televisor: bisel + base, para que la captura se lea como pantalla de TV. */
function MarcoTv({ src, alt, w, h }: { src: string; alt: string; w?: number; h?: number }) {
  return (
    <span className="block rounded-2xl border border-border/70 bg-[#0a0d12] p-2 shadow-xl shadow-black/50 ring-1 ring-white/[0.06]">
      <span className="block overflow-hidden rounded-lg bg-black">
        <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block w-full" />
      </span>
      <span className="mx-auto mt-1.5 block h-1.5 w-20 rounded-full bg-white/10" />
    </span>
  );
}

/* ───────────────────────── Galería ───────────────────────── */

const ANCHOS: Record<TipoMarco, string> = {
  telefono: "w-[188px] sm:w-[200px]",
  ventana: "w-[290px] sm:w-[360px] lg:w-[400px]",
  plano: "w-[290px] sm:w-[340px] lg:w-[380px]",
  tv: "w-[290px] sm:w-[420px] lg:w-[540px]",
};

function Marco({ tipo, captura, url }: { tipo: TipoMarco; captura: Captura; url?: string }) {
  const medidas = { w: captura.w, h: captura.h };
  if (tipo === "telefono") return <MarcoTelefono src={captura.src} alt={captura.alt} {...medidas} />;
  if (tipo === "ventana")
    return <MarcoVentana src={captura.src} alt={captura.alt} url={url ?? "bitly-site.pages.dev"} {...medidas} />;
  if (tipo === "tv") return <MarcoTv src={captura.src} alt={captura.alt} {...medidas} />;
  return <MarcoPlano src={captura.src} alt={captura.alt} {...medidas} />;
}

/** Lente: vista ampliada con navegación por teclado. */
function Lente({
  capturas,
  tipo,
  indice,
  url,
  onClose,
  onMove,
}: {
  capturas: Captura[];
  tipo: TipoMarco;
  indice: number;
  url?: string;
  onClose: () => void;
  onMove: (delta: number) => void;
}) {
  const t = useI18n();
  const captura = capturas[indice];

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onMove(1);
      if (e.key === "ArrowLeft") onMove(-1);
    };
    window.addEventListener("keydown", alTeclear);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = anterior;
    };
  }, [onClose, onMove]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        aria-label={t("installClose")}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex w-full flex-1 items-center justify-center gap-2 sm:gap-4" onClick={(e) => e.stopPropagation()}>
        {capturas.length > 1 && (
          <button
            onClick={() => onMove(-1)}
            aria-label="Anterior"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white sm:h-11 sm:w-11"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div
          className={
            tipo === "telefono"
              ? "max-w-[min(260px,70vw)]"
              : tipo === "tv"
                ? "max-w-[min(900px,92vw)]"
                : "max-w-[min(880px,90vw)]"
          }
        >
          <Marco tipo={tipo} captura={captura} url={url} />
        </div>

        {capturas.length > 1 && (
          <button
            onClick={() => onMove(1)}
            aria-label="Siguiente"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white sm:h-11 sm:w-11"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="max-w-xl text-center" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-white">{captura.titulo}</p>
        {captura.pie && <p className="mt-1 text-xs text-white/70">{captura.pie}</p>}
        <p className="mt-1 text-xs text-white/40">
          {indice + 1} / {capturas.length}
        </p>
      </div>
    </div>
  );
}

/**
 * Cinta de capturas: carrusel con deslizamiento en el celular y filas
 * centradas con ajuste automático desde tablet en adelante.
 */
export default function Gallery({
  capturas,
  tipo,
  url,
}: {
  capturas: Captura[];
  tipo: TipoMarco;
  url?: string;
}) {
  const t = useI18n();
  const [ampliada, setAmpliada] = useState<number | null>(null);

  const mover = useCallback(
    (delta: number) => setAmpliada((i) => (i === null ? i : (i + delta + capturas.length) % capturas.length)),
    [capturas.length],
  );

  return (
    <>
      <div className="relative">
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] sm:gap-4 [&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-center md:overflow-visible md:snap-none"
        >
          {capturas.map((captura, i) => (
            <figure key={captura.src} className={`shrink-0 snap-center ${ANCHOS[tipo]}`}>
              <button
                type="button"
                onClick={() => setAmpliada(i)}
                className="group relative block w-full rounded-xl text-left transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                aria-label={`${captura.titulo} — ${t("installGalleryHint")}`}
              >
                <Marco tipo={tipo} captura={captura} url={url} />
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                    <ZoomIn className="h-3.5 w-3.5" />
                    {t("installZoom")}
                  </span>
                </span>
              </button>

              <figcaption className="mt-2.5 flex gap-2">
                <span className="mt-[1px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold leading-snug text-foreground">{captura.titulo}</span>
                  {captura.pie && (
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{captura.pie}</span>
                  )}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        {capturas.length > 1 && (
          <p className="mt-2 text-center text-xs text-muted-foreground md:hidden">{t("installSwipe")}</p>
        )}
      </div>

      {ampliada !== null && (
        <Lente
          capturas={capturas}
          tipo={tipo}
          indice={ampliada}
          url={url}
          onClose={() => setAmpliada(null)}
          onMove={mover}
        />
      )}
    </>
  );
}
