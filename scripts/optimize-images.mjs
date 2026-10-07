#!/usr/bin/env node
/**
 * Genera todas las derivadas de imagen del sitio a partir de UNA fuente:
 * `src/assets/bitly-logo.png` (1024x1024, 722 KB).
 *
 *   pnpm imagenes
 *
 * Salidas:
 *   src/assets/bitly-logo-{96,320,640}.webp → variantes para srcset
 *   public/favicon-{16,32}.png      → favicons (van dentro del .ico)
 *   public/favicon.ico              → .ico con las dos anteriores embebidas
 *   public/apple-touch-icon.png     → 180x180 opaco (iOS lo tapa con negro si lleva alfa)
 *   public/android-chrome-{192,512}.png → iconos para manifest/PWA
 *   public/og-image.png             → 1200x630 para compartir en WhatsApp/Telegram/X
 *
 * El .ico se escribe a mano: no hay librería de cabecera que lo haga, y el
 * formato es mínimo (directorio + PNGs sin comprimir).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = path.join(raiz, "src", "assets", "bitly-logo.png");
const PUBLIC = path.join(raiz, "public");
const ASSETS = path.join(raiz, "src", "assets");

const FONDO = { r: 0, g: 31, b: 42, alpha: 1 }; // --background del tema oscuro

/** PNG cuadrado de `tamaño` con el logo centrado y fondo de marca. */
async function cuadrado(tamaño) {
  const logo = await sharp(FUENTE)
    .resize(tamaño, tamaño, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: tamaño, height: tamaño, channels: 4, background: FONDO },
  })
    .composite([{ input: logo }])
    .png()
    .toBuffer();
}

/** Tarjeta 1200x630: fondo de marca + halo + logo. */
async function ogImage() {
  const ancho = 1200;
  const alto = 630;
  const logo = await sharp(FUENTE)
    .resize(360, 360, { fit: "contain" })
    .png()
    .toBuffer();

  const fondo = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#001f2a"/>
          <stop offset="55%" stop-color="#06323c"/>
          <stop offset="100%" stop-color="#0b4a4a"/>
        </linearGradient>
        <radialGradient id="h" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stop-color="#4ee8ab" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#4ee8ab" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${ancho}" height="${alto}" fill="url(#g)"/>
      <circle cx="380" cy="315" r="330" fill="url(#h)"/>
    </svg>`);

  const texto = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">
      <text x="640" y="330" font-family="Inter, Segoe UI, system-ui, sans-serif"
            font-size="96" font-weight="800" fill="#eafff6" text-anchor="middle">Bitly</text>
      <text x="640" y="410" font-family="Inter, Segoe UI, system-ui, sans-serif"
            font-size="42" font-weight="500" fill="#9fe7cd" text-anchor="middle">Tu música, sin límites</text>
      <text x="640" y="472" font-family="Inter, Segoe UI, system-ui, sans-serif"
            font-size="30" font-weight="400" fill="#8fb7b5" text-anchor="middle">Descarga música FLAC sin pérdida</text>
    </svg>`);

  return sharp(fondo)
    .composite([
      { input: logo, left: 80, top: 135 },
      { input: texto, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** .ico mínimo: directorio + PNGs embebidas (válido desde Windows Vista). */
function escribirIco(rutas) {
  const piezas = rutas.map((r) => {
    const data = fs.readFileSync(r);
    const meta = sharp(data).metadata();
    return { data, ancho: meta.width >= 256 ? 0 : meta.width, alto: meta.height >= 256 ? 0 : meta.height };
  });

  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(piezas.length, 4);

  const entradas = [];
  const datos = [];
  let offset = 6 + piezas.length * 16;

  for (const p of piezas) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.ancho, 0);
    e.writeUInt8(p.alto, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entradas.push(e);
    datos.push(p.data);
    offset += p.data.length;
  }

  fs.writeFileSync(path.join(PUBLIC, "favicon.ico"), Buffer.concat([cabecera, ...entradas, ...datos]));
}

async function main() {
  if (!fs.existsSync(FUENTE)) {
    console.error(`[imagenes] Falta la fuente: ${FUENTE}`);
    process.exit(1);
  }

  // 1. Logo de la interfaz, en tres anchos para el `srcset`: el hero pide
  //    200 px en celular (350 px con la densidad que usa Lighthouse) y 300 px en
  //    desktop; el encabezado, 40 px. Sin variantes, el navegador bajaba las
  //    640 siempre y "properly size images" marcaba 17 KB de más.
  for (const ancho of [640, 320, 96]) {
    const buf = await sharp(FUENTE)
      .resize(ancho, ancho, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toBuffer();
    fs.writeFileSync(path.join(ASSETS, `bitly-logo-${ancho}.webp`), buf);
  }

  // 2. Iconos.
  const t16 = await cuadrado(16);
  const t32 = await cuadrado(32);
  const t180 = await cuadrado(180);
  const t192 = await cuadrado(192);
  const t512 = await cuadrado(512);

  fs.writeFileSync(path.join(PUBLIC, "favicon-16x16.png"), t16);
  fs.writeFileSync(path.join(PUBLIC, "favicon-32x32.png"), t32);
  fs.writeFileSync(path.join(PUBLIC, "apple-touch-icon.png"), t180);
  fs.writeFileSync(path.join(PUBLIC, "android-chrome-192x192.png"), t192);
  fs.writeFileSync(path.join(PUBLIC, "android-chrome-512x512.png"), t512);

  const ruta16 = path.join(PUBLIC, "favicon-16x16.png");
  const ruta32 = path.join(PUBLIC, "favicon-32x32.png");
  escribirIco([ruta16, ruta32]);

  // 3. Tarjeta para compartir.
  fs.writeFileSync(path.join(PUBLIC, "og-image.png"), await ogImage());

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + " KB";
  for (const ancho of [640, 320, 96]) {
    console.log(`[imagenes] bitly-logo-${ancho}.webp ${kb(path.join(ASSETS, `bitly-logo-${ancho}.webp`))}`);
  }
  for (const f of [
    "favicon.ico",
    "favicon-16x16.png",
    "favicon-32x32.png",
    "apple-touch-icon.png",
    "android-chrome-192x192.png",
    "android-chrome-512x512.png",
    "og-image.png",
  ]) {
    console.log(`[imagenes] ${f} ${kb(path.join(PUBLIC, f))}`);
  }
}

main().catch((e) => {
  console.error("[imagenes] falló:", e);
  process.exit(1);
});
