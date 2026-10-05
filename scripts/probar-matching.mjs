#!/usr/bin/env node
/**
 * Verifica el port del matching (`src/server/matching.ts`) contra los casos que
 * ya fija el backend Go (`go_backend/internal/provider/matching_*_test.go`).
 *
 * Compila el módulo con esbuild (el mismo transformador que usa Vite) y corre
 * las aserciones fuera del navegador. Sirve para detectar una separación entre
 * las dos implementaciones sin tener que reproducir cada bug en la app.
 *
 * Uso:
 *   node scripts/probar-matching.mjs
 */

import { readdirSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cargarEsbuild() {
  const base = path.join(raiz, "node_modules", ".pnpm");
  const carpeta = readdirSync(base).find((d) => d.startsWith("esbuild@"));
  if (!carpeta) {
    console.error("No encuentro esbuild en node_modules/.pnpm (¿pnpm install?).");
    process.exit(1);
  }
  return import(
    pathToFileURL(path.join(base, carpeta, "node_modules", "esbuild", "lib", "main.js")).href
  ).then((m) => (m.build ? m : m.default));
}

const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const salida = path.join(cache, "matching.mjs");

const esbuild = await cargarEsbuild();
let m;
try {
  await esbuild.build({
    entryPoints: [path.join(raiz, "src", "server", "matching.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: salida,
    logLevel: "error",
  });
  m = await import(pathToFileURL(salida).href + `?v=${Date.now()}`);

  let fallos = 0;
  let pruebas = 0;

  const igual = (nombre, got, want) => {
    pruebas++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      fallos++;
      console.log(`✗ ${nombre}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    }
  };

  const t = (id, o = {}) => ({
    id,
    title: o.title ?? "",
    artist: o.artist ?? "",
    album: o.album ?? "",
    coverUrl: "",
    durationMs: o.durationMs ?? 0,
    isrc: o.isrc ?? "",
    provider: o.provider ?? "",
  });

  /* ── Plegado y marcadores ─────────────────────────────────────── */
  igual("fold acentos", m.foldTrack("Puñaladas"), "punaladas");
  igual("fold ruido", m.foldTrack("Song (Official Video)"), "song");
  // "Alive" no es "live" y "Discover" no es "cover": van por palabra completa.
  igual("Alive no es live", m.isNonOriginalTitle("Alive"), false);
  igual("Discover no es cover", m.isNonOriginalTitle("Discover"), false);
  igual("En Vivo sí", m.isNonOriginalTitle("La Bachata (En Vivo)"), true);
  igual("Acústico sí", m.isNonOriginalTitle("ACUSTICO"), true);
  // El marcador solo cuenta si la CONSULTA no lo trae.
  igual("remix pedido por título sí se acepta", m.isNonOriginalTrack(t("x", { title: "MORNING DEW (DONK) REMIX", artist: "Beyoncé" }), "MORNING DEW (DONK) REMIX", "Beyoncé"), false);

  /* ── OriginalStrength (matching_test.go) ─────────────────────── */
  const fuerza = (qt, qa, cand) => m.QueryFiltro ? new m.QueryFiltro(qt, qa).originalStrength(cand).strong : null;
  igual("original exacto", fuerza("Si Antes Te Hubiera Conocido", "KAROL G", t("a", { title: "Si Antes Te Hubiera Conocido", artist: "KAROL G" })), true);
  igual("remix rechazado", fuerza("Si Antes Te Hubiera Conocido", "KAROL G", t("a", { title: "Si Antes Te Hubiera Conocido (Remix)", artist: "KAROL G" })), false);
  igual("cover de otro rechazado", fuerza("Si Antes Te Hubiera Conocido", "KAROL G", t("a", { title: "Si Antes Te Hubiera Conocido", artist: "Some Cover Band" })), false);
  igual("en vivo rechazado", fuerza("La Bachata", "Manuel Turizo", t("a", { title: "La Bachata (Live)", artist: "Manuel Turizo" })), false);
  igual("acústico rechazado", fuerza("Skyfall", "Adele", t("a", { title: "Skyfall (Acoustic)", artist: "Adele" })), false);
  igual("otro título rechazado", fuerza("Skyfall", "Adele", t("a", { title: "Rolling in the Deep", artist: "Adele" })), false);
  igual("mismo título, otro artista rechazado", fuerza("Skyfall", "Adele", t("a", { title: "Skyfall", artist: "Random Uploader" })), false);

  /* ── Marcador según el campo (matching_variante_test.go) ─────── */
  const query = "BbY WOW";
  const artista = "KAROL G, Judeline & rusowsky";
  igual("corte real", m.isNonOriginalTrack(t("a", { title: "BbY WOW", artist: "KAROL G", album: "NO ME ARREPIENTO DE SENTIR TANTO" }), query, artista), false);
  igual("marcador en título", m.isNonOriginalTrack(t("a", { title: "BbY WOW (Remix)", artist: "Alguien" }), query, artista), true);
  igual("marcador en artista", m.isNonOriginalTrack(t("a", { title: "BbY WOW", artist: "Slowed Sounds" }), query, artista), true);
  igual("marcador en orquesta", m.isNonOriginalTrack(t("a", { title: "BbY WOW", artist: "Epic Symphonic Orchestra" }), query, artista), true);
  igual("marcador en álbum", m.isNonOriginalTrack(t("a", { title: "BbY WOW", artist: "KAROL G", album: "Live at Wembley" }), query, artista), true);
  igual("la banda Live no se castiga", m.isNonOriginalTrack(t("a", { title: "Overcome", artist: "Live" }), "Overcome", "Live"), false);

  /* ── Álbum (matching_album_test.go) ──────────────────────────── */
  igual("album exacto", m.albumScore("Un Verano Sin Ti", "Un Verano Sin Ti"), 3);
  igual("album deluxe", m.albumScore("Un Verano Sin Ti", "Un Verano Sin Ti (Deluxe)"), 2);
  igual("album ajeno", m.albumScore("Un Verano Sin Ti", "Grandes Exitos"), 0);
  igual("album vacío", m.albumScore("Un Verano Sin Ti", ""), 0);
  igual("album pedido vacío", m.albumScore("", "Un Verano Sin Ti"), 0);

  const disco = [
    t("recopilatorio", { title: "NUEVAYoL", artist: "Bad Bunny", album: "Grandes Exitos 2025" }),
    t("remix-album", { title: "NUEVAYoL", artist: "Bad Bunny", album: "NUEVAYoL (Remixes)" }),
    t("original", { title: "NUEVAYoL", artist: "Bad Bunny", album: "Un Verano Sin Ti" }),
  ];
  igual("prefiere el disco pedido", m.bestOriginalAlbumDuracion("NUEVAYoL", "Bad Bunny", "Un Verano Sin Ti", 0, disco)?.id, "original");
  igual("el álbum no descarta", m.rankOriginalCandidatesAlbum("NUEVAYoL", "Bad Bunny", "Un Verano Sin Ti", 0, disco).length, 3);
  igual("sin álbum no se descarta", m.bestOriginalAlbumDuracion("La Bachata", "Manuel Turizo", "La Bachata", 0, [t("resubido", { title: "La Bachata", artist: "Manuel Turizo" })])?.id, "resubido");

  const albumNoPromueve = [
    t("exacto-otro-disco", { title: "La Bachata", artist: "Manuel Turizo", album: "Otro Disco" }),
    t("debil-mismo-disco", { title: "La Bachata Karaoke Version", artist: "Manuel Turizo", album: "La Bachata" }),
  ];
  igual("el álbum no promueve a uno peor", m.bestOriginalAlbumDuracion("La Bachata", "Manuel Turizo", "La Bachata", 0, albumNoPromueve)?.id, "exacto-otro-disco");

  /* ── Duración (matching_test.go) ────────────────────────────── */
  const duraciones = [
    t("larga", { title: "La Bachata", artist: "Manuel Turizo", durationMs: 300_000 }),
    t("buena", { title: "La Bachata", artist: "Manuel Turizo", durationMs: 200_000 }),
    t("corta", { title: "La Bachata", artist: "Manuel Turizo", durationMs: 60_000 }),
  ];
  igual("desempata por duración", m.bestOriginalDuracion("La Bachata", "Manuel Turizo", 201_000, duraciones)?.id, "buena");
  igual("un candidato sin duración no se descarta", m.bestOriginalDuracion("Dai Dai", "Shakira", 190_000, [t("sin-dur", { title: "Shakira - DAI DAI", artist: "minecraftdiablo" })])?.id, "sin-dur");
  igual("la duración no promueve a uno peor", m.bestOriginalDuracion("La Bachata", "Manuel Turizo", 200_000, [
    t("exacto", { title: "La Bachata", artist: "Manuel Turizo", durationMs: 300_000 }),
    t("parecido", { title: "La Bachata (Cover)", artist: "Manuel Turizo", durationMs: 200_000 }),
  ])?.id, "exacto");

  /* ── Estricto (matching_estricto_test.go) ───────────────────── */
  const quenchoso = [
    t("1", { title: "Quenchoso", artist: "El Mago Reggaeton", durationMs: 200_000 }),
    t("2", { title: "Quenchoso", artist: "Otro Artista Cualquiera", durationMs: 210_000 }),
  ];
  igual("BestOriginal no sirve el homónimo", m.bestOriginal("Quenchoso", "Las Ovejas Negras de Tupiza", quenchoso), null);
  igual("BestOriginalDuracion no sirve el homónimo", m.bestOriginalDuracion("Quenchoso", "Las Ovejas Negras de Tupiza", 275_867, quenchoso), null);
  igual("BestOriginalAlbumDuracion no sirve el homónimo", m.bestOriginalAlbumDuracion("Quenchoso", "Las Ovejas Negras de Tupiza", "Revolución Mental", 275_867, quenchoso), null);
  igual("el listado no se vacía", m.rankOriginalCandidates("Quenchoso", "Las Ovejas Negras de Tupiza", quenchoso).length, 2);
  igual("artista con variante se resuelve", m.bestOriginal("Quenchoso", "Las Ovejas Negras de Tupiza", [t("ok", { title: "Quenchoso", artist: "Ovejas Negras de Tupiza", durationMs: 275_000 })])?.id, "ok");
  igual("re-subido con artista en el título se resuelve", m.bestOriginal("Quenchoso", "Las Ovejas Negras de Tupiza", [t("sub", { title: "Las Ovejas Negras de Tupiza - Quenchoso", artist: "Random Uploader" })])?.id, "sub");
  igual("sin artista el orden no cambia", m.rankOriginalCandidatesEstricto("Quenchoso", "", [
    t("a", { title: "Quenchoso", artist: "Quien Sea" }),
    t("b", { title: "Quenchoso (En Vivo)", artist: "Otro" }),
  ]).map((x) => x.id), ["a"]);

  const fixtureDeezer = [
    t("ok", { title: "Quenchoso", artist: "Ovejas Negras de Tupiza" }),
    t("n1", { title: "Qué Dichoso Es", artist: "La Sonora Matancera" }),
    t("n2", { title: "Quench", artist: "Otto Diva" }),
    t("n3", { title: "Quenacho's Song", artist: "Wuauquikuna" }),
    t("n4", { title: "Que Chévere Esse", artist: "Ary Lobo" }),
    t("n5", { title: "Quench Your Thirst with Christian Souls", artist: "Suicidal Angels" }),
    t("n6", { title: "Ca cache quekchose", artist: "Alain Bashung" }),
    t("n7", { title: "Piedra, como tú", artist: "Dúo Janet y Quincoso" }),
    t("n8", { title: "Quekchose à boire", artist: "Polo et les méchants moinés" }),
    t("n9", { title: "Viniste a los quinchos tiraste unos tiros", artist: "Hinchadas Argentinas" }),
  ];
  igual("ruido de búsqueda difusa descartado", m.bestOriginalAlbumDuracion("Quenchoso", "Las Ovejas Negras de Tupiza", "Revolución Mental", 275_867, fixtureDeezer)?.id, "ok");
  igual("karaoke pedido por título se resuelve", m.bestOriginal("Quenchoso (Karaoke Version)", "Karaoke Hits", [t("k1", { title: "Quenchoso (Karaoke Version)", artist: "Karaoke Hits" })])?.id, "k1");
  igual("karaoke pedido por álbum se resuelve", m.bestOriginalAlbumDuracion("Quenchoso (Karaoke)", "Quien Sea", "Karaoke Version", 0, [t("k2", { title: "Quenchoso", artist: "Quien Sea", album: "Karaoke Version" })])?.id, "k2");
  igual("karaoke no se sirve si se pidió el original", m.bestOriginal("Quenchoso", "Las Ovejas Negras de Tupiza", [t("k3", { title: "Quenchoso (Karaoke Version)", artist: "Karaoke Hits" })]), null);

  /* ── ISRC (matching_isrc_autoridad_test.go) ─────────────────── */
  igual(
    "autoritativos",
    ["deezer", "deezer-web", "qobuz", "qobuz-web", "tidal", "tidal-web", "amazon", "apple-music", "flac-rescue", "musicbrainz"].map((n) => m.esProveedorAutoritativoISRC(n)),
    Array(10).fill(true),
  );
  igual(
    "no autoritativos",
    ["youtube", "ytmusic-spotiflac", "soundcloud", ""].map((n) => m.esProveedorAutoritativoISRC(n)),
    Array(4).fill(false),
  );
  igual("esCandidatoPorISRC por índice", m.esCandidatoPorISRC("USRC17607839", t("x", { title: "USRC17607839", isrc: "USRC17607839" })), true);
  igual("esCandidatoPorISRC con título real", m.esCandidatoPorISRC("USRC17607839", t("x", { title: "Mi Cancion", isrc: "USRC17607839" })), false);
  igual("preferirISRC adelanta sin descartar", m.preferirISRC("USRC17607839", [t("a", {}), t("b", { isrc: "OTRO0000001" }), t("c", { isrc: "USRC17607839" })]).map((x) => x.id), ["c", "a", "b"]);
  igual("preferirISRC sin match no reordena", m.preferirISRC("XXXX0000000", [t("a", {}), t("b", {}), t("c", {})]).map((x) => x.id), ["a", "b", "c"]);

  /* ── Consulta partida y listado ─────────────────────────────── */
  igual("split artist - title", m.splitSearchQuery("Daft Punk - One More Time"), { title: "One More Time", artist: "Daft Punk" });
  igual("split title by artist", m.splitSearchQuery("One More Time by Daft Punk"), { title: "One More Time", artist: "Daft Punk" });
  igual("split feat", m.splitSearchQuery("Suave feat Tokischa"), { title: "Suave", artist: "Tokischa" });
  igual("split sin separador", m.splitSearchQuery("jazz"), { title: "jazz", artist: "" });

  const listado = [
    { tipo: "album", titulo: "Discovery", artista: "Daft Punk", album: "", isrc: null },
    { tipo: "track", titulo: "One More Time", artista: "Daft Punk", album: "Discovery", isrc: null },
    { tipo: "track", titulo: "One More Time (Live)", artista: "Daft Punk", album: "Alive 2007", isrc: null },
    { tipo: "track", titulo: "Bohemian Rhapsody", artista: "Queen", album: "", isrc: null },
  ];
  igual(
    "listado: no-tracks primero y variante fuera",
    m.filtrarOriginales(listado, "One More Time", "Daft Punk").map((i) => i.titulo),
    ["Discovery", "One More Time"],
  );

  console.log(`\n${pruebas - fallos}/${pruebas} aserciones OK${fallos ? ` · ${fallos} FALLARON` : ""}`);
  process.exit(fallos ? 1 : 0);
} finally {
  try {
    rmSync(salida, { force: true });
  } catch {
    // En Windows el archivo puede quedar momentáneamente ocupado.
  }
}
