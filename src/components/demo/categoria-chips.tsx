"use client";

import { Disc, ListMusic, Music, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { categoriaDeFiltro, type Categoria, type ExtensionDemo } from "@/lib/demo-extensiones";

const ICONOS: Record<Categoria, LucideIcon> = {
  tracks: Music,
  albums: Disc,
  artists: User,
  playlists: ListMusic,
};

const CLAVES: Record<Categoria, string> = {
  tracks: "demoCatTracks",
  albums: "demoCatAlbums",
  artists: "demoCatArtists",
  playlists: "demoCatPlaylists",
};

/**
 * Chips de categoría de la fuente activa (las "burbujas" del buscador de la
 * app): filtran por canciones / álbumes / artistas / listas según los filtros
 * del manifest de la extensión. Pulsar el chip seleccionado lo apaga y deja
 * los resultados mezclados, igual que en la app.
 *
 * Se ENVUELVEN en varias filas a propósito (nada de `overflow-x-auto`): las 4
 * burbujas tienen que verse de una sin arrastrar la fila, que era justo lo que
 * quedaba escondido en el marco de celular.
 */
export default function CategoriaChips({
  extension,
  filtro,
  onCambiado,
}: {
  extension: ExtensionDemo;
  filtro: string | null;
  onCambiado: (filtro: string | null) => void;
}) {
  const t = useI18n();
  if (extension.filtros.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1.5 px-1 pb-0.5" role="group">
      {extension.filtros.map((f) => {
        const cat = categoriaDeFiltro(f.id);
        if (!cat) return null;
        const Icono = ICONOS[cat];
        const sel = filtro === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onCambiado(sel ? null : f.id)}
            aria-pressed={sel}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-all duration-200 active:scale-90 ${
              sel
                ? "bg-primary/20 text-foreground ring-primary/40 shadow-sm shadow-primary/20"
                : "text-muted-foreground ring-border/60 hover:bg-card/60 hover:text-foreground"
            }`}
          >
            <Icono className={`h-3 w-3 ${sel ? "text-primary" : "opacity-70"}`} />
            {t(CLAVES[cat])}
          </button>
        );
      })}
    </div>
  );
}
