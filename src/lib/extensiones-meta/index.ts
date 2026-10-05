// GENERADO por scripts/sync-extensiones.mjs — NO EDITAR A MANO.
// Datos de los manifests de las extensiones que ofrece la demo.

export type FiltroBusqueda = { id: string; label?: string; icon?: string };

export type SearchBehavior = {
  enabled?: boolean;
  primary?: boolean;
  placeholder?: string;
  icon?: string;
  thumbnailRatio?: string;
  filters?: FiltroBusqueda[];
};

export type ManifestExtension = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  permissions: string[];
  searchBehavior: SearchBehavior | null;
};

export const MANIFESTS: Record<string, ManifestExtension> = {
  "spotify-web": {
  "name": "spotify-web",
  "displayName": "Spotify Web",
  "version": "1.9.12",
  "description": "Fetch Spotify metadata via web API. Supports personalized playlists like Daily Mix, Discover Weekly, and more. Includes Home Feed explore and metadata enrichment via Spotify native ISRC plus Deezer.",
  "permissions": [
    "open.spotify.com",
    "*.spotify.com",
    "api-partner.spotify.com",
    "clienttoken.spotify.com",
    "i.scdn.co",
    "*.scdn.co",
    "api.deezer.com"
  ],
  "searchBehavior": {
    "enabled": true,
    "placeholder": "Search Spotify...",
    "icon": "spotify",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "tracks",
        "label": "Songs",
        "icon": "music"
      },
      {
        "id": "albums",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artists",
        "label": "Artists",
        "icon": "artist"
      },
      {
        "id": "playlists",
        "label": "Playlists",
        "icon": "playlist"
      }
    ]
  }
},
  "amazon": {
  "name": "amazon",
  "displayName": "Amazon Music",
  "version": "2.1.4",
  "description": "Amazon Music metadata & download provider for SpotiFLAC. Browse tracks, albums, artists, playlists from Amazon Music links and search. Downloads lossless and Dolby Atmos audio.",
  "permissions": [
    "na.mesk.skill.music.a2z.com",
    "na.web.skill.music.a2z.com",
    "music.amazon.com",
    "music.amazon.co",
    "music.amazon.de",
    "music.amazon.co.uk",
    "music.amazon.co.jp",
    "music.amazon.fr",
    "music.amazon.it",
    "music.amazon.es",
    "music.amazon.in",
    "music.amazon.com.br",
    "music.amazon.com.mx",
    "music.amazon.com.au",
    "m.media-amazon.com",
    "api.zarz.moe",
    "song.link",
    "api.song.link",
    "odesli.io",
    "api.deezer.com",
    "open.spotify.com",
    "songstats.com",
    "*.cloudfront.net"
  ],
  "searchBehavior": {
    "enabled": true,
    "placeholder": "Search Amazon Music...",
    "icon": "amazon",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "songs",
        "label": "Songs"
      },
      {
        "id": "albums",
        "label": "Albums"
      },
      {
        "id": "artists",
        "label": "Artists"
      },
      {
        "id": "playlists",
        "label": "Playlists"
      }
    ]
  }
},
  "soundcloud": {
  "name": "soundcloud",
  "displayName": "SoundCloud",
  "version": "1.0.5",
  "description": "SoundCloud metadata and download provider. Search tracks, albums, playlists, artists. Downloads via direct SoundCloud streams.",
  "permissions": [
    "soundcloud.com",
    "api-v2.soundcloud.com",
    "*.sndcdn.com",
    "on.soundcloud.com",
    "m.soundcloud.com"
  ],
  "searchBehavior": {
    "enabled": true,
    "placeholder": "Search SoundCloud...",
    "icon": "cloud",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "tracks",
        "label": "Tracks",
        "icon": "music"
      },
      {
        "id": "albums",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artists",
        "label": "Artists",
        "icon": "artist"
      },
      {
        "id": "playlists",
        "label": "Playlists",
        "icon": "playlist"
      }
    ]
  }
},
  "ytmusic-spotiflac": {
  "name": "ytmusic-spotiflac",
  "displayName": "YouTube Music",
  "version": "2.3.8",
  "description": "YouTube Music metadata & download provider for SpotiFLAC Mobile. Search tracks, albums, playlists on YouTube Music.",
  "permissions": [
    "music.youtube.com",
    "*.youtube.com",
    "www.youtube.com",
    "i.ytimg.com",
    "*.googlevideo.com",
    "*.pictube.app",
    "api.zarz.moe",
    "127.0.0.1",
    "localhost",
    "api.song.link",
    "odesli.io",
    "api.deezer.com",
    "yt1d.io"
  ],
  "searchBehavior": {
    "enabled": true,
    "placeholder": "Search YouTube Music...",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "tracks",
        "label": "Songs",
        "icon": "music"
      },
      {
        "id": "albums",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artists",
        "label": "Artists",
        "icon": "artist"
      },
      {
        "id": "playlists",
        "label": "Playlists",
        "icon": "playlist"
      }
    ]
  }
},
  "deezer": {
  "name": "deezer",
  "displayName": "Deezer",
  "version": "1.1.5",
  "description": "Deezer metadata and download provider for SpotiFLAC Mobile.",
  "permissions": [
    "api.zarz.moe",
    "dl.musicdl.me",
    "api.deezer.com",
    "www.deezer.com",
    "deezer.page.link",
    "link.deezer.com",
    "*.dzcdn.net"
  ],
  "searchBehavior": {
    "enabled": true,
    "primary": true,
    "placeholder": "Search Deezer...",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "track",
        "label": "Songs",
        "icon": "music"
      },
      {
        "id": "album",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artist",
        "label": "Artists",
        "icon": "artist"
      },
      {
        "id": "playlist",
        "label": "Playlists",
        "icon": "playlist"
      }
    ]
  }
},
  "pandora": {
  "name": "pandora",
  "displayName": "Pandora",
  "version": "1.0.8",
  "description": "Pandora metadata and download provider for SpotiFLAC Mobile. Handles Pandora track and album URLs.",
  "permissions": [
    "api.zarz.moe",
    "api.song.link",
    "song.link",
    "pandora.app.link",
    "www.pandora.com",
    "*.pandora.com",
    "*.p-cdn.us",
    "*.p-cdn.com",
    "api.deezer.com"
  ],
  "searchBehavior": null
},
  "qobuz-web": {
  "name": "qobuz-web",
  "displayName": "Qobuz",
  "version": "1.0.7",
  "description": "Qobuz metadata and download provider for SpotiFLAC Mobile.",
  "permissions": [
    "api.zarz.moe",
    "www.qobuz.com",
    "qobuz.com",
    "play.qobuz.com",
    "open.qobuz.com",
    "static.qobuz.com",
    "streaming-qobuz-std.akamaized.net"
  ],
  "searchBehavior": {
    "enabled": true,
    "primary": false,
    "placeholder": "Search Qobuz...",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "track",
        "label": "Songs",
        "icon": "music"
      },
      {
        "id": "album",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artist",
        "label": "Artists",
        "icon": "artist"
      }
    ]
  }
},
  "tidal-web": {
  "name": "tidal-web",
  "displayName": "Tidal",
  "version": "1.0.9",
  "description": "TIDAL metadata and search provider for SpotiFLAC Mobile using TIDAL public web endpoints.",
  "permissions": [
    "tidal.com",
    "www.tidal.com",
    "listen.tidal.com",
    "resources.tidal.com",
    "api.zarz.moe",
    "*.audio.tidal.com",
    "*.manifest.tidal.com"
  ],
  "searchBehavior": {
    "enabled": true,
    "primary": false,
    "placeholder": "Search TIDAL...",
    "thumbnailRatio": "square",
    "filters": [
      {
        "id": "track",
        "label": "Songs",
        "icon": "music"
      },
      {
        "id": "album",
        "label": "Albums",
        "icon": "album"
      },
      {
        "id": "artist",
        "label": "Artists",
        "icon": "artist"
      },
      {
        "id": "playlist",
        "label": "Playlists",
        "icon": "playlist"
      }
    ]
  }
},
};
