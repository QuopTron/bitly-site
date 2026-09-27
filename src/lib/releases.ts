// ─────────────────────────────────────────────────────────────
// releases.ts — Índice de versiones publicadas de Bitly.
//
// De dónde salen los binarios: el repo del CÓDIGO (QuopTron/bitly) es PRIVADO,
// y contra un repo privado la API pública responde 404 y sus assets solo se
// bajan con un token. Por eso las releases se espejan en un repo PÚBLICO sin
// código (QuopTron/bitly-releases): ahí la API responde sin autenticar y los
// assets se descargan por URL directa. Es el mismo repo que consume el detector
// de actualizaciones de la app (UpdateService.repoPublico), así que sitio y app
// muestran siempre la misma versión.
//
// Se lee /releases y no /releases/latest a propósito: una release nueva puede
// publicarse con solo algunas plataformas (por ejemplo, solo los APK) y con el
// endpoint "latest" los botones de Windows, macOS e iOS quedan vacíos. Cada
// plataforma se resuelve contra la release más nueva que sí tenga su asset.
// ─────────────────────────────────────────────────────────────

export const RELEASES_REPO = "QuopTron/bitly-releases";

const API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;

const CACHE_KEY = "bitly_releases_v3";
const CACHE_TTL = 30 * 60 * 1000;

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type PlatformKey = "android" | "windows" | "ios" | "macos";

/** Release de la que salen los assets de una plataforma. */
export type PlatformRelease = {
  /** Tag sin la "v" inicial (ej. "0.9.25"). "" si esa plataforma no tiene nada. */
  version: string;
  assets: ReleaseAsset[];
  url: string | null;
};

export type ReleaseIndex = {
  /** Versión de la release más reciente publicada, sin la "v". */
  version: string;
  platforms: Record<PlatformKey, PlatformRelease>;
};

const EXTENSION: Record<PlatformKey, string> = {
  android: ".apk",
  windows: ".exe",
  ios: ".ipa",
  macos: ".dmg",
};

const SIN_RELEASE: PlatformRelease = { version: "", assets: [], url: null };

function sinV(tag: string): string {
  return tag.replace(/^v/i, "").trim();
}

function esArm(nombre: string): boolean {
  return /arm64|aarch64/.test(nombre.toLowerCase());
}

function assetsDe(release: any): ReleaseAsset[] {
  const lista: any[] = Array.isArray(release?.assets) ? release.assets : [];
  return lista.map((a) => ({
    name: String(a?.name ?? ""),
    browser_download_url: String(a?.browser_download_url ?? ""),
    size: Number(a?.size ?? 0),
  }));
}

/** Asset que se descarga por defecto: el que sirve a la mayoría de equipos. */
function mejorUrl(assets: ReleaseAsset[], platform: PlatformKey): string | null {
  const ext = EXTENSION[platform];
  const propios = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
  if (propios.length === 0) return null;
  if (platform === "android") {
    const arm64 = propios.find((a) => esArm(a.name));
    if (arm64) return arm64.browser_download_url;
  }
  if (platform === "windows") {
    const x64 = propios.find((a) => !esArm(a.name));
    if (x64) return x64.browser_download_url;
  }
  return propios[0].browser_download_url;
}

/** Arma el índice por plataforma a partir de la respuesta de /releases. */
export function indexar(releases: any[]): ReleaseIndex {
  const lista: any[] = Array.isArray(releases) ? releases : [];
  // La API las devuelve de más nueva a más vieja; /releases/latest además excluye
  // borradores y pre-releases, así que el filtro replica ese criterio.
  const publicadas = lista.filter((r) => r && r.tag_name && !r.draft && !r.prerelease);

  const platforms = {} as Record<PlatformKey, PlatformRelease>;
  (Object.keys(EXTENSION) as PlatformKey[]).forEach((key) => {
    const ext = EXTENSION[key];
    const release = publicadas.find((r) =>
      assetsDe(r).some((a) => a.name.toLowerCase().endsWith(ext)),
    );
    if (!release) {
      platforms[key] = { ...SIN_RELEASE };
      return;
    }
    const assets = assetsDe(release);
    platforms[key] = { version: sinV(String(release.tag_name)), assets, url: mejorUrl(assets, key) };
  });

  return { version: publicadas[0] ? sinV(String(publicadas[0].tag_name)) : "", platforms };
}

async function cargarRemoto(): Promise<ReleaseIndex> {
  const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) {
    throw new Error(`GitHub respondió ${res.status} ${res.statusText} (${RELEASES_REPO})`);
  }
  return indexar(await res.json());
}

/** Índice de releases con caché de 30 min en localStorage. */
export async function cargarReleases(): Promise<ReleaseIndex> {
  try {
    const crudo = localStorage.getItem(CACHE_KEY);
    if (crudo) {
      const { data, ts } = JSON.parse(crudo);
      if (Date.now() - ts < CACHE_TTL) return data as ReleaseIndex;
    }
  } catch {}

  const data = await cargarRemoto();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
  return data;
}
