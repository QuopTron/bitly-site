import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const CLAVE = "bitly_pistas_cabecera";

const PASOS = [
  { id: "faq", nombre: "faqIconoAyuda", detalle: "faqIconoAyudaDesc" },
  { id: "comentarios", nombre: "comentariosTitulo", detalle: "comentariosPistaDesc" },
  { id: "menu", nombre: "faqIconoMenu", detalle: "faqIconoMenuDesc" },
  { id: "moneda", nombre: "faqIconoMoneda", detalle: "faqIconoMonedaDesc" },
  { id: "tema", nombre: "faqIconoTema", detalle: "faqIconoTemaDesc" },
  { id: "idioma", nombre: "faqIconoIdioma", detalle: "faqIconoIdiomaDesc" },
] as const;

type Paso = (typeof PASOS)[number];
type Rect = { left: number; top: number; width: number; height: number };

const ANCHO = 236;

/**
 * Flechas de bienvenida sobre los iconos de la cabecera.
 *
 * Se muestran una sola vez (queda guardado en `localStorage`) y recorren los
 * controles que sólo tienen un símbolo, explicando qué hace cada uno. Los pasos
 * que no se ven en el ancho actual (por ejemplo, el menú en escritorio) se
 * saltan solos, así que no hay flechas apuntando al vacío.
 */
export default function PistasCabecera() {
  const t = useI18n();
  const [abierta, setAbierta] = useState(false);
  const [paso, setPaso] = useState(0);
  const [visibles, setVisibles] = useState<readonly Paso[]>(PASOS);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    let visto = true;
    try {
      visto = localStorage.getItem(CLAVE) === "1";
    } catch {
      /* sin almacenamiento: mejor no molestar */
    }
    if (visto) return;

    // Nunca sobre la demo: su fondo ocupa toda la pantalla y se come los toques
    // del buscador y de las filas. Quien entra a escuchar no puede recibir un
    // tour encima (en el celular parecía que «no dejaba reproducir»).
    const enDemo = () => window.location.hash.startsWith("#demo");
    if (enDemo()) return;

    const id = setTimeout(() => {
      // Otra vez la condición, por si se navegó a la demo en ese segundo y medio.
      if (!enDemo()) setAbierta(true);
    }, 1400);
    const alCambiarVista = () => {
      if (enDemo()) setAbierta(false);
    };
    window.addEventListener("hashchange", alCambiarVista);
    return () => {
      clearTimeout(id);
      window.removeEventListener("hashchange", alCambiarVista);
    };
  }, []);

  const cerrar = () => {
    setAbierta(false);
    try {
      localStorage.setItem(CLAVE, "1");
    } catch {
      /* nada */
    }
  };

  useEffect(() => {
    if (!abierta) return;
    const medir = () => {
      const encontrados: Paso[] = [];
      for (const p of PASOS) {
        const el = document.querySelector<HTMLElement>(`[data-pista="${p.id}"]`);
        if (el && el.getBoundingClientRect().width > 0) encontrados.push(p);
      }
      setVisibles(encontrados);
      const actual = encontrados[Math.min(paso, encontrados.length - 1)];
      if (!actual) {
        setRect(null);
        return;
      }
      const r = document.querySelector<HTMLElement>(`[data-pista="${actual.id}"]`)!.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    medir();
    const id = setTimeout(medir, 320);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [abierta, paso]);

  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierta]);

  if (!abierta || !rect || typeof document === "undefined") return null;

  const actual = visibles[Math.min(paso, visibles.length - 1)];
  if (!actual) return null;

  const total = visibles.length;
  const indice = Math.min(paso, total - 1);
  const centro = rect.left + rect.width / 2;
  const izquierda = Math.max(8, Math.min(centro - ANCHO / 2, window.innerWidth - ANCHO - 8));
  const flecha = Math.max(12, Math.min(centro - izquierda - 6, ANCHO - 24));
  const ultimo = indice >= total - 1;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/25" onClick={cerrar}>
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full border-2 border-primary"
        style={{
          left: rect.left - 4,
          top: rect.top - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 5px color-mix(in oklab, var(--primary) 18%, transparent)",
        }}
      />
      <div
        role="dialog"
        aria-label={t("faqIconoAyuda")}
        className="absolute rounded-2xl border border-border bg-card p-3 sombra-tag animate-in fade-in zoom-in-95 duration-150"
        style={{ left: izquierda, top: rect.top + rect.height + 12, width: ANCHO }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden
          className="absolute -top-[7px] h-3 w-3 rotate-45 border-l border-t border-border bg-card"
          style={{ left: flecha }}
        />
        <button
          type="button"
          onClick={cerrar}
          aria-label={t("pistasSaltar")}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
        <p className="texto-tag pr-6 text-sm text-foreground">{t(actual.nombre)}</p>
        <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted-foreground">{t(actual.detalle)}</p>
        <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2">
          <span className="texto-marker text-[10px] text-muted-foreground">
            {indice + 1}/{total}
          </span>
          <button
            type="button"
            onClick={() => (ultimo ? cerrar() : setPaso(indice + 1))}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[0.7rem] font-semibold text-primary-foreground transition-transform active:scale-95"
          >
            {ultimo ? t("pistasListo") : t("pistasSiguiente")}
            {!ultimo && <ChevronRight aria-hidden className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
