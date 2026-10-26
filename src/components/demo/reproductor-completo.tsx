import { useEffect, useState } from "react";
import {
  ChevronDown,
  Download,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Pista } from "@/lib/demo-catalog";

const mmss = (seg: number) => {
  const t = Math.max(0, Math.floor(seg));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
};

const letraDe = (texto: string) => (texto.trim()[0] ?? "\u266a").toUpperCase();

function Cover({ p, clase }: { p: Pista; clase: string }) {
  if (p.caratula) return <img src={p.caratula} alt="" className={`${clase} object-cover`} />;
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

/**
 * Reproductor a pantalla completa DENTRO del marco de la demo.
 *
 * El miniplayer alcanza para confirmar que suena, pero no para usar la app: en
 * la PWA instalada, con la barra del sistema y el área segura del teléfono, el
 * reproductor necesita el marco entero. Acá van la carátula grande, los
 * controles completos, la cola emergente y la aclaración de qué hace cada
 * versión (la PWA reproduce y descarga; la app hace todo lo demás).
 */
export function ReproductorCompleto({
  pista,
  sonando,
  preparando,
  avance,
  aleatorio,
  repetir,
  cola,
  descargando,
  colaAbierta,
  onCerrar,
  onAlternar,
  onMover,
  onAleatorio,
  onRepetir,
  onDescargar,
  onReproducirCola,
  onQuitarCola,
  onLimpiarCola,
  onAbrirCola,
  onCerrarCola,
}: {
  pista: Pista;
  sonando: boolean;
  preparando: boolean;
  avance: number;
  aleatorio: boolean;
  repetir: boolean;
  cola: Pista[];
  descargando: { id: string; progreso: number } | null;
  colaAbierta: boolean;
  onCerrar: () => void;
  onAlternar: () => void;
  onMover: (delta: 1 | -1) => void;
  onAleatorio: () => void;
  onRepetir: () => void;
  onDescargar: (p: Pista) => void;
  onReproducirCola: (p: Pista) => void;
  onQuitarCola: (p: Pista) => void;
  onLimpiarCola: () => void;
  onAbrirCola: () => void;
  onCerrarCola: () => void;
}) {
  const t = useI18n();
  // Anima la entrada una vez: la carátula y el panel se acomodan al abrirse.
  const [entrado, setEntrado] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntrado(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = pista.duracion > 0 ? pista.duracion : 0;
  const porcentaje = total > 0 ? Math.min(100, (avance / total) * 100) : 0;
  const enDescarga = descargando?.id === pista.id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("demoPlayerTitulo")}
      className={`absolute inset-0 z-40 flex flex-col overflow-hidden rounded-[1.8rem] bg-background/80 backdrop-blur-2xl transition-opacity duration-300 ${
        entrado ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Fondo: la portada estirada y desenfocada, el color predominante. */}
      {pista.caratula ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={pista.caratula}
            alt=""
            className="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
          />
        </span>
      ) : (
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: "var(--gradiente-marca)" }} />
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-background/60 to-background/90" />

      {/* Barra superior */}
      <div className="relative flex shrink-0 items-center gap-2 px-3 pt-3">
        <button
          type="button"
          onClick={onCerrar}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-foreground ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20"
          aria-label={t("demoPlayerCerrar")}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{t("demoPlayerTitulo")}</span>
        <button
          type="button"
          onClick={onAbrirCola}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-foreground ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20"
        >
          <ListMusic className="h-3.5 w-3.5" aria-hidden />
          {t("demoCola")}
          {cola.length > 0 && <span className="tabular-nums text-primary">{cola.length}</span>}
        </button>
      </div>

      {/* Carátula + datos */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-3">
        <span className="relative block w-full max-w-[15rem] overflow-hidden rounded-3xl shadow-2xl shadow-black/50 ring-1 ring-white/15 transition duration-500"
          style={{ transform: entrado ? "scale(1)" : "scale(0.94)", opacity: entrado ? 1 : 0.6 }}
        >
          <Cover p={pista} clase="aspect-square h-full w-full" />
        </span>

        <div className="w-full max-w-[22rem] text-center">
          <p className="line-clamp-2 text-lg font-black leading-tight">{pista.titulo}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
            {pista.artista || "\u00a0"}
            {pista.album ? ` · ${pista.album}` : ""}
          </p>
        </div>

        {/* Progreso */}
        <div className="w-full max-w-[22rem]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${porcentaje}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-semibold tabular-nums text-muted-foreground">
            <span>{mmss(avance)}</span>
            <span>{total > 0 ? mmss(total) : "--:--"}</span>
          </div>
        </div>

        {/* Controles */}
        <div className="flex w-full max-w-[22rem] items-center justify-between">
          <button
            type="button"
            onClick={onAleatorio}
            aria-pressed={aleatorio}
            aria-label={t("demoShuffle")}
            className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 transition ${
              aleatorio ? "bg-primary/20 text-primary ring-primary/40" : "text-muted-foreground ring-white/10 hover:text-foreground"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMover(-1)}
            aria-label={t("demoPrev")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-foreground ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onAlternar}
            aria-label={t("demoPlayPause")}
            aria-pressed={sonando}
            aria-busy={preparando || undefined}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition duration-200 hover:scale-105 active:scale-90"
          >
            {preparando ? <Loader2 className="h-6 w-6 animate-spin" /> : sonando ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => onMover(1)}
            aria-label={t("demoNext")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-foreground ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRepetir}
            aria-pressed={repetir}
            aria-label={t("demoRepetir")}
            className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 transition ${
              repetir ? "bg-primary/20 text-primary ring-primary/40" : "text-muted-foreground ring-white/10 hover:text-foreground"
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onDescargar(pista)}
          disabled={enDescarga}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-foreground ring-1 ring-white/15 transition hover:bg-white/20 disabled:text-primary"
        >
          {enDescarga ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {enDescarga && descargando.progreso >= 0 ? `${descargando.progreso}%` : t("demoDescargar")}
        </button>

        <p className="max-w-[22rem] text-center text-[10px] leading-relaxed text-muted-foreground">
          {t("demoPlayerNota")}
        </p>
      </div>

      {/* Cola emergente */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 max-h-[72%] overflow-hidden rounded-t-3xl border-t border-white/15 bg-background/85 backdrop-blur-2xl transition-transform duration-300 ${
          colaAbierta ? "translate-y-0" : "translate-y-full"
        }`}
        aria-hidden={!colaAbierta}
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <span aria-hidden className="mx-auto -mt-1 mb-1 block h-1 w-10 rounded-full bg-white/25" />
        </div>
        <div className="flex items-center gap-2 px-4">
          <ListMusic className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-bold">
            {t("demoCola")} {cola.length > 0 && <span className="text-muted-foreground">· {cola.length}</span>}
          </h3>
          {cola.length > 0 && (
            <button
              type="button"
              onClick={onLimpiarCola}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {t("demoColaLimpiar")}
            </button>
          )}
          <button
            type="button"
            onClick={onCerrarCola}
            aria-label={t("demoPlayerCerrar")}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-3 py-2">
          {cola.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("demoColaVacia")}</p>
          ) : (
            <ul className="space-y-1">
              {cola.map((q, i) => (
                <li
                  key={q.id}
                  className="anim-entra flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-1.5"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                    <Cover p={q} clase="h-full w-full" />
                  </span>
                  <button
                    type="button"
                    onClick={() => onReproducirCola(q)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs font-bold">{q.titulo}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{q.artista || "\u00a0"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuitarCola(q)}
                    aria-label={`${t("demoColaQuitar")}: ${q.titulo}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
