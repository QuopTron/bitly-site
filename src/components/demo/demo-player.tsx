"use client";

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Gem, KeyRound, ListMusic, Loader2, Lock, Maximize2, MessageCircle, Pause, Play, Repeat, Search, Shuffle, SkipBack, SkipForward, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { format, useCurrency } from "@/lib/currency";
import { formatoCuenta, progresoOferta } from "@/lib/pricing";
import { useFaseActual } from "@/lib/use-pricing";
import { anotarCanalCaido, audioDe, buscar, contenidoDe, SUGERIDAS, type Pista } from "@/lib/demo-catalog";
import { consultarDescargas, descargarPista } from "@/lib/descargas-cuenta";
import { leerTokenCuenta } from "@/lib/cuentas-cliente";
import type { EstadoDescargasCuenta } from "@/server/descargas-cuenta";
import { demoDespertar } from "@/server/demo-proxy";
import { categoriaDeFiltro, extensionDe, type ExtensionId } from "@/lib/demo-extensiones";
import { useCuota } from "@/lib/demo-cuota";
import { retraso } from "@/lib/reveal";
import { navegarA } from "@/lib/navegacion";
import { enlaceWhatsApp } from "@/lib/contacto";

import ExtensionPicker from "@/components/demo/extension-picker";
import CategoriaChips from "@/components/demo/categoria-chips";
import Karaoke from "@/components/demo/karaoke";
import { CabeceraDetalle, FilaCancion, TarjetaColeccion } from "@/components/demo/catalogo-demo";
import { ReproductorCompleto } from "@/components/demo/reproductor-completo";
import { PaseTope } from "@/components/demo/pase-tope";

// Sólo monta al ingresar el código: chunk aparte, igual que los otros modales.
const DemoCodigoModal = lazy(() => import("@/components/modals/demo-codigo-modal"));

/**
 * Un solo ping de arranque por carga de página.
 *
 * El backend de YouTube puede vivir en un plan free que apaga la instancia: si
 * se lo despierta al abrir la demo, el arranque ocurre mientras el visitante
 * escribe la búsqueda, no cuando ya tocó play. No se espera la respuesta.
 */
let despertado = false;

/**
 * Cuánto se muestra el spinner antes de decir que la búsqueda se está
 * demorando. Cubre el peor caso normal del servidor (~11 s de failover + 8 s
 * del catálogo + la búsqueda en el canal de YouTube) con margen.
 */
const TOPE_BUSQUEDA_MS = 25_000;

/** Rellena `{n}` / `{price}` sin sacar el texto del diccionario. */
function Plantilla(texto: string, vars: Record<string, string | number>) {
  return texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const mmss = (seg: number) => {
  const t = Math.max(0, Math.floor(seg));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
};

/**
 * Espera a que el <audio> tenga metadata utilizable. No se espera `canplay`
 * porque con `preload="none"` puede no llegar nunca antes de `play()`; con
 * `loadedmetadata` alcanza para fijar `currentTime` y arrancar sin la carrera
 * que dejaba la segunda reproducción muda.
 */
function esperarMetadata(el: HTMLAudioElement, ms: number): Promise<void> {
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((listo) => {
    let hecho = false;
    const terminar = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(reloj);
      el.removeEventListener("loadedmetadata", terminar);
      el.removeEventListener("canplay", terminar);
      el.removeEventListener("error", terminar);
      listo();
    };
    const reloj = setTimeout(terminar, ms);
    el.addEventListener("loadedmetadata", terminar);
    el.addEventListener("canplay", terminar);
    el.addEventListener("error", terminar);
  });
}

/** Longitud del anillo de progreso del cover circular del miniplayer. */
const ANILLO = 2 * Math.PI * 15.7;

/** Inicial de la letra que hace de carátula cuando la fuente no trae imagen. */
const letraDe = (texto: string) => (texto.trim()[0] ?? "\u266a").toUpperCase();

/** "1 h 20 min" / "7 min": cuánto falta para que la cuota se renueve. */
const restante = (ms: number) => {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/**
 * Silencio de 50 ms en WAV, armado acá mismo para no meter un base64 de un KB
 * en el archivo.
 *
 * En iPhone (Safari, y también en Chrome y Firefox de iOS, que usan WebKit) un
 * `play()` que llega DESPUÉS de un `await` ya no cuenta como parte del toque y
 * lo rechazan. Resolver el audio tarda —hay que pedírselo al relay—, así que
 * sin esto la canción quedaba sin arrancar hasta un segundo clic. El remedio es
 * desbloquear el elemento con un sonido in audible dentro del PRIMER toque de la
 * página: a partir de ahí WebKit sí deja reproducir por código.
 */
function urlSilencio(): string {
  const muestras = 400; // 50 ms a 8 kHz, 8 bits
  const bytes = new Uint8Array(44 + muestras).fill(128);
  const vista = new DataView(bytes.buffer);
  const texto = (pos: number, t: string) => {
    for (let i = 0; i < t.length; i++) vista.setUint8(pos + i, t.charCodeAt(i));
  };
  texto(0, "RIFF");
  vista.setUint32(4, 36 + muestras, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  vista.setUint32(16, 16, true);
  vista.setUint16(20, 1, true);
  vista.setUint16(22, 1, true);
  vista.setUint32(24, 8000, true);
  vista.setUint32(28, 8000, true);
  vista.setUint16(32, 1, true);
  vista.setUint16(34, 8, true);
  texto(36, "data");
  vista.setUint32(40, muestras, true);
  // Blob y no `data:`: la CSP del sitio sólo permite media de `self`, `blob:`
  // y https, así que un data URI se bloquea y el elemento queda en error.
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

type Detalle = {
  item: Pista;
  pistas: Pista[] | null;
  cargando: boolean;
  error: boolean;
};

/**
 * Marco con el buscador y el reproductor: las 8 extensiones de la app,
 * alternables por fuente y por categoría, con el mismo comportamiento que el
 * buscador nativo.
 *
 * La búsqueda sale cifrada contra el servidor de la demo (`demo-proxy`), que
 * ejecuta la extensión elegida —y cambia de fuente si esa falla— y responde con
 * metadata. El audio se resuelve al tocar la pista: FLAC completo vía el relay
 * de stash, y si ese canal no responde, audio completo vía el backend local de
 * yt-dlp; sin ningún canal, la pista queda sin audio (nunca un adelanto de
 * 30 s). No se expone el pipeline de descarga, así que la landing no queda
 * sirviendo música con derechos.
 */
type Props = {
  /**
   * Abre el modal de cuenta (lo maneja `index`). La cuenta GRATIS quita el
   * límite de reproducciones —en calidad estándar—, así que la demo la ofrece
   * justo donde aparece el tope y no escondida en el encabezado.
   */
  onCuenta?: () => void;
};

export default function DemoPlayer({ onCuenta }: Props) {
  const t = useI18n();
  // Instalada como PWA el audio no se puede guardar: la demo se oculta y se
  // invita a abrirla en el navegador, en vez de mostrar un reproductor a medias.
  const [moneda] = useCurrency();
  const cuota = useCuota();
  /** Premium o cuenta: no hay tope. La calidad la decide el servidor. */
  const ilimitado = cuota.premium || cuota.cuenta;

  const [extension, setExtension] = useState<ExtensionId>("deezer");
  const [filtro, setFiltro] = useState<string | null>("track");
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Pista[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sinResultados, setSinResultados] = useState(false);
  /**
   * La búsqueda pasó el tope sin contestar. No cancela nada: el pedido sigue en
   * vuelo y, si el servidor contesta más tarde, los resultados igual aparecen.
   * Existe porque una búsqueda colgada dejaba el marco en «Buscando…» para
   * siempre, sin forma de saber si había que reintentar.
   */
  const [busquedaLenta, setBusquedaLenta] = useState(false);
  const [respaldada, setRespaldada] = useState(false);
  const [limitado, setLimitado] = useState(false);

  const [otraFuente, setOtraFuente] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [listaActual, setListaActual] = useState<Pista[]>([]);

  const [pista, setPista] = useState<Pista | null>(null);
  const [sonando, setSonando] = useState(false);
  const [avance, setAvance] = useState(0);
  const [preparando, setPreparando] = useState<string | null>(null);
  const [avisoAudio, setAvisoAudio] = useState<string | null>(null);
  /** Aleatoria: el "siguiente" (y el salto automático) elige al azar. */
  const [aleatorio, setAleatorio] = useState(false);
  const [volumen, setVolumen] = useState(1);

  const [estadoDescargasCuenta, setEstadoDescargasCuenta] = useState<EstadoDescargasCuenta | null>(null);
  const [descargando, setDescargando] = useState<{ id: string; progreso: number } | null>(null);
  const [avisoDescarga, setAvisoDescarga] = useState<string | null>(null);
  /**
   * Cola: nace SOLO deslizando una canción a la derecha. No es "lo que sigue en
   * la lista" — eso lo resuelve `listaActual` — sino lo que el visitante puso
   * a mano ahí, y se vacía a medida que suena.
   */
  const [cola, setCola] = useState<Pista[]>([]);
  /** Repetir la pista actual cuando termina, sin gastar otra reproducción. */
  const [repetir, setRepetir] = useState(false);

  const [topeAbierto, setTopeAbierto] = useState(false);
  /** Reproductor a pantalla completa dentro del marco ("Ahora suena"). */
  const [reproductorAbierto, setReproductorAbierto] = useState(false);
  /** Cola como ventana emergente, encima del reproductor. */
  const [colaAbierta, setColaAbierta] = useState(false);
  const [codigoAbierto, setCodigoAbierto] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const pendiente = useRef(0);
  /** Pistas cuyo audio ya se pidió por detrás (ver `precalentar`). */
  const precalentado = useRef(new Set<string>());
  /** El <audio> ya se desbloqueó con un toque real (necesario en iPhone). */
  const desbloqueado = useRef(false);
  /** Orden de la búsqueda vigente: una respuesta vieja no pinta nada. */
  const busquedaEnCurso = useRef(0);
  /** El evento `ended` se registra una sola vez: lee el estado por refs. */
  const repetirRef = useRef(false);
  const colaRef = useRef<Pista[]>([]);
  const reproducirRef = useRef<(p: Pista) => void>(() => {});
  /** Canales que ya no abrieron para una pista: el rescate pide los demás. */
  const evitarRef = useRef(new Map<string, string[]>());
  /** La pista que está en el <audio>, para el manejador de `error`. */
  const pistaRef = useRef<Pista | null>(null);

  const info = extensionDe(extension);

  const refrescarDescargas = useCallback(() => {
    void consultarDescargas()
      .then(setEstadoDescargasCuenta)
      .catch(() => setEstadoDescargasCuenta({ ok: false, motivo: "servidor" }));
  }, []);

  useEffect(() => {
    refrescarDescargas();
    const revisar = () => refrescarDescargas();
    window.addEventListener("bitly-cuenta", revisar);
    window.addEventListener("bitly-premium", revisar);
    window.addEventListener("storage", revisar);
    return () => {
      window.removeEventListener("bitly-cuenta", revisar);
      window.removeEventListener("bitly-premium", revisar);
      window.removeEventListener("storage", revisar);
    };
  }, [refrescarDescargas]);

  // Despierta el backend de YouTube mientras el visitante busca. Si el host está
  // en un plan free que se apaga, el arranque se paga acá y no al tocar play.
  useEffect(() => {
    if (despertado) return;
    despertado = true;
    void demoDespertar().catch(() => {});
  }, []);

  // Un solo <audio> para toda la demo: cambiar de pista es cambiar `src`.
  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    // iOS deja de cargar y de sonar cuando el <audio> no está en el documento.
    // Se lo cuelga del body, invisible pero presente: `display:none` también lo
    // apaga en Safari, así que va de 1×1 con opacidad 0.
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    audio.current = el;

    const alTiempo = () => setAvance(el.currentTime);
    const alTerminar = () => {
      // Repetir: vuelve a empezar la misma, indistinguible de "sigue sonando".
      if (repetirRef.current) {
        try {
          el.currentTime = 0;
        } catch {
          // Sin seek posible: el `play()` de abajo la reinicia igual.
        }
        void el.play().catch(() => setSonando(false));
        return;
      }
      // Con cola, lo encolado manda: suena lo siguiente sin tocar el resto.
      const siguiente = colaRef.current[0];
      if (siguiente) {
        setCola((actual) => actual.slice(1));
        reproducirRef.current(siguiente);
        return;
      }
      setSonando(false);
      setAvance(0);
    };
    // Un enlace firmado puede vencer o el relay devolver 403: si se queda en la
    // pista, el siguiente clic reutilizaría la misma URL rota. Se invalida para
    // que `reproducir` vuelva a resolver (y así "insistir" sí rescata).
    const alError = () => {
      setSonando(false);
      // Se recuerda el canal que falló: el próximo clic pide otro en vez de
      // recibir la misma URL rota del caché del servidor.
      const actual = pistaRef.current;
      if (actual?.canal) {
        anotarCanalCaido(actual.canal);
        const previos = evitarRef.current.get(actual.id) ?? [];
        if (!previos.includes(actual.canal)) {
          evitarRef.current.set(actual.id, [...previos, actual.canal]);
        }
      }
      setPista((prev) => {
        if (prev) {
          prev.audioUrl = null;
          prev.canal = null;
        }
        return prev;
      });
    };
    el.addEventListener("timeupdate", alTiempo);
    el.addEventListener("ended", alTerminar);
    el.addEventListener("error", alError);
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", alTiempo);
      el.removeEventListener("ended", alTerminar);
      el.removeEventListener("error", alError);
      el.remove();
    };
  }, []);

  /**
   * Desbloqueo de audio para iPhone: en el primer toque de la página se
   * reproduce el silencio, y desde ahí WebKit permite arrancar la canción por
   * código aunque el audio se haya resuelto en medio de un `await`.
   *
   * Se escucha en captura porque el toque puede caer en cualquier botón y no
   * siempre burbujea hasta la ventana (hay capas que cortan el evento).
   */
  useEffect(() => {
    let silencio: string | null = null;
    const liberar = () => {
      if (silencio) URL.revokeObjectURL(silencio);
      silencio = null;
    };
    const desbloquear = () => {
      const el = audio.current;
      if (!el || desbloqueado.current) return;
      silencio ??= urlSilencio();
      try {
        el.src = silencio;
        const arranque = el.play();
        if (arranque) {
          void arranque
            .then(() => {
              desbloqueado.current = true;
              // Sólo se pausa si nadie cambió la fuente mientras tanto.
              if (el.src === silencio) el.pause();
            })
            .catch(() => undefined);
        }
      } catch {
        // Sin desbloqueo queda el reintento en silencio de `arrancar`.
      }
    };
    const eventos = ["pointerdown", "touchend", "keydown"] as const;
    for (const evento of eventos) window.addEventListener(evento, desbloquear, true);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, desbloquear, true);
      liberar();
    };
  }, []);

  /**
   * Deja resuelto el audio del primer resultado mientras el visitante mira la
   * lista. En los temas de nicho la extracción tarda ~25 s: pedirla recién al
   * tocar deja al visitante esperando delante de la barra; pedirla al llegar
   * los resultados hace que esa espera se pague mientras elige.
   *
   * Es UNA sola pista por búsqueda y no gasta cuota (gastar es de `reproducir`).
   * Si el visitante no llega a tocarla, el audio quedó resuelto para el mismo
   * tema si vuelve a buscar: la caché del servidor lo devuelve al instante.
   */
  const precalentar = useCallback((pistas: Pista[]) => {
    const primera = pistas.find((p) => p.tipo === "track" && !p.audioUrl);
    if (!primera || precalentado.current.has(primera.id)) return;
    precalentado.current.add(primera.id);
    void audioDe(primera).catch(() => {});
  }, []);

  const hacerBusqueda = useCallback(async (q: string, extId: ExtensionId, filtroId: string | null) => {
    const limpio = q.trim();
    if (!limpio) return;
    const orden = ++busquedaEnCurso.current;
    setCargando(true);
    setBusquedaLenta(false);
    setSinResultados(false);
    setRespaldada(false);
    setLimitado(false);
    setDetalle(null);
    // Tope para la ESPERA VISIBLE, no para el pedido: si el servidor está
    // colgado (se vio quedarse en «Buscando…» más de dos minutos), se dice en
    // vez de girar la ruedita; si contesta después, igual se pinta.
    const relojito = setTimeout(() => {
      if (orden !== busquedaEnCurso.current) return;
      setCargando(false);
      setBusquedaLenta(true);
    }, TOPE_BUSQUEDA_MS);
    try {
      const r = await buscar(limpio, extId, filtroId);
      if (orden !== busquedaEnCurso.current) return;
      setBusquedaLenta(false);
      setResultados(r.pistas);
      const canciones = r.pistas.filter((p) => p.tipo === "track");
      setListaActual(canciones);
      setSinResultados(r.pistas.length === 0);
      setRespaldada(r.pistas.length > 0 && r.origen === "respaldo");
      setOtraFuente(r.pistas.length > 0 ? r.otraFuente ?? null : null);
      setLimitado(Boolean(r.limitado));
      // Con la cuota agotada el toque abre el tope, no el audio: no hay razón
      // para gastar una extracción en un tema que no se va a poder escuchar.
      if (!cuota.sinCuota) precalentar(r.pistas);
      requestAnimationFrame(() => listaRef.current?.scrollTo({ top: 0 }));
    } catch {
      if (orden !== busquedaEnCurso.current) return;
      setResultados([]);
      setListaActual([]);
      setSinResultados(true);
    } finally {
      clearTimeout(relojito);
      if (orden === busquedaEnCurso.current) setCargando(false);
    }
  }, [precalentar, cuota.sinCuota]);

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
      setDetalle(null);
      setListaActual([]);
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
      for (let intento = 0; intento < 2; intento++) {
        try {
          await el.play();
          return true;
        } catch {
          // El audio ya resuelto pero todavía sin datos: se le da un instante
          // al navegador y se reintenta antes de declararlo roto.
          if (intento === 0) await esperarMetadata(el, 2_500);
          try {
            el.muted = true;
            await el.play();
            el.muted = volumen === 0;
            return true;
          } catch {
            if (intento === 1) return false;
          }
        }
      }
      return false;
    },
    [volumen],
  );

  /**
   * Carga el audio y lo arranca; si el canal no abre, pide OTRO y reintenta.
   *
   * El caso real: el catálogo sin pérdida responde 429 (o el relay 403) y el
   * <audio> queda mudo aunque el enlace "existiera". Antes eso terminaba en
   * «esa pista no tiene audio»; ahora se descarta ese canal y se le pide al
   * servidor el siguiente (stash, Bandcamp o YouTube). Si ninguno abre, se
   * avisa y se corta: no se insiste en bucle.
   */
  const abrirYArrancar = useCallback(
    async (
      el: HTMLAudioElement,
      p: Pista,
      resuelto: Awaited<ReturnType<typeof audioDe>>,
    ): Promise<boolean> => {
      let audio = resuelto;
      // Tres intentos como máximo: el canal inicial y dos respaldos. Sumar un
      // cuarto alarga la espera y casi no suma chances (los canales restantes
      // suelen compartir la misma caída de red o de identidad).
      for (let intento = 0; intento < 3 && audio; intento++) {
        el.pause();
        el.preload = "auto";
        el.src = audio.url;
        el.load();
        // Lo que suena se pinta ANTES de esperar al navegador: la barra y el
        // miniplayer aparecen junto con el audio, no un instante después.
        setPista(p);
        setAvance(0);
        if (await arrancar(el)) {
          p.audioUrl = audio.url;
          p.canal = audio.canal ?? null;
          return true;
        }
        const canal = audio.canal;
        if (canal) {
          anotarCanalCaido(canal);
          const previos = evitarRef.current.get(p.id) ?? [];
          if (!previos.includes(canal)) evitarRef.current.set(p.id, [...previos, canal]);
        }
        // Se descarta el enlace roto antes de pedir otro: si no, `audioDe`
        // devolvería el mismo desde la propia pista.
        p.audioUrl = null;
        p.canal = null;
        audio = await audioDe(p, evitarRef.current.get(p.id) ?? []);
      }
      p.audioUrl = null;
      p.canal = null;
      return false;
    },
    [arrancar],
  );

  const reproducir = useCallback(
    async (p: Pista, lista?: Pista[]) => {
      if (!ilimitado && cuota.sinCuota) {
        setTopeAbierto(true);
        return;
      }
      if (lista) {
        const canciones = lista.filter((x) => x.tipo === "track");
        if (canciones.length > 0) setListaActual(canciones);
      }
      const el = audio.current;
      if (!el) return;

      // Pulsar la pista que ya suena solo reanuda: no gasta reproducción.
      if (pista?.id === p.id && p.audioUrl) {
        const resuelto = { url: p.audioUrl, duracion: p.duracion, canal: p.canal ?? undefined };
        void (async () => {
          const ok = await abrirYArrancar(el, p, resuelto);
          setSonando(ok);
          if (!ok) setAvisoAudio(t("demoAudioNone"));
        })();
        return;
      }

      // Las extensiones devuelven metadata: el audio se resuelve al tocar.
      const orden = ++pendiente.current;
      setPreparando(p.id);
      setAvisoAudio(null);
      // Aviso de espera larga: el nicho puede tardar 30 s o más. Decirlo es
      // mejor que un spinner mudo, que parece un botón roto.
      const lento = setTimeout(() => {
        if (orden === pendiente.current) setAvisoAudio(t("demoAudioTarda"));
      }, 12_000);

      // Un `null` puede ser transitorio (el single-flight de la pista acaba de
      // fallar, un canal respondió 503, el isolate se despertó tarde). Antes
      // eso obligaba a pulsar la fila otra vez; ahora se reintenta una vez
      // sola, sin que el visitante tenga que contar clics.
      let audioResuelto = await audioDe(p);
      if (!audioResuelto) {
        await new Promise((listo) => setTimeout(listo, 600));
        if (orden !== pendiente.current) {
          clearTimeout(lento);
          return;
        }
        audioResuelto = await audioDe(p);
      }
      if (orden !== pendiente.current) {
        clearTimeout(lento);
        return;
      }

      if (!audioResuelto) {
        clearTimeout(lento);
        setPreparando(null);
        setAvisoAudio(t("demoAudioNone"));
        return;
      }

      if (!ilimitado) cuota.gastar();
      // `load()` deja el elemento limpio y sin carrera: fija el src, reinicia
      // la posición y recién después se espera la metadata. Sin esperar a la
      // metadata: iPhone no baja ni la cabecera hasta que se le pide
      // reproducir, y `play()` ya espera los datos por su cuenta.
      //
      // El cargando NO se apaga hasta que el audio suena de verdad: si el
      // primer canal no abre, `abrirYArrancar` pide otro y la fila lo sigue
      // mostrando en vez de parecer que el toque no hizo nada.
      void (async () => {
        const ok = await abrirYArrancar(el, p, audioResuelto);
        clearTimeout(lento);
        if (orden !== pendiente.current) return;
        setPreparando(null);
        setSonando(ok);
        setAvisoAudio(ok ? null : t("demoAudioNone"));
      })();
    },
    [abrirYArrancar, cuota, ilimitado, pista, t],
  );

  // El `ended` y los handlers viejos leen por ref: siempre el valor vigente.
  useEffect(() => {
    pistaRef.current = pista;
  }, [pista]);
  useEffect(() => {
    repetirRef.current = repetir;
  }, [repetir]);
  useEffect(() => {
    colaRef.current = cola;
  }, [cola]);
  useEffect(() => {
    reproducirRef.current = (p) => void reproducir(p);
  }, [reproducir]);

  /** El gesto de deslizar alterna: si ya estaba, se saca de la cola. */
  const alternarCola = useCallback((p: Pista) => {
    setCola((actual) =>
      actual.some((x) => x.id === p.id) ? actual.filter((x) => x.id !== p.id) : [...actual, p],
    );
  }, []);

  /** Posición de una pista dentro del listado (−1 si no está). */
  const indiceDe = useCallback(
    (p: Pista | null) => (p ? listaActual.findIndex((x) => x.id === p.id) : -1),
    [listaActual],
  );

  /** Siguiente (+1) o anterior (−1); con aleatoria, salta a una al azar. */
  const moverse = useCallback(
    (sentido: 1 | -1) => {
      // "Siguiente" primero gasta la cola; recién después sigue la lista.
      if (sentido === 1 && cola.length > 0) {
        const [siguiente, ...resto] = cola;
        setCola(resto);
        void reproducir(siguiente);
        return;
      }
      const lista = listaActual;
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
    [aleatorio, cola, indiceDe, listaActual, pista, reproducir],
  );

  /** Filtro de canciones de la fuente activa: adónde vuelve un item abierto. */
  const filtroCanciones = info.filtros.find((f) => categoriaDeFiltro(f.id) === "tracks")?.id ?? null;

  /**
   * Abre un resultado que NO es una canción (álbum, artista, lista).
   *
   * Antes toda fila llamaba a `reproducir`, así que tocar un álbum pedía el
   * audio de un álbum y terminaba en "esa pista no tiene audio"; después se
   * buscaba su nombre. Ahora la fuente entrega SUS contenidos: las canciones
   * del álbum o la lista y, de un artista, sus canciones top y sus álbumes
   * para seguir recorriendo —todo reproducible—. Si la fuente no sabe
   * recorrer la colección, cae a la búsqueda por nombre de antes.
   */
  const abrirItem = useCallback(
    async (p: Pista) => {
      if (!p.titulo.trim()) return;
      setAvisoAudio(null);
      setDetalle({ item: p, pistas: null, cargando: true, error: false });
      requestAnimationFrame(() => listaRef.current?.scrollTo({ top: 0 }));
      try {
        let pistas = await contenidoDe(p);
        if (!pistas || pistas.length === 0) {
          const respaldo = await buscar(p.titulo, p.ext, null, 24);
          pistas = respaldo.pistas;
        }
        const canciones = pistas.filter((x) => x.tipo === "track");
        if (canciones.length > 0) setListaActual(canciones);
        setDetalle({ item: p, pistas, cargando: false, error: pistas.length === 0 });
      } catch {
        setDetalle((previo) => (previo ? { ...previo, cargando: false, error: true } : null));
      }
    },
    [],
  );

  const volver = useCallback(() => {
    setDetalle(null);
    requestAnimationFrame(() => listaRef.current?.scrollTo({ top: 0 }));
  }, []);

  const descargar = useCallback(
    async (p: Pista) => {
      if (!leerTokenCuenta() && !cuota.premium) {
        setAvisoDescarga(t("demoDescargaSesion"));
        onCuenta?.();
        return;
      }
      if (descargando) return;
      setAvisoDescarga(null);
      setDescargando({ id: p.id, progreso: -1 });
      try {
        const r = await descargarPista(p, (progreso) =>
          setDescargando((previo) => (previo && previo.id === p.id ? { ...previo, progreso } : previo)),
        );
        if (r.ok) {
          setAvisoDescarga(Plantilla(t("demoDescargaOk"), { nombre: r.nombre }));
        } else if (r.motivo === "sesion") {
          setAvisoDescarga(t("demoDescargaSesion"));
          onCuenta?.();
        } else if (r.motivo === "limite") {
          // El tope lo manda el servidor en la cabecera del 429: así el texto no
          // queda desfasado si algún día el límite deja de ser 75.
          setAvisoDescarga(Plantilla(t("demoDescargaLimite"), { n: r.limite ?? 75 }));
        } else if (r.motivo === "sin_audio") {
          setAvisoDescarga(t("demoAudioNone"));
        } else {
          setAvisoDescarga(t("demoDescargaError"));
        }
      } catch {
        setAvisoDescarga(t("demoDescargaError"));
      } finally {
        setDescargando(null);
        refrescarDescargas();
      }
    },
    [cuota.premium, descargando, onCuenta, refrescarDescargas, t],
  );

  const alternar = useCallback(() => {
    const el = audio.current;
    if (!el || !pista) return;
    if (sonando) {
      el.pause();
      setSonando(false);
      return;
    }
    // Si el canal falló, `arrancar` reintentaría la MISMA URL rota: hay que
    // volver a rescatar (con los canales descartados ya anotados).
    if (!pista.audioUrl || el.error) {
      void reproducir(pista);
      return;
    }
    void arrancar(el).then(setSonando);
  }, [arrancar, pista, reproducir, sonando]);

  /** Salta a un segundo concreto; lo usan la barra de seek y el karaoke. */
  const buscarSegundo = useCallback(
    (seg: number) => {
      const el = audio.current;
      if (!el || !pista) return;
      const total = pista.duracion > 0 ? pista.duracion : el.duration || 0;
      const destino = Math.max(0, Math.min(total || seg, seg));
      try {
        el.currentTime = destino;
      } catch {
        return;
      }
      setAvance(destino);
    },
    [pista],
  );

  const pulsarBarra = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pista) return;
      const total = pista.duracion > 0 ? pista.duracion : audio.current?.duration || 0;
      if (!total) return;
      const rect = e.currentTarget.getBoundingClientRect();
      buscarSegundo(((e.clientX - rect.left) / Math.max(1, rect.width)) * total);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [buscarSegundo, pista],
  );

  const moverBarra = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      if (!pista) return;
      const total = pista.duracion > 0 ? pista.duracion : audio.current?.duration || 0;
      if (!total) return;
      const rect = e.currentTarget.getBoundingClientRect();
      buscarSegundo(((e.clientX - rect.left) / Math.max(1, rect.width)) * total);
    },
    [buscarSegundo, pista],
  );

  // El volumen vive en el estado y se aplica en UN solo lugar.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.volume = volumen;
    el.muted = volumen === 0;
  }, [volumen]);

  // Avance de la pista actual como fracción (0–1) para el anillo del cover.
  const avanceCirculo = pista && pista.duracion > 0 ? Math.min(1, avance / pista.duracion) : 0;

  const { fase, vivo } = useFaseActual();
  const restantes = Math.max(0, cuota.restantes);
  const cuotaTexto = cuota.premium
    ? t("demoPremiumOn")
    : cuota.cuenta
      ? t("demoCuentaOn")
      : cuota.libre
      ? t("demoFreeUnlimited")
      : cuota.sinCuota
        ? t("demoFreeNone")
        : restantes === 1
          ? Plantilla(t("demoFreeOne"), { n: 1 })
          : Plantilla(t("demoFreeLeft"), { n: restantes });

  const finTexto = fase.enOferta
    ? vivo
      ? Plantilla(t("demoOfferEnds"), { t: formatoCuenta(fase.msParaFin) })
      : t("plansOfferDeadline")
    : null;

  const avanceOferta = fase.enOferta && vivo ? progresoOferta(new Date()) * 100 : 0;

  const descargasCuenta = estadoDescargasCuenta?.ok ? estadoDescargasCuenta : null;
  const descargasTexto = !cuota.cuenta
    ? null
    : !descargasCuenta
      ? t("demoDescargasCargando")
      : descargasCuenta.premium
        ? t("demoDescargasIlimitadas")
        : Plantilla(t("demoDescargasRestantes"), {
            n: descargasCuenta.restantes ?? 0,
            limite: descargasCuenta.limite,
          });

  const cancionesResultados = (resultados ?? []).filter((p) => p.tipo === "track");
  const coleccionesResultados = (resultados ?? []).filter((p) => p.tipo !== "track");
  const detalleCanciones = (detalle?.pistas ?? []).filter((p) => p.tipo === "track");
  const detalleColecciones = (detalle?.pistas ?? []).filter((p) => p.tipo !== "track");

  const irADescargas = () => {
    setTopeAbierto(false);
    navegarA("instalar");
  };

  const irAPlanes = () => {
    setTopeAbierto(false);
    navegarA("planes");
  };

  // A pantalla completa, como el buscador de una app de música: entrando a
  // «Demo» lo único que se ve es la barra de búsqueda y los resultados. Sin
  // titular ni descripción: en el celular empujaban la lista a media pantalla.
  return (
    <section
      id="demo"
      className="mx-auto flex h-full w-full max-w-7xl flex-col sm:px-6 sm:pb-5 sm:pt-1"
    >
      <div className="grid min-h-0 flex-1 items-stretch lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-4">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div
            role="group"
            aria-label={t("demoAriaMarco")}
            data-bloqueo-descarga=""
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-card sm:rounded-[1.8rem] sm:border sm:shadow-2xl sm:shadow-primary/10"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-primary" />

            {/* Buscador: selector de fuente + campo, como la barra de la app */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void hacerBusqueda(termino, extension, filtro);
              }}
              className="shrink-0 px-3 pt-2 sm:px-4 sm:pt-0"
            >
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-2.5 py-2.5 focus-within:border-primary/50 sm:py-2">
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
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/60 sm:text-sm"
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
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-2.5 sm:px-4">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                    cuota.premium
                      ? "bg-gradient-to-r from-primary to-accent text-primary-foreground ring-transparent"
                      : cuota.sinCuota
                        ? "bg-destructive/10 text-destructive ring-destructive/25"
                        : "bg-primary/15 text-primary ring-primary/25"
                  }`}
                >
                  {(cuota.premium || cuota.cuenta) && <Gem className="h-3 w-3" />}
                  {cuotaTexto}
                </span>
                {descargasTexto && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-card/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border/60">
                    <Download className="h-3 w-3" />
                    {descargasTexto}
                  </span>
                )}
              </div>
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
            {cuota.sinCuota && (
              <p className="px-3 pt-1.5 text-xs font-medium text-primary sm:px-4">
                {Plantilla(t("demoFreeRefill"), { tiempo: restante(cuota.reiniciaEnMs) })}
              </p>
            )}

            {/* La cuenta gratis es la salida más barata al tope de 4: se ofrece
                acá, donde duele, y no como un enlace perdido del menú. */}
            {!ilimitado && onCuenta && (
              <button
                type="button"
                onClick={onCuenta}
                className="mx-3 mt-1.5 flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-2.5 py-1 text-left text-[11px] font-semibold text-primary ring-1 ring-primary/25 transition hover:bg-primary/20 sm:mx-4"
              >
                <UserPlus className="h-3 w-3 shrink-0" aria-hidden />
                {t("demoCuentaCta")}
              </button>
            )}

            {/* Aviso de audio FUERA del área que se desplaza: si el visitante
                tocó una fila del fondo de la lista, el mensaje aparecía arriba
                del scroll y nunca lo veía — parecía que el toque no hacía nada. */}
            {avisoAudio && (
              <p
                role="status"
                className="mx-2 mt-2 shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] font-medium text-destructive sm:mx-3"
              >
                {avisoAudio}
              </p>
            )}

            {/* Resultados */}
            <div
              ref={listaRef}
              className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2 sm:px-3"
            >
              {busquedaLenta && !cargando && (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {t("demoSearchSlow")}
                </div>
              )}

              {resultados === null && !cargando && !busquedaLenta && (
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

              {avisoDescarga && (
                <p className="mb-1.5 rounded-xl bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary ring-1 ring-primary/20">
                  {avisoDescarga}
                </p>
              )}

              {detalle && !cargando && (
                <div className="space-y-3 pb-1">
                  <CabeceraDetalle
                    p={detalle.item}
                    total={detalleCanciones.length}
                    cargando={detalle.cargando}
                    onVolver={volver}
                    onReproducirTodo={() => {
                      const primera = detalleCanciones[0];
                      if (primera) void reproducir(primera, detalleCanciones);
                    }}
                  />
                  {detalle.cargando && (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  {!detalle.cargando && detalle.error && (
                    <p className="rounded-xl bg-card/50 px-3 py-4 text-center text-xs text-muted-foreground ring-1 ring-border/50">
                      {t("demoSinContenido")}
                    </p>
                  )}
                  {!detalle.cargando && detalleCanciones.length > 0 && (
                    <div className="space-y-1">
                      {detalleCanciones.map((p, i) => (
                        <FilaCancion
                          key={p.id}
                          p={p}
                          indice={i}
                          activa={pista?.id === p.id}
                          sonando={sonando}
                          preparando={preparando === p.id}
                          descargando={descargando?.id === p.id}
                          progreso={descargando?.id === p.id ? descargando.progreso : null}
                          onReproducir={() => void reproducir(p, detalleCanciones)}
                          onDescargar={() => void descargar(p)}
                          onEncolar={() => alternarCola(p)}
                          onAbrirCola={() => {
                            // Sin pista actual el reproductor estaría vacío: se
                            // arranca esta y se abre la cola encima.
                            if (!pista) void reproducir(p);
                            setReproductorAbierto(true);
                            setColaAbierta(true);
                          }}
                          enCola={cola.some((x) => x.id === p.id)}
                        />
                      ))}
                    </div>
                  )}
                  {!detalle.cargando && detalleColecciones.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {t("demoMasDelArtista")}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {detalleColecciones.map((p, i) => (
                          <TarjetaColeccion key={p.id} p={p} indice={i} onAbrir={() => void abrirItem(p)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!detalle && resultados && resultados.length > 0 && (
                <div className="space-y-3 pb-1">
                  {coleccionesResultados.length > 0 && (
                    <section className="space-y-2">
                      <h4 className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {t("demoResultadosColecciones")}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {coleccionesResultados.map((p, i) => (
                          <TarjetaColeccion key={p.id} p={p} indice={i} onAbrir={() => void abrirItem(p)} />
                        ))}
                      </div>
                    </section>
                  )}
                  {cancionesResultados.length > 0 && (
                    <section className="space-y-1">
                      {coleccionesResultados.length > 0 && (
                        <h4 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          {t("demoCatTracks")}
                        </h4>
                      )}
                      {cancionesResultados.map((p, i) => (
                        <FilaCancion
                          key={p.id}
                          p={p}
                          indice={i}
                          activa={pista?.id === p.id}
                          sonando={sonando}
                          preparando={preparando === p.id}
                          descargando={descargando?.id === p.id}
                          progreso={descargando?.id === p.id ? descargando.progreso : null}
                          onReproducir={() => void reproducir(p, cancionesResultados)}
                          onDescargar={() => void descargar(p)}
                          onEncolar={() => alternarCola(p)}
                          onAbrirCola={() => {
                            // Sin pista actual el reproductor estaría vacío: se
                            // arranca esta y se abre la cola encima.
                            if (!pista) void reproducir(p);
                            setReproductorAbierto(true);
                            setColaAbierta(true);
                          }}
                          enCola={cola.some((x) => x.id === p.id)}
                        />
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* Cola: lo que el visitante deslizó a la derecha, en orden. */}
            {cola.length > 0 && (
              <div className="shrink-0 border-t border-border/60 px-3 py-2 sm:px-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <ListMusic className="h-3.5 w-3.5" aria-hidden />
                    {t("demoCola")} · {cola.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCola([])}
                    className="text-[11px] font-semibold text-muted-foreground transition hover:text-destructive"
                  >
                    {t("demoColaLimpiar")}
                  </button>
                </div>
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                  {cola.map((q, i) => (
                    <span
                      key={q.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card/70 px-2 py-1 text-[11px] font-medium ring-1 ring-border/60"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCola((actual) => actual.filter((x) => x.id !== q.id));
                          void reproducir(q);
                        }}
                        className="max-w-32 truncate text-left"
                        title={q.titulo}
                      >
                        {i + 1}. {q.titulo}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t("demoColaQuitar")}: ${q.titulo}`}
                        onClick={() => setCola((actual) => actual.filter((x) => x.id !== q.id))}
                        className="text-muted-foreground transition hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reproductor a pantalla completa: el mini alcanza para confirmar
                que suena; en la PWA hace falta el marco entero. */}
            {reproductorAbierto && pista && (
              <ReproductorCompleto
                pista={pista}
                sonando={sonando}
                preparando={preparando === pista.id}
                avance={avance}
                aleatorio={aleatorio}
                repetir={repetir}
                cola={cola}
                descargando={descargando}
                colaAbierta={colaAbierta}
                onCerrar={() => {
                  setColaAbierta(false);
                  setReproductorAbierto(false);
                }}
                onAlternar={alternar}
                onMover={moverse}
                onAleatorio={() => setAleatorio((a) => !a)}
                onRepetir={() => setRepetir((r) => !r)}
                onDescargar={(p) => void descargar(p)}
                onReproducirCola={(p) => {
                  setCola((actual) => actual.filter((x) => x.id !== p.id));
                  void reproducir(p);
                }}
                onQuitarCola={(p) => setCola((actual) => actual.filter((x) => x.id !== p.id))}
                onLimpiarCola={() => setCola([])}
                onAbrirCola={() => setColaAbierta(true)}
                onCerrarCola={() => setColaAbierta(false)}
              />
            )}

            {/* Miniplayer */}
            {pista && (
              <div className="relative shrink-0 overflow-hidden border-t border-white/10">
                {/* Vidrio esmerilado: la carátula se estira detrás y tiñe el panel. */}
                {pista.caratula && (
                  <img
                    src={pista.caratula}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-2xl"
                  />
                )}
                {descargando?.id === pista.id && (
                  <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10">
                    <span
                      className={`block h-full bg-primary transition-[width] duration-200 ${
                        descargando.progreso < 0 ? "w-1/3 animate-pulse" : ""
                      }`}
                      style={descargando.progreso >= 0 ? { width: `${Math.max(4, descargando.progreso)}%` } : undefined}
                    />
                  </span>
                )}
                <div className="relative bg-background/55 px-3 py-1.5 backdrop-blur-2xl sm:px-4">
                <div className="flex items-center gap-2">
                  {/* Cover circular de vidrio: la carátula DENTRO de un anillo
                      que marca los segundos; sin imagen, la inicial hace de cover. */}
                  <span className="relative h-9 w-9 shrink-0 drop-shadow-[0_0_10px_rgba(0,0,0,0.25)]">
                    <svg viewBox="0 0 36 36" aria-hidden className="absolute inset-0 h-9 w-9 -rotate-90">
                      <circle cx="18" cy="18" r="15.7" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/20" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15.7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        className="text-primary"
                        strokeDasharray={ANILLO}
                        strokeDashoffset={ANILLO * (1 - avanceCirculo)}
                      />
                    </svg>
                    {pista.caratula ? (
                      <img src={pista.caratula} alt="" className="absolute left-[3px] top-[3px] h-[30px] w-[30px] rounded-full border border-white/40 object-cover shadow-lg" />
                    ) : (
                      <span
                        aria-hidden
                        className="absolute left-[3px] top-[3px] flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/30 text-[11px] font-bold text-primary-foreground shadow-lg"
                        style={{ backgroundImage: "var(--gradiente-marca)" }}
                      >
                        {letraDe(pista.titulo)}
                      </span>
                    )}
                    {sonando && (
                      <span aria-hidden className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-bold leading-tight">{pista.titulo}</span>
                    <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                      {pista.artista || "\u00a0"}
                      {pista.canal === "stash-relay"
                       ? " · FLAC"
                       : pista.canal === "monochrome" || pista.canal === "bandcamp"
                         ? " · audio"
                         : pista.canal === "youtube"
                           ? ` · ${t("demoCalidadEstandar")}`
                           : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReproductorAbierto(true)}
                    aria-label={t("demoPlayerAbrir")}
                    title={t("demoPlayerAbrir")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted-foreground ring-1 ring-white/10 transition hover:text-primary"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                  <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums backdrop-blur-sm">
                    <span className="text-foreground">{mmss(avance)}</span>
                    <span className="text-muted-foreground"> / {mmss(pista.duracion)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void descargar(pista)}
                    disabled={descargando?.id === pista.id}
                    title={Plantilla(t("demoDescargarAria"), { nombre: pista.titulo })}
                    aria-label={Plantilla(t("demoDescargarAria"), { nombre: pista.titulo })}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-muted-foreground ring-1 ring-white/10 transition hover:text-primary disabled:text-primary"
                  >
                    {descargando?.id === pista.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {descargando?.id === pista.id && descargando.progreso >= 0 && (
                      <span className="tabular-nums">{descargando.progreso}%</span>
                    )}
                  </button>
                </div>

                {/* Aleatoria · anterior · play/pausa · siguiente · volumen */}
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAleatorio((a) => !a)}
                    aria-label={t("demoShuffle")}
                    aria-pressed={aleatorio}
                    title={t("demoShuffle")}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 transition ${
                      aleatorio
                        ? "bg-primary/20 text-primary ring-primary/40"
                        : "text-muted-foreground ring-white/10 hover:text-foreground"
                    }`}
                  >
                    <Shuffle className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepetir((r) => !r)}
                    aria-label={t("demoRepetir")}
                    aria-pressed={repetir}
                    title={t("demoRepetir")}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 transition ${
                      repetir
                        ? "bg-primary/20 text-primary ring-primary/40"
                        : "text-muted-foreground ring-white/10 hover:text-foreground"
                    }`}
                  >
                    <Repeat className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moverse(-1)}
                    aria-label={t("demoPrev")}
                    title={t("demoPrev")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground"
                  >
                    <SkipBack className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={alternar}
                    aria-label={t("demoPlayPause")}
                    aria-pressed={sonando}
                    aria-busy={(preparando === pista.id) || undefined}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition duration-200 hover:scale-105 active:scale-90"
                  >
                    {preparando === pista.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : sonando ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => moverse(1)}
                    aria-label={t("demoNext")}
                    title={t("demoNext")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground"
                  >
                    <SkipForward className="h-3 w-3" />
                  </button>
                  <div className="ml-0.5 flex min-w-0 flex-1 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setVolumen((v) => (v > 0 ? 0 : 1))}
                      aria-label={t("demoMute")}
                      title={t("demoMute")}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10 transition hover:text-foreground"
                    >
                      {volumen === 0 ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volumen}
                      onChange={(e) => setVolumen(Number(e.target.value))}
                      aria-label={t("demoVolume")}
                      title={t("demoVolume")}
                      className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-primary"
                    />
                    <span className="hidden w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground sm:block">
                      {Math.round(volumen * 100)}%
                    </span>
                  </div>
                </div>

                {/* Letra centrada, una línea a la vez, entre el volumen y el seek. */}
                <div className="mt-1">
                  <Karaoke pista={pista} avance={avance} onBuscar={buscarSegundo} />
                </div>

                {/* Seek interactivo: clic o arrastre para adelantar/retroceder. */}
                <div className="mt-1 flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[10px] font-semibold tabular-nums text-foreground">
                    {mmss(avance)}
                  </span>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={t("demoSeek")}
                    aria-valuemin={0}
                    aria-valuemax={Math.round(pista.duracion)}
                    aria-valuenow={Math.round(avance)}
                    onPointerDown={pulsarBarra}
                    onPointerMove={moverBarra}
                    onKeyDown={(e) => {
                      if (!pista) return;
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        buscarSegundo(avance + (e.key === "ArrowRight" ? 5 : -5));
                      }
                    }}
                    className="group relative h-1 min-w-0 flex-1 cursor-pointer touch-none rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      style={{ width: `${Math.min(100, (avance / (pista.duracion || 1)) * 100)}%` }}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100"
                      style={{ left: `calc(${Math.min(100, (avance / (pista.duracion || 1)) * 100)}% - 5px)` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {mmss(pista.duracion)}
                  </span>
                </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* �� Indicador de precio �� */}
        <aside data-reveal suppressHydrationWarning style={retraso(120)} className="tarjeta hidden min-w-0 flex-col p-5 lg:flex">
          <h3 className="texto-tag text-2xl leading-none">{fase.enOferta ? t("demoOfferTitle") : t("plansPremiumPrice")}</h3>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("plansPremium")}
            </span>
            <span className="flex items-baseline gap-2">
              {fase.enOferta && (
                <span className="text-sm text-muted-foreground line-through">{format(fase.original, moneda)}</span>
              )}
              <span className="text-2xl font-bold text-primary">{format(fase.precio, moneda)}</span>
            </span>
          </div>
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-1000"
                style={{ width: `${Math.min(100, Math.max(fase.enOferta ? 4 : 100, avanceOferta))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">
                {fase.enOferta
                  ? Plantilla(t("demoOfferAfter"), { price: format(fase.original, moneda) })
                  : Plantilla(t("demoLadderFinal"), { price: format(fase.precio, moneda) })}
              </span>
              {finTexto && <span className="text-muted-foreground">{finTexto}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={irAPlanes}
            className="boton-spray mt-4 w-full px-4 py-2.5 text-xs"
          >
            {t("demoPaywallPlans")}
          </button>
        </aside>
      </div>

      {/* ── Tope: sin reproducciones y sin Premium ── */}
      {topeAbierto && createPortal(
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

            <PaseTope />

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setCodigoAbierto(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.98]"
              >
                <KeyRound className="h-4 w-4" />
                {t("demoCanjear")}
              </button>
              <a
                href="#instalar"
                onClick={irADescargas}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-bold text-foreground ring-1 ring-border/60 transition hover:bg-card/80 active:scale-[0.98]"
              >
                <Play className="h-4 w-4" />
                {t("demoPaywallInstall")}
              </a>
              <button
                type="button"
                onClick={irAPlanes}
                className="boton-spray w-full px-4 py-3 text-sm"
              >
                {t("demoPaywallPlans")}
              </button>
              {/* Sin sesión el camino más corto es comprar por WhatsApp: no hay
                  que crear cuenta ni cargar nada para que lo atiendan. */}
              {!cuota.cuenta && (
                <a
                  href={enlaceWhatsApp(t("plansWaText"))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-bold text-muted-foreground ring-1 ring-border/60 transition hover:text-foreground"
                >
                  <MessageCircle className="h-4 w-4" />
                  {t("demoPaywallWa")}
                </a>
              )}
              {onCuenta && !cuota.premium && (
                <button
                  type="button"
                  onClick={() => {
                    setTopeAbierto(false);
                    onCuenta();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary/15 px-4 py-3 text-sm font-bold text-primary ring-1 ring-primary/30 transition hover:bg-primary/25 active:scale-[0.98]"
                >
                  <UserPlus className="h-4 w-4" />
                  {t("demoPaywallCuenta")}
                </button>
              )}
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
        </div>,
        document.body,
      )}

      {codigoAbierto && (
        <Suspense fallback={null}>
          <DemoCodigoModal
            open
            onClose={() => setCodigoAbierto(false)}
            onCuenta={onCuenta}
            onActivado={cuota.activarPremium}
          />
        </Suspense>
      )}
    </section>
  );
}
