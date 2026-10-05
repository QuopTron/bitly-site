// GENERADO por scripts/sync-extensiones.mjs — NO EDITAR A MANO.
import { crear as crear_spotify_web } from "./spotify-web";
import { crear as crear_amazon } from "./amazon";
import { crear as crear_soundcloud } from "./soundcloud";
import { crear as crear_ytmusic_spotiflac } from "./ytmusic-spotiflac";
import { crear as crear_deezer } from "./deezer";
import { crear as crear_pandora } from "./pandora";
import { crear as crear_qobuz_web } from "./qobuz-web";
import { crear as crear_tidal_web } from "./tidal-web";

export type Creador = (entorno: any) => any;

export const creadores: Record<string, Creador> = {
  "spotify-web": crear_spotify_web,
  "amazon": crear_amazon,
  "soundcloud": crear_soundcloud,
  "ytmusic-spotiflac": crear_ytmusic_spotiflac,
  "deezer": crear_deezer,
  "pandora": crear_pandora,
  "qobuz-web": crear_qobuz_web,
  "tidal-web": crear_tidal_web,
};
