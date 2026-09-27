/**
 * Reemplaza las capturas actuales por capturas reales de tu celular, tu PC o tu TV.
 *
 *   1. Copiá tus capturas en  capturas-reales/  (mirá `--lista` para los nombres)
 *   2. node scripts/capturas/reemplazar.mjs          … o  pnpm capturas:reales
 *
 * Acepta .png, .jpg, .jpeg y .webp. Escala al ancho del sitio, las pasa a WebP y
 * las guarda en src/assets/capturas/ con el mismo nombre que ya usa el código,
 * así que no hay que tocar nada más. Si falta un archivo, deja la captura actual
 * y lo informa al final.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, dormir, js, nuevaSesion } from "./lib/cdp.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const ENTRADA = path.join(RAIZ, "capturas-reales");
const SALIDA = path.join(RAIZ, "src/assets/capturas");
const PERFIL = path.join(RAIZ, ".capturas-perfil");
const PUERTO = Number(process.env.CDP_PORT ?? 9334);
const CALIDAD = Number(process.env.CAPTURA_CALIDAD ?? 92);
const EXTENSIONES = ["png", "jpg", "jpeg", "webp", "PNG", "JPG", "JPEG", "WEBP"];

/**
 * Cada hueco de la galería: qué hay que capturar y de qué forma.
 * `vertical` sólo se usa para avisar si el archivo parece de la pantalla equivocada.
 */
const HUECOS = [
  { nombre: "celular-1-sitio", vertical: true, que: "el sitio abierto en el celular, con los botones de descarga a la vista" },
  { nombre: "celular-2-descargas", vertical: true, que: "el modal con la lista de APK (tocando «Android»)" },
  { nombre: "celular-3-permisos", vertical: true, que: "Ajustes › Instalar apps desconocidas, activado para el navegador" },
  { nombre: "celular-4-playprotect", vertical: true, que: "el aviso de Play Protect «App no reconocida», con Instalar de todos modos" },
  { nombre: "celular-5-listo", vertical: true, que: "Bitly ya instalada (pantalla de inicio o app abierta)" },
  { nombre: "pc-1-sitio", vertical: false, que: "el sitio abierto en la PC", anchoMax: 2560 },
  { nombre: "pc-2-descargas", vertical: false, que: "el modal de Windows con los archivos .exe", anchoMax: 2000 },
  { nombre: "pc-3-smartscreen", vertical: false, que: "el aviso de SmartScreen, con «Ejecutar de todas formas»", anchoMax: 2000 },
  { nombre: "tv-1-downloader", vertical: false, que: "la pantalla de Downloader en la TV con el código escrito", anchoMax: 2560 },
  { nombre: "ios-1-compartir", vertical: true, que: "compartir el Bitly.ipa y elegir TrollStore" },
  { nombre: "ios-2-confiar", vertical: true, que: "Ajustes › VPN y gestión de dispositivos, con el perfil confiado" },
  { nombre: "ios-3-inicio", vertical: true, que: "Bitly en la pantalla de inicio del iPhone" },
  { nombre: "mac-1-dmg", vertical: false, que: "la ventana del .dmg con Bitly y la carpeta Aplicaciones", anchoMax: 2000 },
  { nombre: "mac-2-gatekeeper", vertical: false, que: "el aviso de Gatekeeper con «Abrir igualmente»", anchoMax: 2000 },
  { nombre: "mac-3-terminal", vertical: false, que: "la Terminal con el comando de cuarentena", anchoMax: 2000 },
];

const ANCHO_CELULAR = 1170; // 3x de las 390 px que ocupa en el celular

const listar = () => {
  console.log(`\nCapturas reales → ${path.relative(RAIZ, ENTRADA)}/  (nombre + extensión)\n`);
  for (const h of HUECOS) {
    const ancho = h.anchoMax ?? ANCHO_CELULAR;
    const forma = h.vertical ? "vertical" : "horizontal";
    console.log(`  ${h.nombre.padEnd(20)} ${forma.padEnd(11)} ${String(ancho).padStart(4)} px de ancho máx`);
    console.log(`  ${" ".repeat(20)} ↳ ${h.que}`);
  }
  console.log(`\nDespués: node scripts/capturas/reemplazar.mjs\n`);
};

/** Busca el archivo real de un hueco, con cualquiera de las extensiones aceptadas. */
function buscar(nombre) {
  for (const ext of EXTENSIONES) {
    const ruta = path.join(ENTRADA, `${nombre}.${ext}`);
    if (fs.existsSync(ruta)) return ruta;
  }
  return null;
}

/** Reencuadra, escala y convierte a WebP dentro del navegador. */
async function convertir(ses, ruta, { anchoMax }) {
  const ext = path.extname(ruta).toLowerCase();
  const tipo = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const datos = `data:${tipo};base64,${fs.readFileSync(ruta).toString("base64")}`;

  const bruto = await js(
    ses,
    `(async () => {
      const img = new Image();
      await new Promise((listo, malo) => {
        img.onload = listo;
        img.onerror = () => malo(new Error("no se pudo leer la imagen"));
        img.src = ${JSON.stringify(datos)};
      });
      const k = Math.min(1, ${anchoMax} / img.naturalWidth);
      const ancho = Math.max(1, Math.round(img.naturalWidth * k));
      const alto = Math.max(1, Math.round(img.naturalHeight * k));
      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
      const g = lienzo.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, ancho, alto);
      const blob = await new Promise((r) => lienzo.toBlob(r, "image/webp", ${CALIDAD}));
      if (!blob) throw new Error("el navegador no pudo generar el WebP");
      const url = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
      return JSON.stringify({
        ancho, alto,
        origen: [img.naturalWidth, img.naturalHeight],
        base64: url.slice(url.indexOf(",") + 1),
      });
    })()`,
  );

  const { ancho, alto, origen, base64 } = JSON.parse(bruto);
  const destino = path.join(SALIDA, path.basename(ruta, path.extname(ruta)) + ".webp");
  fs.writeFileSync(destino, Buffer.from(base64, "base64"));

  const avisos = [];
  const vertical = alto >= ancho;
  const esperadaVertical = HUECOS.find((h) => h.nombre === path.basename(ruta, path.extname(ruta)))?.vertical;
  if (esperadaVertical !== undefined && vertical !== esperadaVertical)
    avisos.push(`ojo: parece ${vertical ? "vertical" : "horizontal"} y este hueco espera una captura ${esperadaVertical ? "vertical" : "horizontal"}`);
  if (origen[0] < anchoMax * 0.6) avisos.push(`resolución baja (${origen[0]} px de ancho): puede verse borrosa al ampliarla`);

  return { destino, ancho, alto, origen, kb: Math.round(fs.statSync(destino).size / 1024), avisos };
}

async function main() {
  if (process.argv.includes("--lista") || process.argv.includes("-l")) return listar();

  fs.mkdirSync(ENTRADA, { recursive: true });
  fs.mkdirSync(SALIDA, { recursive: true });

  const pendientes = HUECOS.map((h) => ({ ...h, archivo: buscar(h.nombre) }));
  const encontrados = pendientes.filter((h) => h.archivo);
  if (encontrados.length === 0) {
    console.log(`\nNo hay capturas en ${path.relative(RAIZ, ENTRADA)}/ todavía.`);
    listar();
    console.log(`Copiá ahí tus capturas con esos nombres y volvé a correr este script.`);
    return;
  }

  console.log(`▸ Chrome …`);
  const chrome = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
  try {
    console.log(`▸ ${chrome.info.Browser}\n`);
    const ses = await nuevaSesion(chrome.browser);
    const faltan = [];
    const avisos = [];
    try {
      for (const h of pendientes) {
        if (!h.archivo) {
          faltan.push(h.nombre);
          continue;
        }
        const r = await convertir(ses, h.archivo, { anchoMax: h.anchoMax ?? ANCHO_CELULAR });
        console.log(
          `  ✔ ${h.nombre.padEnd(20)} ${r.origen[0]}×${r.origen[1]} → ${r.ancho}×${r.alto}  ${String(r.kb).padStart(4)} KB`,
        );
        r.avisos.forEach((a) => avisos.push(`${h.nombre}: ${a}`));
      }
    } finally {
      await ses.cerrar();
      await dormir(150);
    }

    console.log("");
    if (faltan.length) {
      console.log(`  · sin archivo en ${path.relative(RAIZ, ENTRADA)}/ (queda la captura actual):`);
      faltan.forEach((n) => console.log(`      ${n}`));
    }
    if (avisos.length) {
      console.log(`\n  ⚠ Revisá estas capturas:`);
      avisos.forEach((a) => console.log(`      ${a}`));
    }
    console.log(`\n✔ Listo. Reiniciá el servidor o corré \`pnpm build\` para ver los cambios.`);
  } finally {
    await chrome.cerrar();
  }
}

main().catch((e) => {
  console.error("\n✖ " + e.message);
  process.exit(1);
});
