import { useState, useEffect, lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import Particles from "@/components/particles";
import GlowBackground from "@/components/layout/glow-background";
import ScrollProgress from "@/components/layout/scroll-progress";
import Header from "@/components/layout/header";
import SectionNav from "@/components/layout/section-nav";
import HeroSection from "@/components/hero/hero-section";
import Footer from "@/components/layout/footer";
import PlansSection from "@/components/plans-section";
import InstallSection, { abrirGuia, plataformaDeDescarga } from "@/components/install/install-section";
import Opiniones from "@/components/opiniones";
import DemoPlayer from "@/components/demo/demo-player";
import FaqSection from "@/components/faq-section";
import { initRates } from "@/lib/currency";
import { usePreferenciasGuardadas } from "@/lib/preferencias";
import { cargarReleases, type PlatformKey, type ReleaseIndex } from "@/lib/releases";
import { TITULO } from "@/lib/seo";

// Los modales sólo montan al hacer clic: van en chunks aparte para que sus
// kilobytes no entren en la carga inicial. El condicional del JSX es parte
// del truco — si estuvieran montados con open=false, React los resolvería al
// hidratar y el chunk bajaría igual apenas.
const MobileModal = lazy(() => import("@/components/modals/mobile-modal"));
const ReleaseModal = lazy(() => import("@/components/modals/release-modal"));

type InfoApp = {
  name: string; tagline: string; description: string;
  windows_url: string | null; android_url: string | null; version: string;
};

type Datos = { info: InfoApp; stats: { windows: number; android: number }; release: ReleaseIndex | null };

const INFO_POR_DEFECTO: InfoApp = {
  name: "Bitly", tagline: "Tu música, sin límites", description: "",
  windows_url: null, android_url: null, version: "1.0.0",
};

/**
 * Datos del hero, leídos en el SERVIDOR (y por lo tanto también en el
 * prerender).
 *
 * Antes el componente arrancaba en `loading` y sólo pintaba después de dos
 * llamadas a Supabase: el HTML que veía Google era un spinner, sin título, sin
 * texto y sin enlaces. Con el loader, el HTML sale completo desde el primer
 * byte y las cifras de descargas no se muestran en 0 y luego saltan (eso era
 * parte del CLS).
 *
 * Cada consulta tiene su propio `try`: si una cae, las demás siguen, y una build
 * sin red publica igual con los valores por defecto. (Ojo: el builder de
 * PostgREST es sólo "thenable", no tiene `.catch`, por eso no se encadenan.)
 */
async function leerInfo(): Promise<InfoApp | null> {
  try {
    const { data } = await supabase.from("app_info").select("*").limit(1).maybeSingle();
    return (data as InfoApp | null) ?? null;
  } catch {
    return null;
  }
}

async function leerStats(): Promise<{ windows: number; android: number }> {
  const s = { windows: 0, android: 0 };
  try {
    const { data } = await supabase.from("download_stats").select("platform,count");
    for (const fila of data ?? []) {
      const n = Number(fila.count);
      if (fila.platform === "windows") s.windows = n;
      if (fila.platform === "android") s.android = n;
    }
  } catch {
    /* sin red quedan en 0 y el cliente los rellena al montar */
  }
  return s;
}

async function cargarDatos(): Promise<Datos> {
  try {
    const [info, stats, release] = await Promise.all([
      leerInfo(),
      leerStats(),
      cargarReleases().catch(() => null),
    ]);
    return { info: info ?? INFO_POR_DEFECTO, stats, release: release as ReleaseIndex | null };
  } catch (e) {
    console.error("[Bitly] SSR sin datos:", e);
    return { info: INFO_POR_DEFECTO, stats: { windows: 0, android: 0 }, release: null };
  }
}

export const Route = createFileRoute("/")({
  loader: cargarDatos,
  head: () => ({
    // El título, la descripción, el canonical y los OG los declara la raíz:
    // repetirlos acá sólo generaba metas duplicadas en el HTML.
    meta: [{ title: TITULO }],
  }),
  component: Index,
});

export default function Index() {
  const datos = Route.useLoaderData();
  // Idioma y moneda guardados se aplican acá, dentro del contenido de la ruta
  // y por lo tanto DESPUÉS de que hidrató (ver `preferencias.ts`).
  usePreferenciasGuardadas();
  const [info, setInfo] = useState<InfoApp>(datos.info);
  const [stats, setStats] = useState(datos.stats);
  const [showMobile, setShowMobile] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [releasePlatform, setReleasePlatform] = useState<"windows" | "android" | "tv" | "ios" | "macos">("android");
  const [blocked, setBlocked] = useState(false);
  const [release, setRelease] = useState<ReleaseIndex | null>(datos.release);

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
        const { data: d } = await supabase.from("app_info").select("*").limit(1).maybeSingle();
        if (d) setInfo(d as InfoApp);
        const s = await supabase.from("download_stats").select("platform,count");
        if (s.data) {
          const m: Record<string, number> = {};
          s.data.forEach((r) => (m[r.platform] = Number(r.count)));
          setStats((prev) => ({ ...prev, windows: m.windows ?? prev.windows, android: m.android ?? prev.android }));
        }
      } catch (e) { console.error("[Bitly] Failed to load app info:", e); }
    })();
    initRates();
    // El loader ya trajo la release prerenderizada; esto sólo la refresca si el
    // visitante se queda (la caché de `cargarReleases` vive en localStorage).
    let vivo = true;
    cargarReleases()
      .then((r) => { if (vivo) setRelease(r); })
      .catch((e) => { console.error("[Bitly] No se pudieron cargar las releases:", e); });
    return () => { vivo = false; };
  }, []);

  const handleDownload = async (platform: "windows" | "android" | "tv" | "ios" | "macos", url: string | null) => {
    const statsPlatform = platform === "tv" ? "android" : platform;
    setStats((s) => ({ ...s, [statsPlatform]: (s[statsPlatform as keyof typeof s] ?? 0) + 1 }));
    try { await supabase.rpc("increment_download", { _platform: statsPlatform }); } catch (e) { console.error("[Bitly] Failed to increment download:", e); }
    setReleasePlatform(platform);
    setShowRelease(true);
  };

  const total = (stats.windows ?? 0) + (stats.android ?? 0);
  const platforms = release?.platforms;
  const androidUrl = platforms?.android.url ?? info.android_url;
  const windowsUrl = platforms?.windows.url ?? info.windows_url;
  const iosUrl = platforms?.ios.url ?? null;
  const macosUrl = platforms?.macos.url ?? null;
  // Smart TV instala el mismo APK que Android.
  const modalKey: PlatformKey = releasePlatform === "tv" ? "android" : releasePlatform;
  const modalRelease = platforms?.[modalKey];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <ScrollProgress />
      <Particles />
      <GlowBackground />
      <Header />
      <SectionNav />
      <main className="flex-1 flex flex-col justify-center">
        <HeroSection
          tagline={info.tagline} description={info.description} version={release?.version || info.version}
          isBlocked={blocked} windowsUrl={windowsUrl} androidUrl={androidUrl} iosUrl={iosUrl} macosUrl={macosUrl}
          totalDownloads={total} windowsDownloads={stats.windows ?? 0} androidDownloads={stats.android ?? 0}
          onDownload={handleDownload}
          onOpenMobile={() => setShowMobile(true)}
          onOpenFaq={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </main>
      <DemoPlayer />
      <InstallSection onDownload={(p) => handleDownload(p, null)} />
      <Opiniones />
      <FaqSection />
      <PlansSection />
      <Footer />
      <Suspense fallback={null}>
        {showMobile && <MobileModal open onClose={() => setShowMobile(false)} />}
        {showRelease && (
          <ReleaseModal
            open
            onClose={() => setShowRelease(false)}
            platform={releasePlatform}
            assets={modalRelease?.assets ?? []}
            version={modalRelease?.version ?? ""}
            latestVersion={release?.version ?? ""}
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
