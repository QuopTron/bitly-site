"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, Loader2, MessageSquare, Quote, Send, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, useLanguage } from "@/lib/i18n";
import { normalizarReparto } from "@/lib/opiniones-reglas";
import { retraso } from "@/lib/reveal";
import { contarVista } from "@/lib/vistas";
import { publicarOpinion } from "@/server/opiniones";
const CUANTAS = 12;
const ESTRELLAS = [1, 2, 3, 4, 5];

/** Cómo se llama cada nota, para que la calificación diga algo más que 5 iconos. */
const NOMBRE_NOTA: Record<number, string> = {
  1: "opinionesNota1",
  2: "opinionesNota2",
  3: "opinionesNota3",
  4: "opinionesNota4",
  5: "opinionesNota5",
};

type Opinion = { id: number; nombre: string; estrellas: number; texto: string; creado: string };
type Resumen = { opiniones: number; promedio: number; vistas: number; reparto: number[] };

/** Rellena plantillas `{n}` sin sacar el texto del diccionario. */
const con = (texto: string, vars: Record<string, string | number>) =>
  texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

/** "hace 3 días" / "13 sep 2026": cercano si es reciente, exacto si es viejo. */
function cuando(iso: string, es: boolean): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return es ? "recién" : "just now";
  if (min < 60) return es ? `hace ${min} min` : `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return es ? `hace ${h} h` : `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return es ? `hace ${d} día${d === 1 ? "" : "s"}` : `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(es ? "es" : "en", { day: "numeric", month: "short", year: "numeric" });
}

/** Estrellas de sólo lectura: se anuncian como una sola imagen con su nota. */
function Estrellas({ valor, etiqueta, tam = "h-3.5 w-3.5" }: { valor: number; etiqueta: string; tam?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={etiqueta}>
      {ESTRELLAS.map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`${tam} transition-colors duration-200 ${n <= Math.round(valor) ? "fill-primary text-primary" : "text-muted-foreground"}`}
        />
      ))}
    </span>
  );
}

/** Esqueleto de la lista: se ve más rápido que un spinner y no salta al llegar los datos. */
function Esqueleto() {
  return (
    <ul className="space-y-2.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="animate-pulse rounded-2xl bg-card/40 p-4 ring-1 ring-border/50" style={{ animationDelay: `${i * 120}ms` }}>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-muted/60" />
            <div className="h-3 w-24 rounded-full bg-muted/60" />
            <div className="ml-auto h-3 w-16 rounded-full bg-muted/50" />
          </div>
          <div className="mt-3 h-2.5 w-full rounded-full bg-muted/40" />
          <div className="mt-2 h-2.5 w-2/3 rounded-full bg-muted/40" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Cuenta hacia arriba hasta llegar a `valor`.
 *
 * Un solo `requestAnimationFrame` mientras dura el conteo y ninguno después:
 * en cuanto el número llega, se suelta. Con "menos movimiento" —o con la
 * pestaña en segundo plano— el número aparece de una: animar ahí no aporta nada
 * y gasta batería.
 */
function useContar(valor: number, ms = 800): number {
  const [mostrado, setMostrado] = useState(0);
  const desde = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      setMostrado(valor);
      return;
    }
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducido || document.hidden || desde.current === valor) {
      desde.current = valor;
      setMostrado(valor);
      return;
    }
    const arranque = desde.current;
    const inicio = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const avance = Math.min(1, (t - inicio) / ms);
      const suave = 1 - Math.pow(1 - avance, 3);
      setMostrado(Math.round(arranque + (valor - arranque) * suave));
      if (avance < 1) raf = requestAnimationFrame(paso);
      else desde.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, ms]);

  return mostrado;
}

/**
 * Cómo se reparten las notas: una barra por cantidad de estrellas.
 *
 * Las barras son decorativas (`aria-hidden`); lo que se anuncia es la etiqueta
 * de cada fila, que ya está en texto. El ancho va con `transform: scaleX`, que
 * resuelve el compositor sin repintar el resto de la lista.
 */
function Reparto({ reparto, total, etiqueta, tituloId }: { reparto: number[]; total: number; etiqueta: (n: number) => string; tituloId: string }) {
  return (
    <ul className="space-y-1.5" aria-labelledby={tituloId}>
      {[5, 4, 3, 2, 1].map((n) => {
        const cuenta = reparto[n - 1] ?? 0;
        const ancho = total > 0 ? cuenta / total : 0;
        return (
          <li key={n} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex w-7 shrink-0 items-center justify-end gap-0.5 tabular-nums">
              <span aria-hidden>{n}</span>
              <Star aria-hidden className="h-2.5 w-2.5 fill-primary text-primary" />
              <span className="sr-only">{etiqueta(n)}</span>
            </span>
            <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/40">
              <span
                className="block h-full origin-left rounded-full bg-primary/70 transition-transform duration-700 ease-out"
                style={{ transform: `scaleX(${ancho})` }}
              />
            </span>
            <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{cuenta}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Opiniones con estrellas + contador de vistas.
 *
 * Leer es público; escribir pasa por la función de servidor (`publicarOpinion`),
 * que valida, recorta y limita por IP. Si la migración todavía no se aplicó, la
 * sección lo dice en vez de quedar rota o en blanco.
 *
 * Accesibilidad: la calificación es un `radiogroup` de verdad —se recorre con
 * las flechas, con Inicio y Fin, y tiene un solo punto de tabulación—, el
 * resultado del envío se anuncia solo (`role="status"`), y cuando no se puede
 * enviar hay un texto que explica qué falta.
 */
export default function Opiniones() {
  const t = useI18n();
  const [lang] = useLanguage();
  const es = lang === "es";

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [opiniones, setOpiniones] = useState<Opinion[] | null>(null);
  const [noDisponible, setNoDisponible] = useState(false);

  const [estrellas, setEstrellas] = useState(0);
  const [previa, setPrevia] = useState(0);
  const [vistas, setVistas] = useState(0);
  const [nombre, setNombre] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const botonesEstrella = useRef<Array<HTMLButtonElement | null>>([]);
  const carrusel = useRef<HTMLDivElement | null>(null);
  /** Tarjeta que está centrada en el carrusel (sólo para los controles). */
  const [pagina, setPagina] = useState(0);

  const leer = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        supabase.rpc("resumen_sitio"),
        supabase
          .from("comentarios")
          .select("id, nombre, estrellas, texto, creado")
          .order("creado", { ascending: false })
          .limit(CUANTAS),
      ]);
      if (!r.error && r.data?.[0]) {
        const fila = r.data[0];
        setResumen({
          opiniones: Number(fila.opiniones) || 0,
          promedio: Number(fila.promedio) || 0,
          vistas: Number(fila.vistas) || 0,
          reparto: normalizarReparto(fila.reparto),
        });
      }
      if (l.error) {
        // Lo más probable: falta correr la migración.
        setNoDisponible(true);
        return;
      }
      setOpiniones((l.data ?? []) as Opinion[]);
    } catch {
      setNoDisponible(true);
    }
  }, []);

  // El conteo lo dispara el arranque del sitio (`src/routes/__root.tsx`); acá
  // sólo se recoge el total, que es el mismo que ya se contó en esta sesión.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const total = await contarVista();
      if (vivo && total !== null) setVistas(total);
      if (vivo) await leer();
    })();
    return () => {
      vivo = false;
    };
  }, [leer]);

  /** Flechas, Inicio y Fin: el patrón que espera un lector de pantalla. */
  const moverEstrella = (e: React.KeyboardEvent, n: number) => {
    let destino = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") destino = Math.min(5, n + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") destino = Math.max(1, n - 1);
    else if (e.key === "Home") destino = 1;
    else if (e.key === "End") destino = 5;
    else return;
    e.preventDefault();
    setEstrellas(destino);
    botonesEstrella.current[destino - 1]?.focus();
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setAviso(null);
    setEnviando(true);
    try {
      const r = await publicarOpinion({ data: { nombre, estrellas, texto } });
      if (r.ok) {
        setOpiniones((prev) => [r.opinion, ...(prev ?? [])].slice(0, CUANTAS));
        setResumen((prev) => {
          if (!prev) return prev;
          // La barra de esta nota sube sola, sin volver a pedir el resumen.
          const reparto = [...prev.reparto];
          reparto[r.opinion.estrellas - 1] = (reparto[r.opinion.estrellas - 1] ?? 0) + 1;
          return {
            ...prev,
            opiniones: prev.opiniones + 1,
            reparto,
            promedio: Number(((prev.promedio * prev.opiniones + r.opinion.estrellas) / (prev.opiniones + 1)).toFixed(1)),
          };
        });
        setNombre("");
        setTexto("");
        setEstrellas(0);
        setAviso({ tipo: "ok", texto: t("opinionesGracias") });
      } else {
        setAviso({
          tipo: "error",
          texto: r.motivo === "datos" ? t("opinionesErrorDatos") : r.motivo === "limite" ? t("opinionesErrorLimite") : t("opinionesErrorServidor"),
        });
      }
    } catch {
      setAviso({ tipo: "error", texto: t("opinionesErrorServidor") });
    } finally {
      setEnviando(false);
    }
  };

  const total = resumen?.opiniones ?? 0;
  const totalTarjetas = opiniones?.length ?? 0;

  /**
   * Lleva la tarjeta [i] al centro del carrusel.
   *
   * Se mueve con `scrollTo` (no reordenando el DOM): el deslizamiento lo hace
   * el navegador, y con "menos movimiento" el salto es de una sin animación.
   */
  const irATarjeta = useCallback((i: number) => {
    const caja = carrusel.current;
    if (!caja) return;
    const destino = Math.max(0, Math.min(caja.children.length - 1, i));
    const tarjeta = caja.children[destino] as HTMLElement | undefined;
    if (!tarjeta) return;
    const suave = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    caja.scrollTo({
      left: tarjeta.offsetLeft - (caja.clientWidth - tarjeta.offsetWidth) / 2,
      behavior: suave ? "smooth" : "auto",
    });
  }, []);

  // Mientras el dedo arrastra, la tarjeta centrada manda en los controles. Se
  // mide dentro de un `requestAnimationFrame`: por más rápido que se arrastre,
  // hay una lectura por cuadro y ninguna escritura.
  useEffect(() => {
    const caja = carrusel.current;
    if (!caja) return;
    let pendiente = 0;
    const medir = () => {
      pendiente = 0;
      const ultima = caja.children.length - 1;
      // En los extremos manda el extremo: con dos tarjetas a la vista, la que
      // queda más cerca del centro es la segunda, así que en el arranque el
      // contador decía "2 de 12" y la flecha izquierda apuntaba a una tarjeta
      // que ya se estaba viendo.
      if (caja.scrollLeft <= 1) {
        setPagina(0);
        return;
      }
      if (caja.scrollLeft >= caja.scrollWidth - caja.clientWidth - 1) {
        setPagina(ultima);
        return;
      }
      const centro = caja.scrollLeft + caja.clientWidth / 2;
      let mejor = 0;
      let distancia = Infinity;
      [...caja.children].forEach((hijo, i) => {
        const el = hijo as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - centro);
        if (d < distancia) {
          distancia = d;
          mejor = i;
        }
      });
      setPagina(mejor);
    };
    const alScrollear = () => {
      if (!pendiente) pendiente = requestAnimationFrame(medir);
    };
    medir();
    caja.addEventListener("scroll", alScrollear, { passive: true });
    return () => {
      if (pendiente) cancelAnimationFrame(pendiente);
      caja.removeEventListener("scroll", alScrollear);
    };
  }, [totalTarjetas]);

  const promedio = resumen?.promedio ?? 0;
  const reparto = resumen?.reparto ?? [];
  const falta = estrellas === 0 || texto.trim().length < 2 || nombre.trim().length < 2;
  const numero = new Intl.NumberFormat(es ? "es-ES" : "en-US");
  // Las cifras suben contando cuando llegan de la base: se ve vivo sin costo.
  const vistasVisibles = useContar(vistas || resumen?.vistas || 0);
  const totalVisible = useContar(total);

  return (
    <section
      id="opiniones"
      aria-labelledby="opiniones-titulo"
      className="relative container mx-auto scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16 md:py-20"
    >
      {/* Resplandor del encabezado: un gradiente suave, sin blur, así en gama
          baja no cuesta nada. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 top-6 -z-10 h-32 opacity-[0.18]"
        style={{ background: "radial-gradient(50% 60% at 50% 0%, var(--primary), transparent 70%)" }}
      />
      <div className="mb-8 text-center sm:mb-10" data-reveal suppressHydrationWarning>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur sm:px-4 sm:text-xs">
          <MessageSquare className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          {t("opinionesBadge")}
        </div>
        <h2 id="opiniones-titulo" className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("opinionesTitle")}
          </span>
        </h2>
        <span aria-hidden className="bit-regla mx-auto mt-3 block h-px w-24 opacity-60" />
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">{t("opinionesDesc")}</p>

        {/* Contador de vistas + promedio */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary sm:text-sm">
            <Eye className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">{numero.format(vistasVisibles)}</span>
            <span className="font-normal text-muted-foreground">{t("opinionesVistas")}</span>
          </span>
          {total > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground sm:text-sm">
              <Estrellas valor={promedio} etiqueta={con(t("opinionesEstrella"), { n: promedio.toFixed(1) })} />
              <span className="font-semibold text-foreground tabular-nums">{promedio.toFixed(1)}</span>
              <span>· {con(t("opinionesCuantas"), { n: totalVisible })}</span>
            </span>
          )}
        </div>
      </div>

      {/* `min-w-0` en las columnas: un ítem de grid no baja de su mínimo de
          contenido y la columna del formulario arrastraba ese mínimo a toda la
          fila. */}
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[22rem_1fr]">
        {/* ── Formulario ── */}
        <form
          onSubmit={enviar}
          data-reveal suppressHydrationWarning
          style={retraso(60)}
          className="h-fit min-w-0 rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-primary/[0.02] p-5 shadow-xl shadow-primary/5 transition-shadow duration-300 focus-within:shadow-primary/10 sm:p-6"
        >
          <h3 className="text-base font-bold sm:text-lg">{t("opinionesFormTitulo")}</h3>

          {/* `min-w-0` en el fieldset: el navegador le pone `min-inline-size:
              min-content`, así que su mínimo de contenido se filtra hasta la
              grilla y empujaba la página 100 px a lo ancho en un celular. */}
          <fieldset className="mt-4 min-w-0">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("opinionesEstrellas")}
            </legend>
            {/* La calificación es un radiogroup de verdad (se recorre con las
                flechas, tiene un solo punto de tabulación). Lo que cambia es la
                piel: la estrella elegida se marca con fondo y anillo, y al lado
                una palabra dice la nota, para que no sea sólo "5 iconos". */}
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-background/40 px-2 py-1.5">
              <div
                className="flex items-center gap-0.5"
                role="radiogroup"
                aria-label={t("opinionesEstrellas")}
                onMouseLeave={() => setPrevia(0)}
              >
                {ESTRELLAS.map((n) => {
                  const pintadas = n <= (previa || estrellas);
                  const elegida = estrellas === n;
                  return (
                    <button
                      key={n}
                      ref={(el) => {
                        botonesEstrella.current[n - 1] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={elegida}
                      aria-label={con(t("opinionesEstrella"), { n })}
                      tabIndex={elegida || (estrellas === 0 && n === 1) ? 0 : -1}
                      onClick={() => setEstrellas(n)}
                      onKeyDown={(e) => moverEstrella(e, n)}
                      onMouseEnter={() => setPrevia(n)}
                      onFocus={() => setPrevia(n)}
                      onBlur={() => setPrevia(0)}
                      className={`group/star flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-all duration-200 hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-90 ${
                        elegida ? "bg-primary/15 ring-1 ring-primary/30" : ""
                      }`}
                    >
                      <Star
                        aria-hidden
                        className={`h-7 w-7 transition-colors duration-200 ${
                          pintadas
                            ? "fill-primary text-primary"
                            : "text-muted-foreground group-hover/star:text-primary/70"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <span
                aria-hidden
                className={`min-w-0 flex-1 truncate text-right text-xs font-semibold transition-colors duration-200 ${
                  estrellas > 0 ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {estrellas > 0 ? t(NOMBRE_NOTA[estrellas]) : t("opinionesNotaHint")}
              </span>
            </div>
          </fieldset>

          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("opinionesNombre")}</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
              placeholder={t("opinionesNombrePlaceholder")}
              className="mt-1.5 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition-colors duration-200 placeholder:text-muted-foreground/50 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("opinionesTexto")}</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={400}
              rows={3}
              placeholder={t("opinionesTextoPlaceholder")}
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition-colors duration-200 placeholder:text-muted-foreground/50 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </label>

          <div aria-hidden className="mt-1 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>{texto.length}/400</span>
            <span>{nombre.length}/24</span>
          </div>

          <button
            type="submit"
            disabled={enviando || falta}
            aria-describedby={falta ? "opiniones-falta" : undefined}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 outline-none transition-all duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:opacity-40"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {enviando ? t("opinionesEnviando") : t("opinionesEnviar")}
          </button>

          {falta && (
            <p id="opiniones-falta" className="mt-2 text-center text-xs text-muted-foreground">
              {t("opinionesFalta")}
            </p>
          )}

          <div role="status" aria-live="polite">
            {aviso && (
              <p
                className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium animate-in fade-in slide-in-from-bottom-1 duration-300 ${
                  aviso.tipo === "ok" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                }`}
              >
                {aviso.tipo === "ok" && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                {aviso.texto}
              </p>
            )}
          </div>
        </form>

        {/* ── Lista ── */}
        <div
          data-reveal suppressHydrationWarning
          style={retraso(120)}
          aria-busy={!noDisponible && opiniones === null}
          className="min-w-0 rounded-3xl border border-border/50 bg-gradient-to-b from-card/50 to-card/20 p-4 backdrop-blur sm:p-5"
        >
          {!noDisponible && total > 0 && (
            <div className="mb-4 rounded-2xl border border-border/40 bg-background/30 p-3.5">
              <p id="opiniones-reparto" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("opinionesReparto")}
              </p>
              <Reparto reparto={reparto} total={total} tituloId="opiniones-reparto" etiqueta={(n) => con(t("opinionesEstrella"), { n })} />
            </div>
          )}

          {noDisponible && (
            <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
              <MessageSquare className="h-7 w-7 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{t("opinionesNoDisponible")}</p>
            </div>
          )}

          {!noDisponible && opiniones === null && <Esqueleto />}

          {!noDisponible && opiniones?.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                <Star className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <p className="text-sm text-muted-foreground">{t("opinionesSinOpiniones")}</p>
            </div>
          )}

          {/* ── Carrusel de opiniones ──
              Las tarjetas se deslizan de a una (scroll-snap) en vez de apilarse:
              con 12 comentarios largos la sección quedaba altísima. Se puede
              arrastrar con el dedo, con la rueda/trackpad, o con las flechas;
              el contador dice dónde se está. */}
          {!noDisponible && opiniones && opiniones.length > 0 && (
            <div className="relative">
              <div
                ref={carrusel}
                tabIndex={0}
                role="group"
                aria-label={t("opinionesLista")}
                className="nav-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {opiniones.map((o) => (
                  <article
                    key={o.id}
                    className="anim-entra group relative w-[86%] shrink-0 snap-center rounded-2xl bg-card/40 p-3.5 ring-1 ring-border/50 transition-all duration-300 hover:bg-card/60 hover:ring-primary/25 sm:w-[47%] sm:p-4"
                  >
                    {/* Abajo a la derecha: arriba chocaba con las estrellas de la nota. */}
                    <Quote aria-hidden className="absolute bottom-3 right-3 h-4 w-4 text-primary/15" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-bold uppercase text-primary ring-1 ring-primary/20"
                        >
                          {o.nombre.slice(0, 1)}
                        </span>
                        <span className="truncate text-sm font-semibold">{o.nombre}</span>
                      </span>
                      <Estrellas valor={o.estrellas} etiqueta={con(t("opinionesEstrella"), { n: o.estrellas })} />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground sm:text-sm">{o.texto}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">{cuando(o.creado, es)}</p>
                  </article>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => irATarjeta(pagina - 1)}
                  disabled={pagina <= 0}
                  aria-label={t("opinionesAnterior")}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/40 text-muted-foreground outline-none transition hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:scale-90 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <span className="min-w-14 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                  {con(t("opinionesPagina"), { n: Math.min(pagina + 1, totalTarjetas), total: totalTarjetas })}
                </span>
                <button
                  type="button"
                  onClick={() => irATarjeta(pagina + 1)}
                  disabled={pagina >= totalTarjetas - 1}
                  aria-label={t("opinionesSiguiente")}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/40 text-muted-foreground outline-none transition hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:scale-90 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
