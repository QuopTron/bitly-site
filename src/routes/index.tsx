import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Monitor,
  Smartphone,
  Music,
  Layers,
  Puzzle,
  Search,
  ListMusic,
  Tags,
  Sparkles,
  Download,
  Loader2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import logo from "@/assets/bitly-logo.png";
import { supabase } from "@/integrations/supabase/client";
import PricingModal from "@/components/pricing-modal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "bitly — Tu música, sin límites" },
      {
        name: "description",
        content:
          "Descarga bitly: música FLAC sin pérdida desde Tidal, Qobuz, Deezer y más. Disponible para Windows y Android.",
      },
    ],
  }),
  component: Index,
});

const iconMap: Record<string, typeof Music> = {
  Music,
  Layers,
  Puzzle,
  Search,
  ListMusic,
  Tags,
  Sparkles,
};

type AppInfo = {
  name: string;
  tagline: string;
  description: string;
  windows_url: string | null;
  android_url: string | null;
  version: string | null;
};

type Feature = { id: string; title: string; description: string; icon: string };
type Stat = { platform: string; count: number };

function formatNumber(n: number) {
  return new Intl.NumberFormat("es-ES").format(n);
}

function Index() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({ windows: 0, android: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  const loadStats = async () => {
    const { data } = await supabase.from("download_stats").select("platform,count");
    if (data) {
      const map: Record<string, number> = {};
      (data as Stat[]).forEach((s) => (map[s.platform] = Number(s.count)));
      setStats(map);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        // Load app info first
        const { data: infoData, error: e1 } = await supabase.from("app_info").select("*").limit(1).maybeSingle();
        if (e1) throw e1;
        setInfo(infoData as AppInfo | null);

        // Try to load features filtered by `show_on_page`; if the DB doesn't have that column
        // (migration not applied) the request may fail with 400. Fall back to loading all features.
        let featResp;
        try {
          featResp = await supabase.from("features").select("*").eq("show_on_page", true).order("sort_order");
          if (featResp.error) throw featResp.error;
        } catch (e) {
          console.warn("Filtered features request failed, falling back to unfiltered features:", e);
          featResp = await supabase.from("features").select("*").order("sort_order");
        }

        setFeatures((featResp.data ?? []) as Feature[]);
        await loadStats();
      } catch (err) {
        console.error("Error cargando datos:", err);
        setError(err instanceof Error ? err.message : "Error al cargar");
      } finally {
        setLoading(false);
      }
    })();

    // Realtime updates for the counter
    const channel = supabase
      .channel("download_stats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "download_stats" },
        () => loadStats(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDownload = async (platform: "windows" | "android", url: string | null) => {
    // optimistic
    setStats((s) => ({ ...s, [platform]: (s[platform] ?? 0) + 1 }));
    try {
      await supabase.rpc("increment_download", { _platform: platform });
    } catch (e) {
      console.error("increment_download error", e);
    }
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">No pudimos cargar la información</h1>
          <p className="mt-2 text-muted-foreground">{error ?? "Sin datos disponibles."}</p>
        </div>
      </div>
    );
  }

  const totalDownloads = (stats.windows ?? 0) + (stats.android ?? 0);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-accent/20 blur-[140px]" />
        <div className="absolute top-[40%] left-[40%] h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      {/* Nav */}
      <header className="container mx-auto flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <img src={logo} alt={`Logo ${info.name}`} className="h-10 w-10" />
            <span className="text-xl font-bold tracking-tight">{info.name}</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            <span className="text-white">powered by </span>
            <span className="font-semibold text-white">Flo</span>
            <span className="font-semibold text-emerald-400">X</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPricing(true)}
            className="hidden sm:inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
          >
            <Wallet className="h-4 w-4" /> Pricing
          </button>
          <a
            href="#descargar"
            className="hidden sm:inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Download className="h-4 w-4" /> Descargar
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto grid items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {info.version ? `Versión ${info.version} disponible` : "Nueva versión disponible"}
          </div>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-mint)" }}
            >
              {info.tagline}
            </span>
          </h1>
          <p className="max-w-md text-lg text-muted-foreground">{info.description}</p>

          <div id="descargar" className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => handleDownload("windows", info.windows_url)}
              className="group flex items-center gap-3 rounded-2xl bg-foreground px-6 py-3.5 text-background transition hover:scale-[1.02]"
            >
              <Monitor className="h-7 w-7" />
              <div className="text-left">
                <div className="text-[10px] uppercase opacity-70">Descarga para</div>
                <div className="text-base font-semibold leading-tight">Windows</div>
              </div>
            </button>
            <button
              onClick={() => handleDownload("android", info.android_url)}
              className="group flex items-center gap-3 rounded-2xl bg-foreground px-6 py-3.5 text-background transition hover:scale-[1.02]"
            >
              <Smartphone className="h-7 w-7" />
              <div className="text-left">
                <div className="text-[10px] uppercase opacity-70">APK directo</div>
                <div className="text-base font-semibold leading-tight">Android</div>
              </div>
            </button>
          </div>

          {/* Live counter */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="font-semibold tabular-nums">{formatNumber(totalDownloads)}</span>
              <span className="text-muted-foreground">descargas totales</span>
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-card/40 px-3 py-1 backdrop-blur">
                <Monitor className="mr-1 inline h-3 w-3" /> {formatNumber(stats.windows ?? 0)}
              </span>
              <span className="rounded-full border border-border bg-card/40 px-3 py-1 backdrop-blur">
                <Smartphone className="mr-1 inline h-3 w-3" /> {formatNumber(stats.android ?? 0)}
              </span>
            </div>
          </div>
        </div>

        <div className="relative flex justify-center">
          <div
            className="absolute inset-0 rounded-full blur-3xl"
            style={{ background: "var(--gradient-mint)", opacity: 0.35 }}
          />
          <img
            src={logo}
            alt={`Logo ${info.name}`}
            className="relative w-full max-w-sm drop-shadow-2xl"
          />
        </div>
      </section>

      {/* Features */}
      {features.length > 0 && (
        <section className="container mx-auto px-6 py-20">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Características
            </div>
            <h2 className="text-4xl font-bold tracking-tight md:text-5xl">
              Todo lo que necesitas para una{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-mint)" }}
              >
                biblioteca de música
              </span>{" "}
              de alta calidad
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = iconMap[f.icon] ?? Music;
              return (
                <div
                  key={f.id}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card/40 p-6 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_0_40px_-10px_hsl(var(--primary)/0.4)]"
                >
                  <div
                    className="absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30"
                    style={{ background: "var(--gradient-mint)" }}
                  />
                  <div className="relative">
                    <div
                      className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30"
                      style={{ background: "var(--gradient-mint)", opacity: 0.95 }}
                    >
                      <Icon className="h-6 w-6 text-background" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer className="container mx-auto px-6 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} {info.name}. Todos los derechos reservados.
      </footer>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
