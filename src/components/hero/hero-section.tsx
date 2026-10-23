import HeroTexto from "./hero-texto";
import HeroDescargas, { type Plataforma } from "./hero-descargas";
import HeroArte from "./hero-arte";
import HeroPie from "./hero-pie";
import type { ReactNode } from "react";

type Props = {
  tagline: string;
  description: string;
  version: string | null;
  isBlocked: boolean;
  windowsUrl: string | null;
  androidUrl: string | null;
  iosUrl: string | null;
  macosUrl: string | null;
  totalDownloads: number;
  totalViews: number;
  promedio: number;
  opiniones: number;
  comentarios?: ReactNode;
  onDownload: (plataforma: Plataforma, url: string | null) => void;
};

export default function HeroSection({
  tagline,
  description,
  version,
  isBlocked,
  windowsUrl,
  androidUrl,
  iosUrl,
  macosUrl,
  totalDownloads,
  totalViews,
  promedio,
  opiniones,
  comentarios,
  onDownload,
}: Props) {
  return (
    <section className="relative flex h-full w-full flex-col px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-3 lg:px-8 xl:px-10">
      <div className="grid min-h-0 flex-1 items-center gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.62fr)] lg:gap-6">
        <div className="relative z-10 flex flex-col gap-3.5 sm:gap-4 lg:pr-2">
          <HeroTexto tagline={tagline} description={description} version={version} />
          <HeroDescargas
            isBlocked={isBlocked}
            windowsUrl={windowsUrl}
            androidUrl={androidUrl}
            iosUrl={iosUrl}
            macosUrl={macosUrl}
            onDownload={onDownload}
          />
        </div>

        <HeroArte />
      </div>

      {comentarios && <div className="shrink-0 pb-2">{comentarios}</div>}

      <HeroPie total={totalDownloads} vistas={totalViews} promedio={promedio} opiniones={opiniones} />
    </section>
  );
}
