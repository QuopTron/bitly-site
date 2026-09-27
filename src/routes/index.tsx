import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Particles from "@/components/particles";
import GlowBackground from "@/components/layout/glow-background";
import Header from "@/components/layout/header";
import HeroSection from "@/components/hero/hero-section";
import Footer from "@/components/layout/footer";
import MobileModal from "@/components/modals/mobile-modal";
import FaqModal from "@/components/modals/faq-modal";
import ReleaseModal from "@/components/modals/release-modal";
import PlansSection from "@/components/plans-section";
// import InstallModal from "@/components/modals/install-modal";
import { initRates } from "@/lib/currency";
import { cargarReleases, type PlatformKey, type ReleaseIndex } from "@/lib/releases";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bitly — Tu música, sin límites" },
      { name: "description", content: "Descarga Bitly: música FLAC sin pérdida desde Tidal, Qobuz, Deezer y más." },
    ],
  }),
  component: Index,
});

export default function Index() {
  const [info, setInfo] = useState({ name: "Bitly", tagline: "Tu música, sin límites", description: "", windows_url: null, android_url: null, version: "1.0.0" });
  const [stats, setStats] = useState<{ [key: string]: number }>({ windows: 0, android: 0 });
  const [loading, setLoading] = useState(true);
  const [showMobile, setShowMobile] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [releasePlatform, setReleasePlatform] = useState<"windows" | "android" | "tv" | "ios" | "macos">("android");
  // const [showInstall, setShowInstall] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [release, setRelease] = useState<ReleaseIndex | null>(null);

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
        if (d) setInfo(d as typeof info);
        const s = await supabase.from("download_stats").select("platform,count");
        if (s.data) {
          const m: Record<string, number> = {};
          s.data.forEach((r) => (m[r.platform] = Number(r.count)));
          setStats(m as typeof stats);
        }
      } catch (e) { console.error("[Bitly] Failed to load app info:", e); } finally { setLoading(false); }
    })();
    initRates();

    let vivo = true;
    cargarReleases()
      .then((r) => {
        if (vivo) setRelease(r);
      })
      .catch((e) => {
        console.error("[Bitly] No se pudieron cargar las releases:", e);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const handleDownload = async (platform: "windows" | "android" | "tv" | "ios" | "macos", url: string | null) => {
    const statsPlatform = platform === "tv" ? "android" : platform;
    setStats((s) => ({ ...s, [statsPlatform]: (s[statsPlatform] ?? 0) + 1 }));
    try { await supabase.rpc("increment_download", { _platform: statsPlatform }); } catch (e) { console.error("[Bitly] Failed to increment download:", e); }
    setReleasePlatform(platform);
    setShowRelease(true);
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

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
      <Particles />
      <GlowBackground />
      <Header />
      <main className="flex-1 flex flex-col justify-center">
        <HeroSection
          tagline={info.tagline} description={info.description} version={release?.version || info.version}
          isBlocked={blocked} windowsUrl={windowsUrl} androidUrl={androidUrl} iosUrl={iosUrl} macosUrl={macosUrl}
          totalDownloads={total} windowsDownloads={stats.windows ?? 0} androidDownloads={stats.android ?? 0}
          onDownload={handleDownload}
          onOpenMobile={() => setShowMobile(true)}
          onOpenFaq={() => setShowFaq(true)}
        />
      </main>
      <PlansSection />
      <Footer />
      <MobileModal open={showMobile} onClose={() => setShowMobile(false)} />
      <FaqModal open={showFaq} onClose={() => setShowFaq(false)} />
      <ReleaseModal
        open={showRelease}
        onClose={() => setShowRelease(false)}
        platform={releasePlatform}
        assets={modalRelease?.assets ?? []}
        version={modalRelease?.version ?? ""}
        latestVersion={release?.version ?? ""}
      />
      {/* <InstallModal open={showInstall} onClose={() => setShowInstall(false)} url={androidUrl} /> */}
    </div>
  );
}
