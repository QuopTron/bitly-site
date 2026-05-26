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
        if (d) setInfo(d as any);
        const s = await supabase.from("download_stats").select("platform,count");
        if (s.data) {
          const m: Record<string, number> = {};
          (s.data as any[]).forEach((r) => (m[r.platform] = Number(r.count)));
          setStats(m as any);
        }
      } catch {} finally { setLoading(false); }
    })();
    initRates();
  }, []);

  const handleDownload = async (platform: "windows" | "android", url: string | null) => {
    setStats((s) => ({ ...s, [platform]: (s[platform] ?? 0) + 1 }));
    try { await supabase.rpc("increment_download", { _platform: platform }); } catch {}
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const total = (stats.windows ?? 0) + (stats.android ?? 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Particles />
      <GlowBackground />
      <Header onPricing={() => setShowPricing(true)} />
      <main className="flex-1 flex flex-col justify-center">
        <HeroSection
          tagline={info.tagline} description={info.description} version={info.version}
          isBlocked={blocked} windowsUrl={info.windows_url} androidUrl={info.android_url}
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
