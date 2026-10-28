#!/usr/bin/env node
/**
 * Prueba el contador COMPARTIDO de las 75 canciones gratis contra el módulo
 * real de `src/server/descargas-cuenta.ts`.
 *
 * Es la pieza que evita que la web y la app sumen dos veces el plan gratis: la
 * cuota vive por cuenta en `data/descargas.json` y la app entra por
 * `POST /api/cuenta` con `accion: "cuota"` y `accion: "descarga"` (ver
 * `src/routes/api/cuenta.ts`), que llaman a las MISMAS funciones que se prueban
 * acá.
 *
 * No toca la red ni el repo de datos: usa los dobles de `scripts/pruebas/stubs`
 * (el store en memoria) y solo falsifica el registro de códigos Premium, que es
 * lo que decide si la cuenta es Premium (ilimitada).
 *
 * Uso: node scripts/probar-cuota-cuenta.mjs
 */

import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = (nombre) => path.join(raiz, "scripts", "pruebas", "stubs", nombre);

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

let ok = 0;
let fallos = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    ok++;
    console.log(`OK   ${nombre}${detalle ? `  (${detalle})` : ""}`);
  } else {
    fallos++;
    console.log(`FALLA ${nombre}${detalle ? `  (${detalle})` : ""}`);
  }
}

/* ── El entorno ─────────────────────────────────────────────────────────── */
// El registro de códigos es lo único que sale a la red: se falsifica con un
// código largo (los de verdad pasan de 20) en estado activo.
const CODIGO_PREMIUM = "BITLY-PREMIUM-DE-PRUEBA-0001";
const REGISTRO = "https://api.github.com/repos/QuopTron/bitly_codes_premium/contents/codes.json";
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith(REGISTRO)) {
    return new Response(JSON.stringify({ [CODIGO_PREMIUM]: "activo", _NOTA: "prueba" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return fetchReal(url, init);
};
process.env.BITLY_CODES_TOKEN = "token-de-mentira";

const esbuild = await cargarEsbuild();
const cache = path.join(raiz, "scripts", ".cache");
mkdirSync(cache, { recursive: true });
const salida = path.join(cache, "cuota-cuenta.mjs");

await esbuild.build({
  entryPoints: [path.join(raiz, "src", "server", "descargas-cuenta.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: { "@": path.join(raiz, "src") },
  // La plataforma (server functions) y la base de datos del sitio se prueban con
  // los mismos dobles que el resto de las pruebas del repo.
  plugins: [
    {
      name: "dobles-de-prueba",
      setup(build) {
        // Todo lo del framework (incluidas las entradas virtuales del servidor
        // de TanStack, que solo existen dentro de su build) va al doble: acá lo
        // único que importa es la lógica del módulo.
        build.onResolve({ filter: /^@tanstack\// }, () => ({ path: stub("start.mjs") }));
        build.onResolve({ filter: /^(#tanstack|tanstack-start-manifest)/ }, () => ({
          path: "vacio",
          namespace: "vacio",
        }));
        build.onResolve({ filter: /^@\/server\/github-store$/ }, () => ({ path: stub("github-store.mjs") }));
        // `correo` (vía cuentas) arrastra el cliente SMTP de Workers, que no
        // existe fuera de Cloudflare: acá no se manda ningún correo.
        build.onResolve({ filter: /^(worker-mailer|cloudflare:sockets)$/ }, () => ({
          path: "vacio",
          namespace: "vacio",
        }));
        build.onLoad({ filter: /.*/, namespace: "vacio" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
  outfile: salida,
  logLevel: "error",
});

const { estadoDeCuenta, consumirDescarga, LIMITE_DESCARGAS } = await import(
  pathToFileURL(salida).href + `?v=${Date.now()}`
);

// El store en memoria del doble: `ruta` → JSON.
const store = (globalThis.__STORE ??= new Map());
const leer = (ruta) => JSON.parse(store.get(ruta) ?? "{}");
const sembrar = (ruta, valor) => store.set(ruta, JSON.stringify(valor));

console.log(`LIMITE_DESCARGAS = ${LIMITE_DESCARGAS}\n`);

/* ── Cuenta nueva: las 75 completas ─────────────────────────────────────── */
const nueva = await estadoDeCuenta("cuenta-1");
check(
  "una cuenta sin registro arranca con las 75 completas",
  nueva.usadas === 0 && nueva.restantes === LIMITE_DESCARGAS,
  JSON.stringify(nueva),
);
check("y no es premium", nueva.premium === false && nueva.ilimitado === false);

/* ── Consumir desde la app ──────────────────────────────────────────────── */
const uno = await consumirDescarga("cuenta-1", {
  titulo: "Una canción",
  artista: "Ana",
  calidad: "flac",
  canal: "app",
});
check(
  "la primera descarga se anota",
  uno.ok === true && uno.usadas === 1 && uno.restantes === LIMITE_DESCARGAS - 1,
  JSON.stringify(uno),
);
const fila = leer("data/descargas.json").cuentas?.["cuenta-1"];
const evento = fila?.eventos?.[0];
check(
  "el evento guarda la canción y el canal",
  evento?.titulo === "Una canción" && evento?.canal === "app" && evento?.calidad === "flac",
  JSON.stringify(evento),
);
check("el evento lleva fecha", typeof evento?.fecha === "string" && evento.fecha.length > 0);

const trasUno = await estadoDeCuenta("cuenta-1");
check(
  "el estado de la cuenta ve el consumo",
  trasUno.usadas === 1 && trasUno.restantes === LIMITE_DESCARGAS - 1,
  JSON.stringify(trasUno),
);
const otra = await estadoDeCuenta("cuenta-2");
check("otra cuenta no hereda el consumo", otra.usadas === 0 && otra.restantes === LIMITE_DESCARGAS);

/* ── Al agotarse ────────────────────────────────────────────────────────── */
for (let i = 1; i < LIMITE_DESCARGAS; i++) {
  await consumirDescarga("cuenta-1", { titulo: `t${i}`, artista: "Ana", calidad: "estandar", canal: "app" });
}
const llena = await estadoDeCuenta("cuenta-1");
check(
  `con ${LIMITE_DESCARGAS} descargas no queda nada`,
  llena.usadas === LIMITE_DESCARGAS && llena.restantes === 0,
  JSON.stringify(llena),
);

const pasada = await consumirDescarga("cuenta-1", { titulo: "una más", artista: "Ana", calidad: "estandar", canal: "app" });
check("la de más se rechaza con motivo limite", pasada.ok === false && pasada.motivo === "limite", JSON.stringify(pasada));
check(
  "y el contador no se pasa del tope",
  leer("data/descargas.json").cuentas["cuenta-1"].usadas === LIMITE_DESCARGAS,
  String(leer("data/descargas.json").cuentas["cuenta-1"].usadas),
);

/* ── Cuenta Premium: ilimitada ──────────────────────────────────────────── */
// `data/cuentas.json` guarda la lista de cuentas pelada (ver cuentas.ts).
sembrar("data/cuentas.json", [
  { id: "cuenta-premium", usuario: "ana", correo: "ana@ejemplo.com", codigo: CODIGO_PREMIUM, creado: "", actualizado: "" },
]);
const premium = await estadoDeCuenta("cuenta-premium");
check(
  "una cuenta con código activo es ilimitada",
  premium.premium === true && premium.ilimitado === true && premium.restantes === null,
  JSON.stringify(premium),
);
// El código de la CUENTA vale igual que uno que llegue por parámetro: así la
// app no tiene que saber de Premium para pedir la cuota.
const porParametro = await estadoDeCuenta("cuenta-3", CODIGO_PREMIUM);
check("un código Premium pasado aparte también acredita", porParametro.ilimitado === true);
const sinCodigo = await estadoDeCuenta("cuenta-3");
check("y sin código vuelve a contar", sinCodigo.ilimitado === false && sinCodigo.restantes === LIMITE_DESCARGAS);

/* ── Datos rotos en el archivo ──────────────────────────────────────────── */
sembrar("data/descargas.json", { actualizado: "", cuentas: { "cuenta-4": { usadas: 999, ultima: null, eventos: [] } } });
const rota = await estadoDeCuenta("cuenta-4");
check(
  "un contador imposible se recorta al límite",
  rota.usadas === LIMITE_DESCARGAS && rota.restantes === 0,
  JSON.stringify(rota),
);

sembrar("data/descargas.json", { actualizado: "", cuentas: { "cuenta-5": { usadas: "muchas", ultima: 5, eventos: "no" } } });
const basura = await estadoDeCuenta("cuenta-5");
check(
  "un archivo con basura no rompe la cuenta",
  basura.usadas === 0 && basura.restantes === LIMITE_DESCARGAS,
  JSON.stringify(basura),
);

globalThis.fetch = fetchReal;

console.log(`\n${ok}/${ok + fallos} aserciones OK`);
if (fallos > 0) process.exitCode = 1;
