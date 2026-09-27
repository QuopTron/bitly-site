/**
 * Genera las capturas de la guía de instalación de bitly-site.
 *
 *   node scripts/capturas/capturar.mjs                 # genera todas
 *   node scripts/capturas/capturar.mjs celular pc      # sólo algunos grupos
 *
 * Requiere Google Chrome instalado. Las capturas salen de:
 *   - el sitio en vivo (https://bitly-site.pages.dev), recortadas al elemento exacto
 *   - pantallas de sistema (Android/Windows) maquetadas en scripts/capturas/mock
 *
 * Salida: src/assets/capturas/*.webp
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONSOLA, abrirChrome, dormir, js, nuevaSesion } from "./lib/cdp.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const SALIDA = path.join(RAIZ, "src/assets/capturas");
const PERFIL = path.join(RAIZ, ".capturas-perfil");
const SITIO = process.env.SITIO_URL ?? "https://bitly-site.pages.dev";
const PUERTO = Number(process.env.CDP_PORT ?? 9333);
const CALIDAD = Number(process.env.CAPTURA_CALIDAD ?? 92);

/* Las utilidades de Chrome viven en ./lib/cdp.mjs, compartidas con reemplazar.mjs. */

async function ir(ses, url) {
  await ses.ev("Page.navigate", { url });
  await esperarPor(ses, "document.readyState === 'complete'", { tiempo: 30000, nombre: "carga" });
  await esperarPor(ses, "!!document.body && document.body.scrollHeight > 0", { tiempo: 30000, nombre: "render" });
  await js(ses, "document.fonts ? document.fonts.ready.then(() => true) : true");
}

async function esperarPor(ses, expresion, { tiempo = 15000, nombre = expresion, cada = 120 } = {}) {
  const limite = Date.now() + tiempo;
  while (Date.now() < limite) {
    try {
      if (await js(ses, `!!(${expresion})`)) return true;
    } catch {}
    await dormir(cada);
  }
  throw new Error(`Timeout esperando: ${nombre}${await diagnostico(ses)}`);
}

/** Resumen del estado de la página para explicar los fallos. */
async function diagnostico(ses) {
  let pista = "";
  try {
    const estado = await js(
      ses,
      `JSON.stringify({
        url: location.href,
        texto: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 160),
        spinner: !!document.querySelector('.animate-spin'),
        seccion: !!document.querySelector('#instalar'),
        stub: String(window.fetch).includes('app_info'),
        pedidos: (window.__pedidos || []).slice(-5),
        errores: (window.__errores || []).slice(0, 4),
      })`,
    );
    pista = `\n    ↳ ${estado}`;
    if (CONSOLA.length) pista += `\n    ↳ consola: ${CONSOLA.slice(-5).join(" | ")}`;
  } catch {}
  return pista;
}

/** Espera a que una animación se asiente y toma la captura. */
async function capturar(ses, archivo, clip) {
  const destino = path.join(SALIDA, archivo);
  const params = { format: "webp", quality: CALIDAD, fromSurface: true, captureBeyondViewport: !!clip?.masAlla };
  if (clip) {
    params.clip = {
      x: redondear(clip.x),
      y: redondear(clip.y),
      width: redondear(clip.width),
      height: redondear(clip.height),
      scale: 1,
    };
  }
  const { data } = await ses.ev("Page.captureScreenshot", params);
  fs.writeFileSync(destino, Buffer.from(data, "base64"));
  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`  ✔ ${archivo.padEnd(28)} ${Math.round(clip?.width ?? 0)}×${Math.round(clip?.height ?? 0)}  ${kb} KB`);
  if (clip && (clip.width < 80 || clip.height < 80)) throw new Error(`Recorte sospechosamente chico en ${archivo}`);
  return destino;
}

const redondear = (n) => Math.round(n * 100) / 100;

/**
 * Revisa que la captura no haya salido en blanco/negro: analiza los píxeles
 * en un canvas y devuelve tamaño, luminancia media, desvío y variedad de color.
 */
async function analizar(browser, archivo) {
  const ses = await nuevaSesion(browser, { w: 240, h: 240, dpr: 1 });
  try {
    const datos = "data:image/webp;base64," + fs.readFileSync(path.join(SALIDA, archivo)).toString("base64");
    const crudo = await js(
      ses,
      `(async () => {
        const img = new Image();
        await new Promise((ok, mal) => { img.onload = ok; img.onerror = () => mal(new Error('no se pudo cargar')); img.src = ${JSON.stringify(datos)}; });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0, suma = 0, suma2 = 0, oscuros = 0;
        const colores = new Set();
        for (let i = 0; i < d.length; i += 4 * 5) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          suma += l; suma2 += l * l; n++;
          if (l < 18) oscuros++;
          colores.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
        }
        const media = suma / n;
        return JSON.stringify({
          w: img.naturalWidth, h: img.naturalHeight,
          media: +media.toFixed(1),
          desvio: +Math.sqrt(Math.max(0, suma2 / n - media * media)).toFixed(1),
          negros: +(100 * oscuros / n).toFixed(1),
          colores: colores.size,
        });
      })()`,
    );
    return JSON.parse(crudo);
  } finally {
    await ses.cerrar();
  }
}

/** Rectángulo (en px CSS) de un selector, con padding y recortado al viewport. */
async function rectDe(ses, selector, { pad = 0, viewport, minimo = { w: 100, h: 100 } } = {}) {
  const bruto = await js(
    ses,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height });
    })()`,
  );
  if (!bruto) throw new Error(`No se encontró el selector: ${selector}`);
  const r = JSON.parse(bruto);
  if (r.w < minimo.w || r.h < minimo.h) throw new Error(`Elemento demasiado chico (${selector}): ${r.w}×${r.h}`);
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const ancho = Math.min(viewport.w - x, r.w + pad * 2);
  const alto = Math.min(viewport.h - y, r.h + pad * 2);
  return { x, y, width: ancho, height: alto };
}

/* ─────────────────────────── Tareas ─────────────────────────── */

// dpr 3 en celular/iPhone y dpr 2 en escritorio: las capturas se muestran a ~200 px
// de ancho, así que quedan nítidas en pantallas 3x (retina y gama alta).
const VISTA_CELU = { w: 390, h: 800, dpr: 3, movil: true };
const VISTA_CELU_ALTO = { w: 390, h: 844, dpr: 3, movil: true };
const VISTA_IOS = { w: 390, h: 844, dpr: 3, movil: true };
const VISTA_PC = { w: 1440, h: 860, dpr: 2 };
const VISTA_MAC = { w: 1440, h: 900, dpr: 2 };
const VISTA_TV = { w: 1600, h: 900, dpr: 2 };

const MOCK = (n) => pathToFileURL(path.join(AQUI, "mock", n)).href;

async function abrirModalDeDescarga(ses, boton, esperado) {
  await esperarPor(ses, "document.querySelector('#descargar')", { nombre: "botones de descarga" });
  await js(
    ses,
    `(() => { const b = [...document.querySelectorAll('#descargar button')]
        .find(x => (x.textContent || '').includes(${JSON.stringify(boton)}));
      if (!b) return false; b.click(); return true; })()`,
  );
  await esperarPor(ses, "document.querySelector('.fixed.inset-0.z-50')", { nombre: "modal abierto" });
  await esperarPor(ses, `document.body.innerText.includes(${JSON.stringify(esperado)})`, {
    nombre: `lista de archivos (${esperado})`,
    tiempo: 20000,
  });
  await dormir(600);
}

const TAREAS = {
  celular: [
    {
      archivo: "celular-1-sitio.webp",
      viewport: VISTA_CELU,
      async correr(ses) {
        await ir(ses, SITIO);
        await dormir(1200); // partículas + degradados
        // Si los botones de descarga quedan fuera de la pantalla, acompaña con el scroll
        // (igual que haría el usuario) y medí dónde quedaron.
        const notas = await js(
          ses,
          `(() => {
            const z = document.querySelector('#descargar');
            const antes = z.getBoundingClientRect();
            if (antes.bottom > window.innerHeight - 24 || antes.top < 0)
              z.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = z.getBoundingClientRect();
            return JSON.stringify({
              alto: window.innerHeight,
              scrollY: Math.round(window.scrollY),
              botones: [Math.round(r.top), Math.round(r.bottom)],
            });
          })()`,
        );
        await dormir(700);
        const y = await js(ses, "window.scrollY");
        return { clip: { x: 0, y, width: VISTA_CELU.w, height: VISTA_CELU.h }, notas };
      },
    },
    {
      archivo: "celular-2-descargas.webp",
      viewport: VISTA_CELU_ALTO,
      async correr(ses) {
        await ir(ses, SITIO);
        await abrirModalDeDescarga(ses, "Android", ".apk");
        return { clip: await rectDe(ses, ".fixed.inset-0.z-50 > div", { pad: 18, viewport: VISTA_CELU_ALTO }) };
      },
    },
    {
      archivo: "celular-3-permisos.webp",
      viewport: VISTA_CELU_ALTO,
      async correr(ses) {
        await ir(ses, MOCK("android-permisos.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_CELU_ALTO.w, height: VISTA_CELU_ALTO.h } };
      },
    },
    {
      archivo: "celular-4-playprotect.webp",
      viewport: VISTA_CELU_ALTO,
      async correr(ses) {
        await ir(ses, MOCK("android-instalar.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_CELU_ALTO.w, height: VISTA_CELU_ALTO.h } };
      },
    },
    {
      archivo: "celular-5-listo.webp",
      viewport: VISTA_CELU_ALTO,
      async correr(ses) {
        await ir(ses, MOCK("android-listo.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_CELU_ALTO.w, height: VISTA_CELU_ALTO.h } };
      },
    },
  ],
  pc: [
    {
      archivo: "pc-1-sitio.webp",
      viewport: VISTA_PC,
      async correr(ses) {
        await ir(ses, SITIO);
        await dormir(1400);
        return { clip: await rectDe(ses, "main section", { pad: 0, viewport: VISTA_PC, minimo: { w: 800, h: 300 } }) };
      },
    },
    {
      archivo: "pc-2-descargas.webp",
      viewport: VISTA_PC,
      async correr(ses) {
        await ir(ses, SITIO);
        await abrirModalDeDescarga(ses, "Windows", ".exe");
        return { clip: await rectDe(ses, ".fixed.inset-0.z-50 > div", { pad: 24, viewport: VISTA_PC }) };
      },
    },
    {
      archivo: "pc-3-smartscreen.webp",
      viewport: VISTA_PC,
      async correr(ses) {
        await ir(ses, MOCK("windows-smartscreen.html"));
        await dormir(500);
        const clip = await rectDe(ses, "#ventana", { pad: 46, viewport: VISTA_PC, minimo: { w: 500, h: 300 } });
        return { clip: { ...clip, masAlla: true } };
      },
    },
  ],
  tv: [
    {
      archivo: "tv-1-downloader.webp",
      viewport: VISTA_TV,
      async correr(ses) {
        await ir(ses, MOCK("tv-downloader.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_TV.w, height: VISTA_TV.h } };
      },
    },
  ],
  ios: [
    {
      archivo: "ios-1-compartir.webp",
      viewport: VISTA_IOS,
      async correr(ses) {
        await ir(ses, MOCK("ios-compartir.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_IOS.w, height: VISTA_IOS.h } };
      },
    },
    {
      archivo: "ios-2-confiar.webp",
      viewport: VISTA_IOS,
      async correr(ses) {
        await ir(ses, MOCK("ios-confiar.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_IOS.w, height: VISTA_IOS.h } };
      },
    },
    {
      archivo: "ios-3-inicio.webp",
      viewport: VISTA_IOS,
      async correr(ses) {
        await ir(ses, MOCK("ios-inicio.html"));
        await dormir(500);
        return { clip: { x: 0, y: 0, width: VISTA_IOS.w, height: VISTA_IOS.h } };
      },
    },
  ],
  mac: [
    {
      archivo: "mac-1-dmg.webp",
      viewport: VISTA_MAC,
      async correr(ses) {
        await ir(ses, MOCK("mac-dmg.html"));
        await dormir(500);
        const clip = await rectDe(ses, "#ventana", { pad: 46, viewport: VISTA_MAC, minimo: { w: 500, h: 300 } });
        return { clip: { ...clip, masAlla: true } };
      },
    },
    {
      archivo: "mac-2-gatekeeper.webp",
      viewport: VISTA_MAC,
      async correr(ses) {
        await ir(ses, MOCK("mac-gatekeeper.html"));
        await dormir(600); // el cursor de la Terminal parpadea; acá sólo esperamos layout
        const clip = await rectDe(ses, "#bloque", { pad: 44, viewport: VISTA_MAC, minimo: { w: 400, h: 250 } });
        return { clip: { ...clip, masAlla: true } };
      },
    },
    {
      archivo: "mac-3-terminal.webp",
      viewport: VISTA_MAC,
      async correr(ses) {
        await ir(ses, MOCK("mac-terminal.html"));
        await dormir(500);
        const clip = await rectDe(ses, "#ventana", { pad: 44, viewport: VISTA_MAC, minimo: { w: 500, h: 150 } });
        return { clip: { ...clip, masAlla: true } };
      },
    },
  ],
};

/* ─────────── Revisión de la sección de instalación ─────────── */

/** Anchos típicos: celular chico, celular, tablet, laptop, escritorio. */
const ANCHOS_REVISION = (process.env.REVISION_ANCHOS ?? "320,390,430,768,1024,1440,1920").split(",").map(Number);

/**
 * Respuestas simuladas para poder medir la sección en local: el backend real
 * (Supabase) sólo acepta el origen del sitio publicado, así que si no responde
 * la app se queda en el spinner y no hay nada que revisar.
 */
/**
 * Opcional (`STUB_SIN_BACKEND=1`): simula las respuestas del backend. Antes de
 * usarlo, preferí arrancar el servidor con `VITE_SUPABASE_URL` apuntando a un
 * puerto cerrado: así la llamada falla al instante y la app se dibuja sola,
 * sin tocar el código ni desincronizar la hidratación.
 */
const SIN_BACKEND = `
  const original = window.fetch;
  // Con retardo: si responde en el mismo tick que la hidratación, el HTML del
  // servidor (el spinner) no coincide con el primer render y la página recarga.
  const json = (cuerpo) => new Promise((listo) => setTimeout(() => listo(new Response(JSON.stringify(cuerpo), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })), 500));
  window.__pedidos = [];
  window.fetch = function (entrada, opciones) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    window.__pedidos.push(url.split('?')[0].slice(-40));
    if (url.includes('app_info')) return json([{ name: 'Bitly', tagline: 'Tu música, sin límites', description: '', windows_url: null, android_url: null, version: '1.0.0' }]);
    if (url.includes('download_stats')) return json([]);
    if (url.includes('increment_download')) return json(null);
    return original.apply(this, arguments);
  };
`;

/**
 * El servidor de desarrollo recarga la página solo (HMR), así que una medición
 * puede caer justo en el recambio. Reintenta hasta obtener un estado estable.
 */
async function medir(ses, expresion, valida = () => true, intentos = 8) {
  let ultimo = null;
  let falla = null;
  for (let i = 0; i < intentos; i++) {
    try {
      const valor = JSON.parse(await js(ses, expresion));
      if (valida(valor)) return valor;
      ultimo = valor;
    } catch (e) {
      falla = e;
    }
    await dormir(600);
  }
  if (ultimo) throw new Error(`No se llegó a un estado estable: ${JSON.stringify(ultimo)}${await diagnostico(ses)}`);
  throw falla ?? new Error("No se pudo medir");
}

async function revisarSeccion(ses) {
  if (process.env.STUB_SIN_BACKEND === "1") {
    await ses.ev("Page.addScriptToEvaluateOnNewDocument", { source: SIN_BACKEND });
  }
  // El perfil de Chrome es persistente entre corridas: fija el idioma y la moneda
  // por defecto para que las medidas no dependan de la corrida anterior.
  await ses.ev("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem('bitly_currency', 'BOB'); localStorage.setItem('bitly_lang', 'es'); } catch {}`,
  });
  await ir(ses, SITIO);
  await esperarPor(ses, "document.querySelectorAll('#instalar [role=tab]').length === 5", {
    nombre: "sección #instalar con sus 5 pestañas",
    tiempo: 30000,
  });
  await dormir(600);

  const medidas = await medir(
    ses,
    `JSON.stringify({
        ventana: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        seccion: Math.round((document.querySelector('#instalar')?.getBoundingClientRect().width) || 0),
        alto: Math.round((document.querySelector('#instalar')?.getBoundingClientRect().height) || 0),
        pestanas: document.querySelectorAll('#instalar [role=tab]').length,
      })`,
    (m) => m.pestanas === 5 && m.seccion > 0,
  );
  if (medidas.scroll > medidas.ventana + 1) {
    const culpables = await js(
      ses,
      `JSON.stringify([...document.querySelectorAll('body *')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; })
        .slice(0, 6)
        .map(el => el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 3).join('.') + ' → ' + Math.round(el.getBoundingClientRect().right) + 'px'))`,
    );
    throw new Error(`Desborde horizontal: scroll ${medidas.scroll} > ${medidas.ventana}\n    ↳ ${culpables}`);
  }
  if (medidas.pestanas !== 5) {
    const html = await js(
      ses,
      `(document.querySelector('#instalar')?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 400)`,
    );
    throw new Error(`Se esperaban 5 pestañas, hay ${medidas.pestanas}\n    ↳ ${html}`);
  }

  // Recorre cada pestaña y cuenta las capturas + pasos que muestra.
  const detalle = [];
  const pestanas = medidas.pestanas;
  for (let i = 0; i < pestanas; i++) {
    await js(ses, `document.querySelectorAll('#instalar [role=tab]')[${i}].click()`);
    await dormir(500);
    // El primer recuadro se trae a la vista: así se dispara la carga diferida
    // y podemos comprobar que la captura se decodifica de verdad.
    const info = await medir(
      ses,
      `(() => {
          const panel = document.querySelector('#instalar [role=tabpanel]');
          const imagenes = [...panel.querySelectorAll('img')];
          imagenes[0]?.scrollIntoView({ block: 'center' });
          const r = panel.getBoundingClientRect();
          return JSON.stringify({
            alto: Math.round(r.height),
            imgs: imagenes.length,
            sinSrc: imagenes.filter(im => !im.getAttribute('src')).length,
            rotas: imagenes.filter(im => im.complete && im.naturalWidth === 0).length,
            cargadas: imagenes.filter(im => im.complete && im.naturalWidth > 0).length,
            pasos: panel.querySelectorAll('li').length,
            desborde: panel.scrollWidth > Math.ceil(r.width) + 1,
          });
        })()`,
      // Las pestañas sin capturas (iOS, Mac) son válidas: sólo importa que,
      // si hay imágenes, al menos la primera se haya decodificado.
      (v) => v.alto > 120 && v.sinSrc === 0 && v.rotas === 0 && (v.imgs === 0 || v.cargadas >= 1),
    );
    if (info.desborde) throw new Error(`Pestaña ${i}: el panel desborda a lo ancho`);
    detalle.push(`tab${i}: ${info.alto}px, ${info.imgs} img (${info.cargadas} cargadas), ${info.pasos} pasos`);
    console.log(`    · tab${i}: ${info.alto}px alto · ${info.imgs} img (${info.cargadas} cargadas) · ${info.pasos} pasos`);
  }

  // Lente: la primera captura debe abrir la vista ampliada.
  await js(ses, `document.querySelectorAll('#instalar [role=tab]')[0].click()`);
  await dormir(800);
  const antes = await medir(
    ses,
    `JSON.stringify({
      figuras: document.querySelectorAll('#instalar figure').length,
      botonesZoom: document.querySelectorAll('#instalar figure button').length,
      pestana: [...document.querySelectorAll('#instalar [role=tab]')].findIndex(x => x.getAttribute('aria-selected') === 'true'),
    })`,
    (v) => v.botonesZoom > 0,
  );
  await js(
    ses,
    `(() => {
      const b = document.querySelector('#instalar figure button');
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`,
  );
  try {
    await esperarPor(ses, "document.querySelector('[role=dialog][aria-modal=true]')", { nombre: "lente abierta", tiempo: 4000 });
  } catch {
    const react = await js(
      ses,
      `(() => {
        const b = document.querySelector('#instalar [role=tab]');
        const claves = b ? Object.keys(b).filter(k => k.startsWith('__react')).length : -1;
        return JSON.stringify({ clavesReact: claves, contenidoPanel: (document.querySelector('#instalar [role=tabpanel]')?.innerText || '').slice(0, 60) });
      })()`,
    );
    throw new Error(`La lente no abrió (figuras: ${antes.figuras}, botones: ${antes.botonesZoom}, pestaña activa: ${antes.pestana}) ↳ ${react}`);
  }
  const lente = await medir(
    ses,
    `(() => {
        const d = document.querySelector('[role=dialog][aria-modal=true]');
        const im = d.querySelector('img');
        return JSON.stringify({ listo: !!im && im.complete && im.naturalWidth > 0, texto: d.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) });
      })()`,
  );
  if (!lente.listo) throw new Error("La vista ampliada no mostró la imagen");

  // El botón de descarga al pie de la guía debe abrir el modal con los archivos.
  await js(ses, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await dormir(300);
  await js(ses, `document.querySelector('#instalar [role=tabpanel] > button').click()`);
  await esperarPor(ses, "document.querySelector('.fixed.inset-0.z-50')", { nombre: "modal de descargas", tiempo: 8000 });
  const modal = await medir(
    ses,
    `(() => {
      const caja = document.querySelector('.fixed.inset-0.z-50');
      const texto = caja.innerText;
      return JSON.stringify({
        archivos: caja.querySelectorAll('a[href]').length,
        diceNoSabes: /sab[eé]s c[oó]mo instalar/i.test(texto),
        diceSinVersiones: /No hay versiones/i.test(texto),
      });
    })()`,
    (v) => v.archivos > 0 || v.diceSinVersiones,
  );
  if (!modal.diceNoSabes) throw new Error("El modal no muestra el botón «¿No sabés cómo instalar?»");

  // La burbuja de Premium acompaña en todo el sitio: precio vigente + contacto.
  await js(ses, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await dormir(500);
  const burbuja = await medir(
    ses,
    `(() => {
      const b = document.querySelector('button[aria-controls="bitly-premium-burbuja"]');
      if (!b) return JSON.stringify({ hay: false });
      const r = b.getBoundingClientRect();
      return JSON.stringify({
        hay: true,
        abierta: b.getAttribute('aria-expanded') === 'true',
        texto: b.innerText.replace(/\\s+/g, ' ').trim(),
        dentro: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      });
    })()`,
    (v) => v.hay && v.dentro,
  );
  if (!burbuja.hay) throw new Error("No está la burbuja de Premium");
  if (!burbuja.dentro) throw new Error("La burbuja de Premium se sale de la pantalla");
  if (!/30/.test(burbuja.texto)) throw new Error(`La burbuja no muestra el precio vigente: “${burbuja.texto}”`);
  if (burbuja.abierta) throw new Error("La burbuja tendría que arrancar cerrada");

  // Se abre, muestra el contacto de WhatsApp con el precio dentro del mensaje
  // y el panel tampoco desborda ni en 320 px.
  await js(ses, `document.querySelector('button[aria-controls="bitly-premium-burbuja"]').click()`);
  await esperarPor(ses, "document.querySelector('#bitly-premium-burbuja')", { nombre: "burbuja abierta", tiempo: 4000 });
  const panel = await medir(
    ses,
    `(() => {
      const p = document.querySelector('#bitly-premium-burbuja');
      const wa = decodeURIComponent(p.querySelector('a[href^="https://wa.me/"]')?.getAttribute('href') || '');
      const ig = p.querySelector('a[href*="instagram.com"]')?.getAttribute('href') || '';
      const r = p.getBoundingClientRect();
      return JSON.stringify({
        wa,
        ig,
        texto: p.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80),
        dentro: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1,
        desborda: p.scrollWidth > Math.ceil(r.width) + 1,
      });
    })()`,
    (v) => !!v.wa,
  );
  if (panel.desborda) throw new Error("El panel de la burbuja desborda a lo ancho");
  if (!panel.dentro) throw new Error("El panel de la burbuja se sale de la pantalla");
  if (!/wa\.me\/59173427418/.test(panel.wa)) throw new Error(`El botón de WhatsApp no es el contacto del sitio: ${panel.wa.slice(0, 60)}`);
  if (!/30/.test(panel.wa)) throw new Error(`El mensaje de WhatsApp no lleva el precio: ${panel.wa.slice(0, 90)}`);
  if (!/instagram\.com\/flox_devs_sucre/.test(panel.ig)) throw new Error("El enlace de Instagram no es el del sitio");

  // «Ver precios» cierra la burbuja y baja a la sección de planes.
  await js(
    ses,
    `[...document.querySelectorAll('#bitly-premium-burbuja button')]
      .find(b => /precios y todo|pricing and everything/i.test(b.innerText))?.click()`,
  );
  const planes = await medir(
    ses,
    `JSON.stringify({
      cerrada: !document.querySelector('#bitly-premium-burbuja'),
      top: Math.round(document.getElementById('planes').getBoundingClientRect().top),
    })`,
    (v) => v.cerrada && Math.abs(v.top) < 60,
  );

  // La burbuja tiene que leerse en los dos temas (texto vs fondo, WCAG ≥ 3:1).
  const legible = await js(
    ses,
    `(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const mide = () => {
        const b = document.querySelector('button[aria-controls="bitly-premium-burbuja"]');
        const span = b.querySelectorAll('span span');
        // Los tokens del tema están en oklch: se pasan a rgb() para que la
        // luminancia sea la real (si no, los números se leen como canales).
        const aRgb = (c) => {
          if (!c || c.indexOf('oklch') < 0) return c;
          const p = c.slice(c.indexOf('(') + 1, c.indexOf(')')).split(' ').filter(Boolean);
          const L = +p[0], C = +p[1], H = (+p[2]) * Math.PI / 180;
          const a = C * Math.cos(H), bb = C * Math.sin(H);
          const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
          const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
          const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * bb, 3);
          const lin = [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
          ];
          return 'rgb(' + lin.map((v) => {
            const x = Math.min(1, Math.max(0, v));
            const g = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
            return Math.round(g * 255);
          }).join(', ') + ')';
        };
        const l1 = lum(aRgb(getComputedStyle(span[span.length - 1] || b).color));
        const l2 = lum(aRgb(getComputedStyle(document.body).backgroundColor));
        return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
      };
      const raiz = document.documentElement;
      const original = raiz.className;
      raiz.classList.remove('dark', 'light'); raiz.classList.add('light');
      const claro = mide();
      raiz.classList.remove('light'); raiz.classList.add('dark');
      const oscuro = mide();
      raiz.className = original;
      return JSON.stringify({ claro, oscuro });
    })()`,
  );
  const tema = JSON.parse(legible);
  if (tema.claro < 3 || tema.oscuro < 3) {
    throw new Error(`La burbuja se lee mal: contraste ${tema.claro}:1 en claro y ${tema.oscuro}:1 en oscuro`);
  }
  console.log(`    · contraste de la burbuja: ${tema.claro}:1 (claro) · ${tema.oscuro}:1 (oscuro)`);

  // Opcional (`REVISAR_MONEDA=1`): el precio de la burbuja tiene que seguir a la
  // moneda elegida, igual que el de la sección de planes.
  if (process.env.REVISAR_MONEDA === "1") {
    await js(
      ses,
      `(() => {
        const b = [...document.querySelectorAll('header button')]
          .find(x => /^(Bs|US\\$|€|\\$|S\\/|R\\$)$/.test(x.innerText.trim()));
        if (!b) return false; b.click(); return true;
      })()`,
    );
    await dormir(400);
    await js(
      ses,
      `[...document.querySelectorAll('button')]
        .find(b => /^US\\$\\s*USD$/.test(b.innerText.replace(/\\s+/g, ' ').trim()))?.click()`,
    );
    await dormir(2500);
    const precios = await medir(
      ses,
      `JSON.stringify({
        burbuja: (document.querySelector('button[aria-controls="bitly-premium-burbuja"]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
        planes: (document.querySelector('#planes')?.innerText || '').replace(/\\s+/g, ' ').trim(),
      })`,
      (v) => v.burbuja.length > 0,
    );
    console.log(`    · moneda USD -> burbuja: ${precios.burbuja} | planes: ${precios.planes.slice(0, 70)}`);
    if (!/(US\$|\$|€|S\/|R\$)\s?[\d.,]+/.test(precios.burbuja)) {
      throw new Error(`La burbuja no siguió a la moneda elegida: ${precios.burbuja}`);
    }
  }

  return `${medidas.ventana}px · scroll ${medidas.scroll} · sección ${medidas.seccion}×${medidas.alto} | ${detalle.join(" · ")} | lente: ${lente.texto} | modal: ${modal.archivos} enlaces | burbuja: “${burbuja.texto.replace(/\n/g, " ")}”`;
}

TAREAS.revision = ANCHOS_REVISION.map((w) => ({
  archivo: null,
  sinCaptura: true,
  viewport: { w, h: w < 700 ? 820 : 900, dpr: 1, movil: w < 700 },
  async correr(ses) {
    return { notas: await revisarSeccion(ses) };
  },
}));

/* ─────────────────────────── Main ─────────────────────────── */

async function main() {
  const grupos = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  // `revision` no entra en la corrida normal: no guarda capturas y necesita otra URL.
  const seleccion = grupos.length ? grupos : Object.keys(TAREAS).filter((g) => g !== "revision");
  for (const g of seleccion) if (!TAREAS[g]) throw new Error(`Grupo desconocido: ${g}`);

  fs.mkdirSync(SALIDA, { recursive: true });

  console.log(`▸ Chrome …`);
  const chrome = await abrirChrome({ puerto: PUERTO, perfil: PERFIL });
  const browser = chrome.browser;
  try {
    console.log(`▸ ${chrome.info.Browser}\n`);

    for (const g of seleccion) {
      console.log(`▸ Grupo: ${g}${g === "revision" ? " (sólo medición, no guarda capturas)" : ""}`);
      for (const tarea of TAREAS[g]) {
        const ses = await nuevaSesion(browser, tarea.viewport);
        try {
          const { clip, notas } = await tarea.correr(ses);
          if (!tarea.sinCaptura) await capturar(ses, tarea.archivo, clip);
          if (notas) console.log(`    · ${notas}`);
        } finally {
          await ses.cerrar();
        }
      }
    }
    // verificación de píxeles (no puedo "ver" la imagen: la mido)
    console.log(`\n▸ Verificación de píxeles`);
    let sospechosas = 0;
    for (const g of seleccion) {
      for (const t of TAREAS[g]) {
        if (t.sinCaptura) continue;
        const m = await analizar(browser, t.archivo);
        const plana = m.desvio < 6 || m.colores < 12;
        if (plana) sospechosas++;
        console.log(
          `  ${plana ? "!" : "✔"} ${t.archivo.padEnd(28)} ${m.w}×${m.h}  lum ${String(m.media).padStart(5)}  desvío ${String(m.desvio).padStart(5)}  negros ${String(m.negros).padStart(4)}%  tonos ${m.colores}`,
        );
      }
    }
    if (sospechosas) console.log(`  ⚠ ${sospechosas} captura(s) casi plana(s): revisar el maquetado.`);

    console.log(`\n✔ Capturas en ${path.relative(RAIZ, SALIDA)}`);
  } finally {
    await chrome.cerrar();
  }
}

main().catch((e) => {
  console.error("\n✖ " + e.message);
  process.exit(1);
});
