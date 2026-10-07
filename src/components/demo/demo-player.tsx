"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Gem, KeyRound, Loader2, Monitor, Music, Pause, Play, Search, Shuffle, SkipBack, SkipForward, Smartphone, Tv, Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { format, useCurrency } from "@/lib/currency";
import { getFaseActual } from "@/lib/pricing";
import { audioDe, buscar, SUGERIDAS, type Pista } from "@/lib/demo-catalog";
import { categoriaDeFiltro, extensionDe, type ExtensionId } from "@/lib/demo-extensiones";
import { useCuota } from "@/lib/demo-cuota";
import { retraso } from "@/lib/reveal";
import { enlaceWhatsApp } from "@/lib/contacto";
import ExtensionPicker from "@/components/demo/extension-picker";
import CategoriaChips from "@/components/demo/categoria-chips";
import DemoCodigoModal from "@/components/modals/demo-codigo-modal";

/** Rellena `{n}` / `{price}` sin sacar el texto del diccionario. */
function Plantilla(texto: string, vars: Record<string, string | number>) {
  return texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const mmss = (seg: number) => {
  const t = Math.max(0, Math.floor(seg));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
};

/** "1 h 20 min" / "7 min": cuánto falta para que la cuota se renueve. */
const restante = (ms: number) => {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/** Etiqueta corta de cada TIPO de resultado, para la insignia de la fila. */
const CLAVES_TIPO: Record<Pista["tipo"], string> = {
  track: "demoKindTrack",
  album: "demoKindAlbum",
  artist: "demoKindArtist",
  playlist: "demoKindPlaylist",
};

/** Los tres marcos. El reproductor es el mismo; cambia el chasis. */
type MarcoId = "movil" | "tv" | "pc";
type Chasis = { etiqueta: string; icono: typeof Tv; clase: string; barra: string };

const MARCOS: Record<MarcoId, Chasis> = {
  movil: {
    etiqueta: "demoFrameMovil",
    icono: Smartphone,
    clase: "w-full max-w-[20rem] rounded-[2.35rem] p-2 ring-2 ring-border/70",
    barra: "px-4 pt-6 pb-3",
  },
  tv: {
    etiqueta: "demoFrameTV",
    icono: Tv,
    clase: "w-full max-w-[34rem] rounded-2xl p-1.5",
    barra: "px-4 pt-1.5 pb-2",
  },
  pc: {
    etiqueta: "demoFramePC",
    icono: Monitor,
    clase: "w-full max-w-[42rem] rounded-xl p-1.5",
    barra: "px-3 pt-1 pb-1.5",
  },
};

/**
 * Marco con el buscador y el reproductor: las 8 extensiones de la app,
 * alternables por fuente y por categoría, con el mismo comportamiento que el
 * buscador nativo.
 *
 * La búsqueda sale cifrada contra el servidor de la demo (`demo-proxy`), que
 * ejecuta la extensión elegida —y cambia de fuente si esa falla— y responde con
 * metadata. El audio se resuelve al tocar la pista contra el canal de la app
 * (Qobuz + relay); si ese canal no responde, queda el adelanto público de 30 s.
 * No se expone el pipeline de descarga, así que la landing no queda sirviendo
 * música con derechos.
 */
export default function DemoPlayer() {
  const t = useI18n();
  const [moneda] = useCurrency();
  const cuota = useCuota();

  const [marco, setMarco] = useState<MarcoId>("movil");
  const [extension, setExtension] = useState<ExtensionId>("deezer");
  const [filtro, setFiltro] = useState<string | null>("track");
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Pista[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sinResultados, setSinResultados] = useState(false);
  const [respaldada, setRespaldada] = useState(false);
  const [limitado, setLimitado] = useState(false);

  const [otraFuente, setOtraFuente] = useState<string | null>(null);

  const [pista, setPista] = useState<Pista | null>(null);
  const [sonando, setSonando] = useState(false);
  const [avance, setAvance] = useState(0);
  const [preparando, setPreparando] = useState<string | null>(null);
  const [avisoAudio, setAvisoAudio] = useState<string | null>(null);
  /** Aleatoria: el "siguiente" (y el salto automático) elige al azar. */
  const [aleatorio, setAleatorio] = useState(false);
  const [volumen, setVolumen] = useState(1);

  const [topeAbierto, setTopeAbierto] = useState(false);
  const [codigoAbierto, setCodigoAbierto] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const pendiente = useRef(0);

  const info = extensionDe(extension);
  const chasis = MARCOS[marco];

  // Un solo <audio> para toda la demo: cambiar de pista es cambiar `src`.
  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    audio.current = el;

    const alTiempo = () => setAvance(el.currentTime);
    const alTerminar = () => {
      setSonando(false);
      setAvance(0);
    };
    el.addEventListener("timeupdate", alTiempo);
    el.addEventListener("ended", alTerminar);
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", alTiempo);
      el.removeEventListener("ended", alTerminar);
    };
  }, []);

  const hacerBusqueda = useCallback(async (q: string, extId: ExtensionId, filtroId: string | null) => {
    const limpio = q.trim();
    if (!limpio) return;
    setCargando(true);
    setSinResultados(false);
    setRespaldada(false);
    setLimitado(false);
    try {
      const r = await buscar(limpio, extId, filtroId);
      setResultados(r.pistas);
      setSinResultados(r.pistas.length === 0);
      setRespaldada(r.pistas.length > 0 && r.origen === "respaldo");
      setOtraFuente(r.pistas.length > 0 ? r.otraFuente ?? null : null);
      setLimitado(Boolean(r.limitado));
      requestAnimationFrame(() => listaRef.current?.scrollTo({ top: 0 }));
    } catch {
      setResultados([]);
      setSinResultados(true);
    } finally {
      setCargando(false);
    }
  }, []);

  // Cambiar de fuente reabre la búsqueda: cada extensión tiene su propio
  // vocabulario de filtros y sus propios resultados.
  const cambiarExtension = useCallback(
    (id: ExtensionId) => {
      const siguiente = extensionDe(id);
      const filtroSiguiente = siguiente.filtros[0]?.id ?? null;
      setExtension(id);
      setFiltro(filtroSiguiente);
      setPista(null);
      setSonando(false);
      setAvisoAudio(null);
      audio.current?.pause();
      setResultados(null);
      setSinResultados(false);
      setRespaldada(false);
      setOtraFuente(null);
      if (termino.trim()) void hacerBusqueda(termino, id, filtroSiguiente);
    },
    [termino, hacerBusqueda],
  );

  /**
   * Arranca el audio SIN depender del gesto del clic.
   *
   * El rescate tarda (hay que pedirle el canal a Qobuz y firmar el enlace), y
   * ese `await` se come la activación transitoria que el navegador concede al
   * hacer clic: un `play()` después del await puede rechazarse aunque el usuario
   * haya tocado la pista. El reintento arranca en silencio —eso SIEMPRE está
   * permitido— y sube el volumen en el acto, así la canción suena sola.
   */
  const arrancar = useCallback(
    async (el: HTMLAudioElement): Promise<boolean> => {
      el.volume = volumen;
      el.muted = false;
      try {
        await el.play();
        return true;
      } catch {
        try {
          el.muted = true;
          await el.play();
          el.muted = volumen === 0;
          return true;
        } catch {
          return false;
        }
      }
    },
    [volumen],
  );

  const reproducir = useCallback(
    async (p: Pista) => {
      if (!cuota.premium && cuota.sinCuota) {
        setTopeAbierto(true);
        return;
      }
      const el = audio.current;
      if (!el) return;

      // Pulsar la pista que ya suena solo reanuda: no gasta reproducción.
      if (pista?.id === p.id && p.preview) {
        void arrancar(el).then(setSonando);
        return;
      }

      // Las extensiones devuelven metadata: el audio se resuelve al tocar.
      const orden = ++pendiente.current;
      setPreparando(p.id);
      setAvisoAudio(null);
      const audioResuelto = await audioDe(p);
      if (orden !== pendiente.current) return;
      setPreparando(null);

      if (!audioResuelto) {
        setAvisoAudio(t("demoAudioNone"));
        return;
      }

      if (!cuota.premium) cuota.gastar();
      el.src = audioResuelto.url;
      el.currentTime = 0;
      // Lo que suena se pinta ANTES de esperar al navegador: la barra y el
      // miniplayer aparecen junto con el audio, no un instante después.
      setPista(p);
      setAvance(0);
      void arrancar(el).then(setSonando);
    },
    [arrancar, cuota, pista, t],
  );

  /** Posición de una pista dentro del listado (−1 si no está). */
  const indiceDe = useCallback(
    (p: Pista | null) => (p ? (resultados ?? []).findIndex((x) => x.id === p.id) : -1),
    [resultados],
  );

  /** Siguiente (+1) o anterior (−1); con aleatoria, salta a una al azar. */
  const moverse = useCallback(
    (sentido: 1 | -1) => {
      const lista = resultados ?? [];
      if (lista.length === 0) return;
      if (aleatorio && lista.length > 1) {
        const actual = indiceDe(pista);
        let i = actual;
        // Nunca la misma: repetir la que ya suena no es "aleatoria".
        while (i === actual) i = Math.floor(Math.random() * lista.length);
        void reproducir(lista[i]);
        return;
      }
      if (!pista) return;
      const n = lista.length;
      const i = indiceDe(pista);
      void reproducir(lista[(((i + sentido) % n) + n) % n]);
    },
    [aleatorio, indiceDe, pista, reproducir, resultados],
  );

  /** Filtro de canciones de la fuente activa: adónde vuelve un item abierto. */
  const filtroCanciones = info.filtros.find((f) => categoriaDeFiltro(f.id) === "tracks")?.id ?? null;

  /**
   * Abre un resultado que NO es una canción (álbum, artista, lista).
   *
   * Antes toda fila llamaba a `reproducir`, así que tocar un álbum pedía el
   * audio de un álbum y terminaba en "esa pista no tiene audio". Ahora las
   * cuatro categorías se pueden recorrer: tocar un álbum, artista o lista busca
   * su música por nombre, que es el paso siguiente natural.
   */
  const abrirItem = useCallback(
    (p: Pista) => {
      if (!p.titulo.trim()) return;
      setTermino(p.titulo);
      setFiltro(filtroCanciones);
      setPista(null);
      setSonando(false);
      setAvisoAudio(null);
      audio.current?.pause();
      void hacerBusqueda(p.titulo, extension, filtroCanciones);
    },
    [extension, filtroCanciones, hacerBusqueda],
  );

  const alternar = useCallback(() => {
    const el = audio.current;
    if (!el || !pista) return;
    if (sonando) {
      el.pause();
      setSonando(false);
    } else {
      void arrancar(el).then(setSonando);
    }
  }, [arrancar, sonando, pista]);

  // El volumen vive en el estado y se aplica en UN solo lugar.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.volume = volumen;
    el.muted = volumen === 0;
  }, [volumen]);

  const fase = getFaseActual();
  const restantes = Math.max(0, cuota.restantes);
  const cuotaTexto = cuota.premium
    ? t("demoPremiumOn")
    : cuota.sinCuota
      ? t("demoFreeNone")
      : restantes === 1
        ? Plantilla(t("demoFreeOne"), { n: 1 })
        : Plantilla(t("demoFreeLeft"), { n: restantes });

  const diasTexto = !fase.siguiente
    ? null
    : fase.diasParaSiguiente <= 1
      ? t("demoLadderOneDay")
      : Plantilla(t("demoLadderIn"), { n: fase.diasParaSiguiente });

  const siguienteTexto = fase.siguiente
    ? Plantilla(t("demoLadderNext"), { price: format(fase.siguiente.precio, moneda) })
    : Plantilla(t("demoLadderFinal"), { price: format(fase.precio, moneda) });

  // El número vive en `@/lib/contacto` (antes estaba copiado también acá).
  const whatsapp = enlaceWhatsApp(
    `Hola! Probé la demo de Bitly y quiero el Premium (${format(fase.precio, moneda)}). ¿Me contás cómo lo activo?`,
  );

  const irADescargas = () => {
    setTopeAbierto(false);
    document.getElementById("instalar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="demo" className="container mx-auto scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16 md:py-20">
      <div className="mb-8 text-center sm:mb-10" data-reveal>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary backdrop-blur sm:px-4 sm:text-xs">
          <Play className="anim-late h-3.5 w-3.5 sm:h-4 sm:w-4" />
          {t("demoBadge")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-mint)" }}>
            {t("demoTitle")}
          </span>
        </h2>
        <span aria-hidden className="bit-regla mx-auto mt-3 block h-px w-24 opacity-60" />
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">{t("demoDescription")}</p>
      </div>

      {/* `min-w-0` en las columnas: por defecto un ítem de grid no baja de su
          ancho mínimo de contenido, así que en un celular de 320 px la columna
          del marco empujaba la página 20 px a lo ancho. */}
      <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-[1fr_15rem]">
        <div className="min-w-0">
          {/* ── Conmutador de marco ── */}
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            <div
              role="group"
              aria-label={t("demoFrameLabel")}
              className="flex items-center gap-1 rounded-full border border-border bg-card/60 p-1"
            >
              {(Object.keys(MARCOS) as MarcoId[]).map((id) => {
                const Icono = MARCOS[id].icono;
                const activo = marco === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMarco(id)}
                    aria-pressed={activo}
                    title={t(MARCOS[id].etiqueta)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-300 ease-out active:scale-95 ${
                      activo
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/40"
                        : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                    }`}
                  >
                    <Icono className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t(MARCOS[id].etiqueta)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── El chasis ── */}
          {/* El halo late detrás del aparato (y no dentro: así el recorte del
              chasis lo sigue tapando). En celular queda quieto, que es donde
              una capa con blur moviéndose se paga cara. */}
          {/* `min(20rem,100%)`: el ancho de "teléfono" de 20rem no entra en el
              recuadro de un celular de 320 px (la página tiene 288 px útiles). */}
          <div className="relative mx-auto w-full max-w-[min(20rem,100%)] sm:max-w-none">
            {/* El halo sangra hacia arriba y abajo, pero a los costados sólo 1
                píxel: con `-inset-6` se salía del viewport en un celular de 360
                px y aparecía scroll horizontal. */}
            <div
              aria-hidden
              className="anim-halo pointer-events-none absolute inset-x-0 -inset-y-6 rounded-[3rem] opacity-20 blur-2xl"
              style={{ background: "var(--gradient-hero)" }}
            />
          <div
            role="group"
            aria-label={t("demoAriaMarco")}
            className={`relative mx-auto overflow-hidden border border-border bg-card shadow-2xl shadow-primary/[0.06] ring-1 ring-primary/10 ${chasis.clase}`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

            {/* Isla dinámica: solo en el marco de celular. */}
            {marco === "movil" && (
              <div className="pointer-events-none absolute left-1/2 top-1.5 z-20 h-3.5 w-16 -translate-x-1/2 rounded-full bg-black/75 ring-1 ring-white/5" />
            )}

            {/* Barra del sistema */}
            <div className={`flex items-center justify-between text-xs font-semibold text-muted-foreground ${chasis.barra}`}>
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <Music className="h-3 w-3 text-primary" />
                Bitly
              </span>
            </div>

            {/* Buscador: selector de fuente + campo, como la barra de la app */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void hacerBusqueda(termino, extension, filtro);
              }}
              className="px-3 sm:px-4"
            >
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-2.5 py-2 focus-within:border-primary/50">
                <ExtensionPicker valor={extension} onCambiado={cambiarExtension} />
                {cargando ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <input
                  value={termino}
                  onChange={(e) => setTermino(e.target.value)}
                  placeholder={t("demoSearchPlaceholder")}
                  aria-label={t("demoSearchPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                />
                <button
                  type="submit"
                  disabled={cargando}
                  className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all duration-200 hover:opacity-90 active:scale-95 disabled:opacity-40"
                >
                  {cargando ? t("demoSearching") : t("demoSearchBtn")}
                </button>
              </div>

              <CategoriaChips
                extension={info}
                filtro={filtro}
                onCambiado={(f) => {
                  setFiltro(f);
                  // Cambiar de burbuja REABRE la búsqueda con la categoría nueva:
                  // si no, el listado seguía mostrando canciones con la burbuja
                  // "Álbumes" encendida hasta apretar Buscar de nuevo.
                  if (termino.trim()) void hacerBusqueda(termino, extension, f);
                }}
              />
            </form>

            {/* Cuota + botón de canje */}
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5 sm:px-4">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                  cuota.premium
                    ? "bg-gradient-to-r from-[#15803D] to-[#0E7A46] text-white ring-transparent"
                    : cuota.sinCuota
                      ? "bg-destructive/10 text-destructive ring-destructive/25"
                      : "bg-primary/15 text-primary ring-primary/25"
                }`}
              >
                {cuota.premium && <Gem className="h-3 w-3" />}
                {cuotaTexto}
              </span>
              {!cuota.premium && (
                <button
                  type="button"
                  onClick={() => setCodigoAbierto(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-card/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border/60 transition hover:text-primary"
                >
                  <KeyRound className="h-3 w-3" />
                  {t("demoCanjear")}
                </button>
              )}
            </div>

            {/* Con la cuota agotada se dice CUÁNDO vuelve: son 2 horas, no el fin. */}
            {!cuota.premium && cuota.sinCuota && (
              <p className="px-3 pt-1.5 text-xs font-medium text-primary sm:px-4">
                {Plantilla(t("demoFreeRefill"), { tiempo: restante(cuota.reiniciaEnMs) })}
              </p>
            )}

            {/* Resultados */}
            <div
              ref={listaRef}
              className="mt-2 overflow-y-auto px-2 pb-2 sm:h-72 sm:px-3"
              style={{ height: marco === "movil" ? "14rem" : "22rem" }}
            >
              {resultados === null && !cargando && (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                  <Search className="h-8 w-8 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{t("demoIdle")}</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {SUGERIDAS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setTermino(s);
                          void hacerBusqueda(s, extension, filtro);
                        }}
                        className="rounded-full bg-card/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/50 transition hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {cargando && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {sinResultados && !cargando && (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {limitado ? t("demoRateLimit") : t("demoNoResults")}
                </div>
              )}

              {respaldada && resultados && resultados.length > 0 && (
                <p className="px-1 pb-1.5 text-xs text-muted-foreground">{t("demoFallback")}</p>
              )}

              {!respaldada && otraFuente && (
                <p className="px-1 pb-1.5 text-xs text-muted-foreground">
                  {Plantilla(t("demoFuenteCambio"), { fuente: otraFuente })}
                </p>
              )}

              {avisoAudio && (
                <p className="px-1 pb-1.5 text-xs text-destructive/80">{avisoAudio}</p>
              )}

              {resultados && resultados.length > 0 && (
                <ul className="space-y-1">
                  {resultados.map((p, i) => {
                    const esActual = pista?.id === p.id;
                    // Canciones, álbumes, artistas y listas conviven en el mismo
                    // listado: cada fila dice QUÉ es y con qué dato cuenta
                    // (artista, álbum o dueño de la lista), y las que no son
                    // canciones se ABREN en vez de intentar sonar.
                    const esCancion = p.tipo === "track";
                    const secundaria = [p.artista, esCancion ? p.album : ""]
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .join(" · ");
                    // Cada fila entra con un pelín más de retraso que la
                    // anterior: el listado "cae" en cascada en vez de aparecer
                    // de golpe.
                    return (
                      <li
                        key={p.id}
                        className="anim-entra"
                        style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                      >
                        <button
                          type="button"
                          onClick={() => (esCancion ? void reproducir(p) : abrirItem(p))}
                          title={esCancion ? undefined : Plantilla(t("demoAbrirItem"), { nombre: p.titulo })}
                          className={`flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-all duration-200 active:scale-[0.985] ${
                            esActual ? "bg-primary/15 ring-1 ring-primary/25" : "hover:bg-card/60"
                          }`}
                        >
                          {p.caratula ? (
                            <img src={p.caratula} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                              <Music className="h-4 w-4 text-muted-foreground" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-semibold">{p.titulo}</span>
                              {!esCancion && (
                                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-primary ring-1 ring-primary/25">
                                  {t(CLAVES_TIPO[p.tipo])}
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {secundaria || "\u00a0"}
                            </span>
                          </span>
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                              esActual && sonando ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"
                            }`}
                          >
                            {preparando === p.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : !esCancion ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : esActual && sonando ? (
                              <Pause className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Miniplayer */}
            {pista && (
              <div className="border-t border-border/60 bg-background/70 px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-200"
                    style={{ width: `${Math.min(100, (avance / (pista.duracion || 30)) * 100)}%` }}
                  />
                </div>
                <div className="mt-2.5 flex items-center gap-2.5">
                  {/* Ecualizador: tres barritas que suben y bajan. Son tres
                      `scaleY` en el compositor, no valen nada. */}
                  {sonando && (
                    <span aria-hidden className="flex h-3.5 shrink-0 items-end gap-[2px]">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="anim-eco h-full w-[2px] rounded-full bg-primary"
                          style={{ animationDelay: `${i * 0.18}s`, animationDuration: `${0.85 + i * 0.14}s` }}
                        />
                      ))}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">{pista.titulo}</span>
                      {pista.canal === "preview" && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400">
                          {t("demoPreviewTag")}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {pista.artista ? `${pista.artista} · ` : ""}
                      {mmss(avance)} / {mmss(pista.duracion || 30)}
                      {pista.isrc ? ` · ISRC ${pista.isrc}` : ""}
                    </span>
                  </span>
                </div>

                {/* Aleatoria · anterior · play/pausa · siguiente · silencio */}
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setAleatorio((a) => !a)}
                    aria-label={t("demoShuffle")}
                    aria-pressed={aleatorio}
                    title={t("demoShuffle")}
                    className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 transition ${
                      aleatorio
                        ? "bg-primary/20 text-primary ring-primary/40"
                        : "text-muted-foreground ring-border/60 hover:text-foreground"
                    }`}
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moverse(-1)}
                    aria-label={t("demoPrev")}
                    title={t("demoPrev")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border/60 transition hover:text-foreground"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={alternar}
                    aria-label={t("demoPlayPause")}
                    aria-pressed={sonando}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition duration-200 hover:scale-105 active:scale-90"
                  >
                    {sonando ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => moverse(1)}
                    aria-label={t("demoNext")}
                    title={t("demoNext")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border/60 transition hover:text-foreground"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setVolumen((v) => (v > 0 ? 0 : 1))}
                    aria-label={t("demoMute")}
                    title={t("demoMute")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground ring-1 ring-border/60 transition hover:text-foreground"
                  >
                    {volumen === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Volumen */}
                <div className="mt-2 flex items-center gap-2">
                  <Volume2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumen}
                    onChange={(e) => setVolumen(Number(e.target.value))}
                    aria-label={t("demoVolume")}
                    title={t("demoVolume")}
                    className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                  />
                  <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {Math.round(volumen * 100)}%
                  </span>
                </div>

                {/* Si quiere más, la app completa. */}
                <button
                  type="button"
                  onClick={irADescargas}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-bold text-primary ring-1 ring-primary/25 transition hover:bg-primary/15 active:scale-[0.98]"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("demoMiniCta")}
                </button>

                <p className="mt-1.5 text-center text-xs text-muted-foreground">
                  {pista.canal === "preview" ? t("demoPreviewTag") : t("demoPreviewNote")}
                </p>
              </div>
            )}

            {/* Indicador de inicio: cierra el marco de celular. */}
            {marco === "movil" && (
              <div className="mx-auto mb-1.5 mt-1 h-1 w-24 rounded-full bg-foreground/15" />
            )}
          </div>
          </div>
        </div>

        {/* ── Indicador de precio ── */}
        <aside data-reveal style={retraso(120)} className="min-w-0 rounded-2xl border border-border bg-gradient-to-b from-card/70 to-card/30 p-5 backdrop-blur">
          <h3 className="text-sm font-bold">{t("demoLadderTitle")}</h3>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("plansPremium")}
            </span>
            <span className="text-2xl font-bold text-primary">{format(fase.precio, moneda)}</span>
          </div>
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                style={{
                  width: fase.siguiente
                    ? `${Math.min(100, Math.max(6, 100 - (fase.diasParaSiguiente / 30) * 100))}%`
                    : "100%",
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">{siguienteTexto}</span>
              {diasTexto && <span className="text-muted-foreground">{diasTexto}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" })}
            className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
          >
            {t("demoPaywallPlans")}
          </button>
        </aside>
      </div>

      {/* ── Tope: sin reproducciones y sin Premium ── */}
      {topeAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-3 backdrop-blur-sm sm:p-4">
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-gradient-to-b from-card to-card/90 p-5 shadow-2xl ring-1 ring-border/50 sm:p-6">
            <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <button
              type="button"
              onClick={() => setTopeAbierto(false)}
              aria-label={t("demoPaywallLater")}
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-card/80 text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="mb-4 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
                <Gem className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-lg font-bold sm:text-xl">{t("demoPaywallTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("demoPaywallBody")}</p>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setCodigoAbierto(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.98]"
              >
                <KeyRound className="h-4 w-4" />
                {t("demoCanjear")}
              </button>
              <button
                type="button"
                onClick={irADescargas}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-bold text-foreground ring-1 ring-border/60 transition hover:bg-card/80 active:scale-[0.98]"
              >
                <Play className="h-4 w-4" />
                {t("demoPaywallInstall")}
              </button>
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#15803D] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#15803D]/25 transition hover:bg-[#0E7A46] hover:opacity-90 active:scale-[0.98]"
              >
                {t("plansWhatsAppLabel")}
              </a>
              {cuota.premium && (
                <button
                  type="button"
                  onClick={cuota.limpiarPremium}
                  className="w-full pt-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                  {t("demoSalirPremium")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <DemoCodigoModal
        open={codigoAbierto}
        onClose={() => setCodigoAbierto(false)}
        onActivado={cuota.activarPremium}
      />
    </section>
  );
}
