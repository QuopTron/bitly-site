#!/usr/bin/env node
/**
 * Copia la APP de verdad (el bundle `flutter build web` de Bitly) dentro del
 * sitio, en `public/app/`, para que instalarla desde el sitio instale Bitly.
 *
 * Por qué: hasta ahora, quien entraba a bitly-site.pages.dev desde un iPhone o
 * una Mac e instalaba la "app" terminaba instalando el SITIO —la web del
 * proyecto, que ni busca ni descarga—. La app real es el mismo código compilado
 * para el navegador (`build/web` del repo `bitly`), y su PWA ya se publica en
 * GitHub Pages; el dueño pidió que además salga del sitio, con su propia
 * identidad (`id: bitly-app`, nombre corto «Bitly»), distinta de la PWA del
 * sitio (`Bitly Sitio`).
 *
 * Cómo se sirve: `public/app/` viaja al deploy como cualquier estático, así que
 * queda en `https://bitly-site.pages.dev/app/`. Esa página es OTRA app: tiene su
 * propio service worker (alcance `/app/`) y su propio manifiesto, así que las
 * dos PWA conviven sin pisarse.
 *
 * De dónde sale el bundle, en orden:
 *  1. `BITLY_APP_WEB` (una ruta a un `build/web` ya compilado).
 *  2. `../bitly/build/web` (el build local, el que usa el dueño).
 *  3. El repo PÚBLICO de releases, rama `gh-pages` (la que publica
 *     `deploy-pwa.yml`). Es la única que existe en la CI de Cloudflare Pages,
 *     donde no hay repo de la app: sin este paso el deploy salía sin `/app`,
 *     `/app/` respondía 404 y el enlace «Abrir la app (PWA)» de la sección de
 *     instalación llevaba a la página de «no encontrada».
 *
 * Qué arregla de la copia:
 *   · `<base href>`: el bundle trae la base con la que se compiló (por defecto
 *     `/bitly-releases/` para GitHub Pages). Servido en `/app/` hay que
 *     reescribirla, o el bundle pide los assets al lugar equivocado.
 *   · El manifiesto ya viene con `start_url`/`scope` relativos ("."), así que
 *     bajo `/app/` abre y queda limitado ahí solo.
 *
 * El build NO se versiona (`public/app/` está en .gitignore): se copia antes de
 * compilar el sitio. Si no hay ni build ni red, el script avisa y sale con 0
 * para no romper el build del sitio (que tiene que poder publicarse sin la app).
 *
 * Uso:
 *   node scripts/copiar-app-web.mjs
 *   BITLY_APP_WEB=/ruta/al/build/web node scripts/copiar-app-web.mjs
 *   BITLY_APP_PWA_URL=https://codeload.github.com/.../tar.gz/refs/heads/gh-pages \
 *     node scripts/copiar-app-web.mjs
 *
 * Para regenerar el bundle (en el repo de la app):
 *   flutter build web --base-href=/app/
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(raiz, "public", "app");
/** La base con la que se sirve la app dentro del sitio. */
const BASE = "/app/";
/**
 * El bundle PÚBLICO de la PWA (rama `gh-pages` del repo de releases, el mismo
 * que leen la app y el sitio). Es un tar.gz del codeload de GitHub: sin token,
 * sin API y sin límite de consultas.
 */
const URL_PWA =
  process.env.BITLY_APP_PWA_URL ||
  "https://codeload.github.com/QuopTron/bitly-releases/tar.gz/refs/heads/gh-pages";

function saltear(motivo) {
  console.log(`[app-web] salteado: ${motivo}`);
  console.log(`[app-web] el sitio se compila igual, sin /app (la PWA del sitio no se toca).`);
  // 0 a propósito: el sitio tiene que poder compilarse y publicarse sin el
  // build de la app (CI, otra máquina, un deploy urgente del sitio solo).
  process.exit(0);
}

/* ── El bundle ──────────────────────────────────────────────────────────── */

/** Un `build/web` de Flutter: index.html y su bootstrap. */
function esBundleFlutter(carpeta) {
  return (
    fs.existsSync(path.join(carpeta, "index.html")) &&
    fs.existsSync(path.join(carpeta, "flutter_bootstrap.js"))
  );
}

/** Nombre del archivo tar (campo de 100 bytes + prefijo opcional). */
function campoTexto(cabecera, desde, largo) {
  const crudo = cabecera.subarray(desde, desde + largo);
  const fin = crudo.indexOf(0);
  return crudo.subarray(0, fin < 0 ? crudo.length : fin).toString("utf8").trim();
}

/**
 * Extrae un `.tar.gz` en [carpeta] sin dependencias externas.
 *
 * Por qué a mano: el build de Pages corre en Linux pero el dueño compila en
 * Windows, y no hay `unzip`/`tar` garantizados en las dos puntas. `zlib` sí
 * viene con Node, y un tar son bloques de 512 bytes: menos código que sumar una
 * dependencia para leer un único archivo.
 *
 * Sólo interesan los archivos regulares y los directorios; las entradas de
 * metadatos (pax, gnu) se saltan solas al avanzar por tamaño.
 */
function extraerTarGz(comprimido, carpeta) {
  const tar = zlib.gunzipSync(comprimido);
  const base = path.resolve(carpeta);
  let prefijo = "";
  let archivos = 0;

  for (let offset = 0; offset + 512 <= tar.length; ) {
    const cabecera = tar.subarray(offset, offset + 512);
    const nombre = campoTexto(cabecera, 0, 100);
    const prefijoUstar = campoTexto(cabecera, 345, 155);
    const tamano = parseInt(campoTexto(cabecera, 124, 12) || "0", 8) || 0;
    const tipo = String.fromCharCode(cabecera[156] || 48);
    const datos = tar.subarray(offset + 512, offset + 512 + tamano);
    offset += 512 + Math.ceil(tamano / 512) * 512;
    if (nombre === "") break; // fin del archivo
    if (tipo === "x" || tipo === "g" || tipo === "L" || tipo === "K") continue; // metadatos

    const completo = prefijoUstar ? `${prefijoUstar}/${nombre}` : nombre;
    if (prefijo === "" && completo.includes("/")) {
      prefijo = completo.slice(0, completo.indexOf("/") + 1); // "bitly-releases-gh-pages/"
    }
    const relativo = prefijo && completo.startsWith(prefijo) ? completo.slice(prefijo.length) : completo;
    if (!relativo || relativo.startsWith(".")) continue;

    const salida = path.resolve(carpeta, relativo);
    // Sin rutas que se escapen de la carpeta de destino.
    if (salida !== base && !salida.startsWith(base + path.sep)) continue;

    if (tipo === "5") {
      fs.mkdirSync(salida, { recursive: true });
      continue;
    }
    if (tipo !== "0" && tipo !== "\0") continue; // enlaces, dispositivos, etc.
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    fs.writeFileSync(salida, datos);
    archivos++;
  }
  return archivos;
}

/** Baja la PWA pública y la descomprime en una carpeta temporal. */
async function bajarPwa() {
  console.log(`[app-web] no hay build local: bajo la PWA pública de ${URL_PWA}`);
  const respuesta = await fetch(URL_PWA, { redirect: "follow" });
  if (!respuesta.ok) throw new Error(`la descarga respondió HTTP ${respuesta.status}`);
  const comprimido = Buffer.from(await respuesta.arrayBuffer());
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "bitly-app-web-"));
  const archivos = extraerTarGz(comprimido, temporal);
  if (archivos === 0) throw new Error("el paquete bajado no tenía archivos");
  return { carpeta: temporal, archivos, megas: (comprimido.length / 1024 / 1024).toFixed(1) };
}

/* ── Elegir el origen ───────────────────────────────────────────────────── */

let origen = process.env.BITLY_APP_WEB || path.join(raiz, "..", "bitly", "build", "web");
let temporal = null;

if (!esBundleFlutter(origen)) {
  const local = origen;
  try {
    const baja = await bajarPwa();
    origen = baja.carpeta;
    temporal = baja.carpeta;
    console.log(`[app-web] paquete bajado: ${baja.archivos} archivos, ${baja.megas} MB comprimidos`);
  } catch (e) {
    saltear(`no hay build de la app en ${local} y la descarga falló (${e.message})`);
  }
} else {
  console.log(`[app-web] uso el build local de ${origen}`);
}

/* ── Copia ──────────────────────────────────────────────────────────────── */

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.cpSync(origen, destino, { recursive: true });
if (temporal) fs.rmSync(temporal, { recursive: true, force: true });

/* ── La base del bundle: /app/ ──────────────────────────────────────────── */

const rutaIndex = path.join(destino, "index.html");
let html = fs.readFileSync(rutaIndex, "utf8");
const conBase = html.replace(/(<base\s+href=")[^"]*(")/i, `$1${BASE}$2`);
if (conBase === html && !/<base\s+href=/i.test(html)) {
  // Un build sin `<base>` resuelve los assets contra la URL de la página, que ya
  // es /app/: se le pone igual para que no dependa de cómo lo llamaron.
  html = html.replace(/<head>/i, `<head>\n    <base href="${BASE}" />`);
} else {
  html = conBase;
}
fs.writeFileSync(rutaIndex, html);

/* ── El manifiesto tiene que quedar apuntando a /app/ ───────────────────── */

const rutaManifiesto = path.join(destino, "manifest.json");
if (fs.existsSync(rutaManifiesto)) {
  const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, "utf8"));
  // Relativos: se resuelven contra la URL del manifiesto (/app/manifest.json).
  manifiesto.id = manifiesto.id || "bitly-app";
  manifiesto.start_url = ".";
  manifiesto.scope = ".";
  fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2) + "\n");
}

/* ── Reporte ────────────────────────────────────────────────────────────── */

function pesar(carpeta) {
  let total = 0;
  let archivos = 0;
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const completo = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      const dentro = pesar(completo);
      total += dentro.bytes;
      archivos += dentro.archivos;
    } else {
      total += fs.statSync(completo).size;
      archivos++;
    }
  }
  return { bytes: total, archivos };
}

const { bytes, archivos } = pesar(destino);
const megas = (bytes / 1024 / 1024).toFixed(1);
console.log(`[app-web] la app real quedó en /app/ · ${archivos} archivos, ${megas} MB`);
console.log(`[app-web] base del bundle: ${BASE} · manifiesto id "bitly-app" (PWA propia)`);
console.log(`[app-web] el manifiesto del sitio apunta a /app/ (instalar desde el sitio instala Bitly)`);
