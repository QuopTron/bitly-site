import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import GlowBackground from "@/components/layout/glow-background";
import Header from "@/components/layout/header";
import HeroSection from "@/components/hero/hero-section";
import PlansSection from "@/components/plans-section";
import InstallSection, { abrirGuia, plataformaDeDescarga } from "@/components/install/install-section";
import DemoPlayer from "@/components/demo/demo-player";
import ComentariosInicio from "@/components/inicio/comentarios-inicio";
import PistaDeslizar from "@/components/layout/pista-deslizar";

import { useAnalitica } from "@/lib/analytics";
import { useInstalacionPwa } from "@/lib/pwa";
import { initRates } from "@/lib/currency";
import { usePreferenciasGuardadas } from "@/lib/preferencias";
import { cargarReleases, type PlatformKey, type ReleaseIndex } from "@/lib/releases";
import { TITULO } from "@/lib/seo";
import { EVENTO_NAVEGAR, VISTAS, esVista, type VistaId } from "@/lib/navegacion";
import { useDeslizamientoVistas } from "@/lib/deslizamiento-vistas";
import { INFO_POR_DEFECTO, leerDatosSitio, registrarDescarga, type InfoApp, type StatsSitio } from "@/server/datos";

/**
 * Diálogos bajo demanda.
 *
 * Ninguno se ve al cargar la página y entre todos pesaban decenas de KB en el
 * bundle inicial (el del admin trae toda la gestión de pedidos). Con `lazy` y
 * renderizado condicional viajan en su propio chunk: el primer pintado no los
 * espera y el diálogo aparece en cuanto se pide.
 */
const ReleaseModal = lazy(() => import("@/components/modals/release-modal"));
const FaqModal = lazy(() => import("@/components/modals/faq-modal"));
const ComentariosModal = lazy(() => import("@/components/modals/comentarios-modal"));
const CuentaModal = lazy(() => import("@/components/modals/cuenta-modal"));

type Datos = { info: InfoApp; stats: StatsSitio; vistas: number; release: ReleaseIndex | null };

async function cargarDatos(): Promise<Datos> {
  let info: InfoApp = INFO_POR_DEFECTO;
  let stats: StatsSitio = { windows: 0, android: 0, ios: 0, macos: 0, tv: 0, pwa: 0 };
  let vistas = 0;
  try {
    const d = await leerDatosSitio();
    info = d.info;
    stats = d.stats;
    vistas = d.vistas;
  } catch (e) {
    console.error("[Bitly] SSR sin datos:", e);
  }
  let release: ReleaseIndex | null = null;
  try {
    release = (await cargarReleases()) as ReleaseIndex | null;
  } catch {
    /* sin releases el hero muestra la versión de `info` */
  }
  return { info, stats, vistas, release };
}

export const Route = createFileRoute("/")({
  loader: cargarDatos,
  head: () => ({
    meta: [{ title: TITULO }],
  }),
  component: Index,
});

export default function Index() {
  const datos = Route.useLoaderData();
  usePreferenciasGuardadas();
  const [info, setInfo] = useState<InfoApp>(datos.info);
  const [stats, setStats] = useState(datos.stats);
  const [vistas, setVistas] = useState(datos.vistas);
  const [showRelease, setShowRelease] = useState(false);
  const [showComentarios, setShowComentarios] = useState(false);
  const [valoracion, setValoracion] = useState({ promedio: 0, opiniones: 0 });
  const [showFaq, setShowFaq] = useState(false);
  const [showCuenta, setShowCuenta] = useState(false);
  const descargasConfirmadas = useRef(new Set<string>());
  const [vista, setVista] = useState<VistaId>("inicio");
  const [releasePlatform, setReleasePlatform] = useState<"windows" | "android" | "tv" | "ios" | "macos">("android");
  const [blocked, setBlocked] = useState(false);
  const [release, setRelease] = useState<ReleaseIndex | null>(datos.release);

  useAnalitica(vista);
  const { disponible: pwaDisponible, instalar: instalarPwa } = useInstalacionPwa();

  const abrirComentarios = useCallback(() => setShowComentarios(true), []);
  const actualizarResumen = useCallback((r: { promedio: number; opiniones: number; vistas: number }) => {
    setVistas(r.vistas);
    setValoracion({ promedio: r.promedio, opiniones: r.opiniones });
  }, []);

  useEffect(() => {
    const aplicarHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash === "contacto") abrirComentarios();
      else if (hash === "faq") setShowFaq(true);
      else if (esVista(hash)) setVista(hash);
    };
    aplicarHash();
    window.addEventListener("hashchange", aplicarHash);
    return () => window.removeEventListener("hashchange", aplicarHash);
  }, [abrirComentarios]);

  const cambiarVista = useCallback((id: VistaId) => {
    setVista(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }, []);

  // En celular, seguir deslizando al llegar al borde pasa a la pestaña vecina.
  // En escritorio la navegación está en la cabecera y el gesto no existe.
  useDeslizamientoVistas(vista, cambiarVista);

  useEffect(() => {
    const alNavegar = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "contacto") {
        abrirComentarios();
        return;
      }
      if (id === "faq") {
        setShowFaq(true);
        return;
      }
      if (esVista(id)) cambiarVista(id);
    };
    window.addEventListener(EVENTO_NAVEGAR, alNavegar);
    return () => window.removeEventListener(EVENTO_NAVEGAR, alNavegar);
  }, [cambiarVista, abrirComentarios]);

  useEffect(() => {
    const alClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const objetivo = e.target as HTMLElement | null;
      const enlace = objetivo?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!enlace || enlace.target === "_blank") return;
      const id = (enlace.getAttribute("href") ?? "").slice(1);
      if (id === "contacto") {
        e.preventDefault();
        abrirComentarios();
        return;
      }
      if (id === "faq") {
        e.preventDefault();
        setShowFaq(true);
        return;
      }
      if (esVista(id)) {
        e.preventDefault();
        cambiarVista(id);
      }
    };
    document.addEventListener("click", alClic);
    return () => document.removeEventListener("click", alClic);
  }, [cambiarVista, abrirComentarios]);

  useEffect(() => {
    const check = () => {
      const n = new Date();
      setBlocked(n < new Date("2026-05-27T00:00:00-04:00"));
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await leerDatosSitio();
        setInfo(d.info);
        setStats((prev) => ({ ...prev, ...d.stats }));
        setVistas(d.vistas);
      } catch (e) {
        console.error("[Bitly] Failed to load app info:", e);
      }
    })();
    initRates();
    let vivo = true;
    cargarReleases()
      .then((r) => { if (vivo) setRelease(r); })
      .catch((e) => { console.error("[Bitly] No se pudieron cargar las releases:", e); });
    return () => { vivo = false; };
  }, []);

  /** Abre la lista de archivos. No cuenta nada todavía: eso pasa al bajar uno. */
  const handleDownload = (platform: "windows" | "android" | "tv" | "ios" | "macos", _url: string | null) => {
    setReleasePlatform(platform);
    setShowRelease(true);
  };

  /** Cuenta sólo si el archivo existe de verdad; no alcanza con tocar el botón. */
  const confirmarDescarga = async (
    platform: "windows" | "android" | "tv" | "ios" | "macos" | "pwa",
    url?: string,
  ) => {
    if (descargasConfirmadas.current.has(platform)) return;
    descargasConfirmadas.current.add(platform);
    const statsPlatform = platform === "tv" ? "android" : platform;
    try {
      const total = await registrarDescarga({ data: { plataforma: statsPlatform, url } });
      if (total === null) {
        descargasConfirmadas.current.delete(platform);
        return;
      }
      setStats((s) => ({ ...s, [statsPlatform]: total }));
    } catch (e) {
      descargasConfirmadas.current.delete(platform);
      console.error("[Bitly] Failed to increment download:", e);
    }
  };

  /** Instala la PWA y, si el visitante acepta, la cuenta como descarga. */
  const instalarAplicacion = async () => {
    if (await instalarPwa()) await confirmarDescarga("pwa");
  };

  const total = (stats.windows ?? 0) + (stats.android ?? 0);
  const platforms = release?.platforms;
  const androidUrl = platforms?.android.url ?? info.android_url;
  const windowsUrl = platforms?.windows.url ?? info.windows_url;
  const iosUrl = platforms?.ios.url ?? null;
  const macosUrl = platforms?.macos.url ?? null;
  const modalKey: PlatformKey = releasePlatform === "tv" ? "android" : releasePlatform;
  const modalRelease = platforms?.[modalKey];
  const indiceActivo = VISTAS.findIndex((v) => v.id === vista);

  const contenido = (id: VistaId) => {
    if (id === "inicio") {
      return (
        <>
          <HeroSection
            tagline={info.tagline}
            description={info.description}
            version={release?.version || info.version}
            isBlocked={blocked}
            windowsUrl={windowsUrl}
            androidUrl={androidUrl}
            iosUrl={iosUrl}
            macosUrl={macosUrl}
            totalDownloads={total}
            totalViews={vistas}
            promedio={valoracion.promedio}
            opiniones={valoracion.opiniones}
            comentarios={<ComentariosInicio onResumen={actualizarResumen} />}
            onDownload={handleDownload}
          />
        </>
      );
    }
    if (id === "demo") return <DemoPlayer onCuenta={() => setShowCuenta(true)} />;
    if (id === "instalar") return <InstallSection onDownload={(p) => handleDownload(p, null)} />;
    return <PlansSection onCuenta={() => setShowCuenta(true)} />;
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <GlowBackground />
      <Header
        vista={vista}
        onNavegar={cambiarVista}
        onComentarios={abrirComentarios}
        onFaq={() => setShowFaq(true)}
        onCuenta={() => setShowCuenta(true)}
        pwaDisponible={pwaDisponible}
        onInstalarPwa={() => void instalarAplicacion()}
      />

      <main className="relative min-h-0 flex-1 overflow-clip">
        {VISTAS.map(({ id }, i) => {
          const activo = vista === id;
          const desplazamiento = i - indiceActivo;
          return (
            <div
              key={id}
              data-vista={id}
              aria-hidden={!activo}
              inert={!activo}
              className={`absolute inset-0 bg-background ${
                id === "demo" ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
              } ${activo ? "" : "pointer-events-none"} transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform`}
              style={{ transform: `translate3d(${desplazamiento * 100}%, 0, 0)` }}
            >
              <div className={id === "demo" || id === "inicio" ? "h-full" : "pantalla-contenido min-h-full"}>
                {contenido(id)}
              </div>
            </div>
          );
        })}
        <PistaDeslizar vista={vista} onCambiar={cambiarVista} />
      </main>

      <Suspense fallback={null}>
        {showFaq && <FaqModal open onClose={() => setShowFaq(false)} />}
        {showComentarios && <ComentariosModal open onClose={() => setShowComentarios(false)} />}
        {showCuenta && <CuentaModal open onClose={() => setShowCuenta(false)} />}
      </Suspense>

      <Suspense fallback={null}>
        {showRelease && (
          <ReleaseModal
            open
            onClose={() => setShowRelease(false)}
            platform={releasePlatform}
            assets={modalRelease?.assets ?? []}
            version={modalRelease?.version ?? ""}
            latestVersion={release?.version ?? ""}
            onDownload={(url) => void confirmarDescarga(releasePlatform, url)}
            onOpenGuide={() => {
              setShowRelease(false);
              abrirGuia(plataformaDeDescarga(releasePlatform));
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
