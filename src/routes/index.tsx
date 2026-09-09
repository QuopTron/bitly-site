import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Particles from "@/components/particles";
import GlowBackground from "@/components/layout/glow-background";
import Header from "@/components/layout/header";
import HeroSection from "@/components/hero/hero-section";
import Footer from "@/components/layout/footer";
import PricingModal from "@/components/modals/pricing-modal";
import PrereserveModal from "@/components/modals/prereserve-modal";
import MobileModal from "@/components/modals/mobile-modal";
import FaqModal from "@/components/modals/faq-modal";
import { initRates } from "@/lib/currency";

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
  const [stats, setStats] = useState({ windows: 0, android: 0 });
  const [loading, setLoading] = useState(true);
  const [showPricing, setShowPricing] = useState(false);
  const [showPrereserve, setShowPrereserve] = useState(false);
  const [showMobile, setShowMobile] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [release, setRelease] = useState<{ version: string; apkUrl: string | null }>({ version: "", apkUrl: null });

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

    const CACHE_KEY = "bitly_release";
    const CACHE_TTL = 30 * 60 * 1000;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setRelease(data);
          return;
        }
      }
    } catch {}

    fetch("https://api.github.com/repos/QuopTron/bitly/releases/latest")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const assets: Array<{ name: string; browser_download_url: string }> = data.assets ?? [];
        const apk = assets.find((a) => a.name.includes("arm64")) ?? assets.find((a) => a.name.endsWith(".apk"));
        const result = { version: data.tag_name ?? "", apkUrl: apk?.browser_download_url ?? null };
        setRelease(result);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: result, ts: Date.now() })); } catch {}
      })
      .catch(() => {});
  }, []);

  const handleDownload = async (platform: "windows" | "android", url: string | null) => {
    setStats((s) => ({ ...s, [platform]: (s[platform] ?? 0) + 1 }));
    try { await supabase.rpc("increment_download", { _platform: platform }); } catch (e) { console.error("[Bitly] Failed to increment download:", e); }
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const total = (stats.windows ?? 0) + (stats.android ?? 0);
  const androidUrl = release.apkUrl ?? info.android_url;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Particles />
      <GlowBackground />
      <Header onPricing={() => setShowPricing(true)} />
      <main className="flex-1 flex flex-col justify-center">
        <HeroSection
          tagline={info.tagline} description={info.description} version={release.version || info.version}
          isBlocked={blocked} windowsUrl={info.windows_url} androidUrl={androidUrl}
          totalDownloads={total} windowsDownloads={stats.windows ?? 0} androidDownloads={stats.android ?? 0}
          onDownload={handleDownload}
          onOpenMobile={() => setShowMobile(true)}
          onOpenFaq={() => setShowFaq(true)}
        />
      </main>
      <Footer />
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} onPreReserve={() => setShowPrereserve(true)} />}
      {showPrereserve && <PrereserveModal onClose={() => setShowPrereserve(false)} />}
      <MobileModal open={showMobile} onClose={() => setShowMobile(false)} />
      <FaqModal open={showFaq} onClose={() => setShowFaq(false)} />
    </div>
  );
}
