import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Loader2, MessageSquare, RefreshCw, Timer, Users } from "lucide-react";
import { useI18n, useLanguage } from "@/lib/i18n";
import { leerEstadisticas, type Estadisticas } from "@/server/analytics";
import ModalWrapper from "@/components/ui/modal-wrapper";

const NOMBRE_SECCION: Record<string, string> = {
  inicio: "navInicio",
  instalar: "navInstalar",
  planes: "navPlanes",
  demo: "navDemo",
};

function tiempo(segundos: number, es: boolean): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return es ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Barras({ datos, etiqueta }: { datos: Record<string, number>; etiqueta: (k: string) => string }) {
  const filas = Object.entries(datos).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...filas.map(([, n]) => n));
  return (
    <ul className="space-y-1.5">
      {filas.map(([clave, n]) => (
        <li key={clave} className="flex items-center gap-2 text-[11px]">
          <span className="w-20 shrink-0 truncate text-muted-foreground">{etiqueta(clave)}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/50">
            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="w-7 shrink-0 text-right tabular-nums text-foreground">{n}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminModal({ open, onClose, codigo }: { open: boolean; onClose: () => void; codigo: string }) {
  const t = useI18n();
  const [lang] = useLanguage();
  const es = lang === "es";
  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    if (!codigo) return;
    setCargando(true);
    setError(false);
    try {
      const r = await leerEstadisticas({ data: { codigo } });
      if (r) setDatos(r);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => {
    if (open) void cargar();
  }, [open, cargar]);

  const numero = new Intl.NumberFormat(es ? "es-ES" : "en-US");
  const tarjetas = datos
    ? [
        { Icono: Eye, valor: numero.format(datos.vistas), label: t("adminVistas") },
        { Icono: Download, valor: numero.format(datos.descargas), label: t("adminDescargas") },
        { Icono: MessageSquare, valor: numero.format(datos.comentarios), label: t("adminComentarios") },
        { Icono: Users, valor: numero.format(datos.sesionesTotales), label: t("adminSesiones") },
      ]
    : [];

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      title={t("adminTitulo")}
      subtitle={t("adminDesc")}
      icon={<Users className="h-6 w-6 text-primary" />}
      ancho="amplio"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {datos && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1">
                <Timer className="h-3 w-3 text-primary" aria-hidden />
                {t("adminTiempoPromedio")}: <strong className="text-foreground">{tiempo(datos.segundosPromedio, es)}</strong>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-1">
                <Users className="h-3 w-3 text-primary" aria-hidden />
                {t("adminActivas")}: <strong className="text-foreground">{datos.activas24h}</strong>
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          aria-label={t("adminActualizar")}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? "animate-spin" : ""}`} aria-hidden />
          {t("adminActualizar")}
        </button>
      </div>

      {cargando && !datos && (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("adminCargando")}
        </p>
      )}
      {error && !datos && <p className="py-10 text-center text-xs text-destructive">{t("adminError")}</p>}

      {datos && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tarjetas.map(({ Icono, valor, label }) => (
              <div key={label} className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                <Icono className="h-4 w-4 text-primary" aria-hidden />
                <p className="texto-tag mt-1 text-xl leading-none tabular-nums">{valor}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/40 p-3">
              <p className="texto-marker mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("adminDispositivos")}</p>
              <Barras datos={datos.dispositivos} etiqueta={(k) => k} />
            </div>
            <div className="rounded-xl border border-border/60 bg-background/40 p-3">
              <p className="texto-marker mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("adminSecciones")}</p>
              <Barras datos={datos.secciones} etiqueta={(k) => (NOMBRE_SECCION[k] ? t(NOMBRE_SECCION[k]) : k)} />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <p className="texto-marker mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("adminUltimas")}</p>
            {datos.ultimas.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t("adminSinDatos")}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {datos.ultimas.map((s) => {
                  const seccion = Object.entries(s.secciones).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "inicio";
                  return (
                    <li key={s.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                      <span className="truncate font-medium capitalize text-foreground">{s.dispositivo}</span>
                      <span className="truncate text-muted-foreground">{NOMBRE_SECCION[seccion] ? t(NOMBRE_SECCION[seccion]) : seccion}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{tiempo(s.segundos, es)}</span>
                      <span className="w-14 shrink-0 text-right text-[10px] text-muted-foreground/70">
                        {new Date(s.ultimo).toLocaleTimeString(es ? "es" : "en", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </ModalWrapper>
  );
}
