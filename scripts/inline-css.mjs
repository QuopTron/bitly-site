import fs from "node:fs";
import path from "node:path";

const CLIENTE = path.resolve("dist", "client");

function archivosHtml(dir) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "assets" || entrada.name === "_ssr") continue;
      salida.push(...archivosHtml(completo));
    } else if (entrada.name.endsWith(".html")) {
      salida.push(completo);
    }
  }
  return salida;
}

let total = 0;
for (const html of archivosHtml(CLIENTE)) {
  let texto = fs.readFileSync(html, "utf8");
  const enlaces = [...texto.matchAll(/<link rel="stylesheet" href="(\/assets\/[^"]+\.css)"[^>]*>/g)];
  if (!enlaces.length) continue;
  for (const enlace of enlaces) {
    const css = path.join(CLIENTE, enlace[1]);
    if (!fs.existsSync(css)) continue;
    const contenido = fs
      .readFileSync(css, "utf8")
      .replace(/<\/style/gi, "<\\/style")
      .replace(/@charset[^;]+;/g, "");
    texto = texto.replace(enlace[0], `<style>${contenido}</style>`);
  }
  fs.writeFileSync(html, texto, "utf8");
  total++;
  console.log(
    `[css] ${path.relative(CLIENTE, html)}: ${(Buffer.byteLength(texto) / 1024).toFixed(1)} KB con CSS incrustada`,
  );
}
console.log(`[css] ${total} página(s) procesada(s)`);
