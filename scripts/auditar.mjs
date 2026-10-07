#!/usr/bin/env node
/**
 * Proxy con compresión para auditar el sitio en local.
 *
 * Por qué existe: `wrangler pages dev` entrega los textos SIN comprimir, y
 * Lighthouse calcula el tiempo de descarga con el tamaño que ve en la red. Un
 * HTML de 106 KB sin gzip midía 0,9 s de más en FCP: la misma página en
 * producción la sirve Cloudflare con brotli y no se parece a esa medición.
 *
 * Este proxy pone la compresión en el medio, así que los números de la
 * auditoría local se parecen a los de producción.
 *
 *   node scripts/auditar.mjs                 # 127.0.0.1:8799 → 127.0.0.1:8800
 *   node scripts/auditar.mjs http://x:8080   # otro origen
 *   npx lighthouse http://127.0.0.1:8800/ ...
 *
 * No toca nada del sitio: sólo codifica la respuesta que ya devolvió el origen.
 */
import http from "node:http";
import zlib from "node:zlib";

const ORIGEN = process.argv[2] ?? "http://127.0.0.1:8799";
const PUERTO = Number(process.argv[3] ?? 8800);
const destino = new URL(ORIGEN);

const COMPRIMIBLES = /^(text\/|application\/(json|xml|javascript|manifest\+json|ld\+json)|image\/svg\xml)/;

const servidor = http.createServer((req, res) => {
  const cabeceras = { ...req.headers, host: destino.host };
  delete cabeceras["accept-encoding"];
  delete cabeceras["content-length"];

  const opcion = http.request(
    { hostname: destino.hostname, port: destino.port || 80, path: req.url, method: req.method, headers: cabeceras },
    (respuesta) => {
      const tipo = respuesta.headers["content-type"] ?? "";
      const acepta = String(req.headers["accept-encoding"] ?? "");
      const comprimible = COMPRIMIBLES.test(tipo) && !respuesta.headers["content-encoding"];

      const salidas = { ...respuesta.headers };
      delete salidas["content-length"];
      delete salidas["transfer-encoding"];

      if (!comprimible) {
        res.writeHead(respuesta.statusCode ?? 502, salidas);
        respuesta.pipe(res);
        return;
      }

      let codificado = null;
      let stream = respuesta;
      if (/\bbr\b/.test(acepta)) {
        codificado = "br";
        stream = respuesta.pipe(zlib.createBrotliCompress());
      } else if (/\bgzip\b/.test(acepta)) {
        codificado = "gzip";
        stream = respuesta.pipe(zlib.createGzip({ level: 6 }));
      } else if (/\bdeflate\b/.test(acepta)) {
        codificado = "deflate";
        stream = respuesta.pipe(zlib.createDeflate());
      }

      if (codificado) {
        salidas["content-encoding"] = codificado;
        salidas.vary = "Accept-Encoding";
      }
      res.writeHead(respuesta.statusCode ?? 502, salidas);
      stream.pipe(res);
    },
  );

  opcion.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`proxy: ${e.message}`);
  });

  if (req.method === "POST" || req.method === "PUT") req.pipe(opcion);
  else opcion.end();
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`[audit] http://127.0.0.1:${PUERTO}/ → ${ORIGEN} (brotli/gzip para textos)`);
});
