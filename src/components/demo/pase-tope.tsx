import { useEffect, useState } from "react";
import { Clock3, HelpCircle, MessageCircle, TrendingUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { enlaceWhatsApp } from "@/lib/contacto";
import {
  cuentaRegresiva,
  estadoPase,
  marcarInicioPase,
  PASE_BASE_BS,
  PASE_GRACIA_HORAS,
  PASE_HORA_TOPE,
  PASE_TOPE_BS,
} from "@/lib/demo-pase";

/**
 * El pase con precio que sube por hora.
 *
 * El 26 a las 16:00 arranca en Bs 10 y sube Bs 1 por hora; a medianoche se
 * detiene y vuelve a mostrar Bs 10 hasta las 07:00 del 27, cuando retoma donde
 * se quedó y sigue hasta los Bs 30, donde se congela. El contador dice cuánto
 * falta para el próximo aumento y el "?" explica el mecanismo: un precio que
 * sube sin decir por qué se siente arbitrario; explicado, se entiende como una
 * invitación a decidir antes.
 */
export function PaseTope() {
  const t = useI18n();
  const [ahora, setAhora] = useState(() => Date.now());
  const [explicacion, setExplicacion] = useState(false);

  useEffect(() => {
    marcarInicioPase();
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pase = estadoPase(ahora);
  const siguiente = pase.bs + 1;

  return (
    <div className="relative mb-3 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/60 to-card/40 p-3 backdrop-blur">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/20 blur-2xl"
      />

      <div className="relative flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t("demoPaseTitulo")}
        </p>
        <button
          type="button"
          onClick={() => setExplicacion((v) => !v)}
          aria-expanded={explicacion}
          aria-label={t("demoPaseAyuda")}
          title={t("demoPaseAyuda")}
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-primary"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="relative mt-1 flex items-end gap-2">
        <p className="text-2xl font-black leading-none tabular-nums">
          Bs {pase.bs}
          <span className="ml-1 text-[10px] font-semibold text-muted-foreground">/1 h</span>
        </p>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
            pase.congelado
              ? "bg-primary/15 text-primary ring-primary/30"
              : "bg-amber-500/10 text-amber-500 ring-amber-500/30"
          }`}
        >
          <Clock3 className="h-3 w-3" aria-hidden />
          {pase.congelado
            ? t("demoPaseFinal")
            : `${t("demoPaseSubeA")} Bs ${siguiente} · ${cuentaRegresiva(pase.siguienteEnMs)}`}
        </span>
      </div>

      {explicacion && (
        <p className="anim-entra relative mt-2 rounded-xl bg-background/50 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
          {t("demoPaseExplica")
            .replace("{base}", String(PASE_BASE_BS))
            .replace("{h4}", String(PASE_BASE_BS + 1))
            .replace("{h5}", String(PASE_BASE_BS + 2))
            .replace("{gracia}", String(PASE_GRACIA_HORAS))
            .replace("{tope}", String(PASE_TOPE_BS))
            .replace("{horaTope}", String(PASE_HORA_TOPE))}
        </p>
      )}

      <div className="relative mt-2 flex items-center gap-1.5">
        {pase.horas > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t("demoPaseHoras").replace("{n}", String(pase.horas))}
          </span>
        )}
        <a
          href={enlaceWhatsApp(
            t("demoPaseWa").replace("{bs}", String(pase.bs)).replace("{horas}", String(pase.horas)),
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground transition hover:opacity-90"
        >
          <MessageCircle className="h-3 w-3" aria-hidden />
          {t("demoPasePagar").replace("{bs}", String(pase.bs))}
        </a>
      </div>
    </div>
  );
}
