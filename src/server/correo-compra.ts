/**
 * Plantillas de correo del sitio (compra y aviso interno).
 *
 * Viven aparte de `pedidos.ts` a propósito: allá está todo lo que habla con las
 * server functions y GitHub, y acá solo hay texto y HTML. Así se pueden abrir en
 * el navegador y probar de verdad con `scripts/probar-correo.mjs` sin levantar
 * media app.
 *
 * Reglas de armado: tablas y estilos en línea (Gmail y Outlook tiran el <style>
 * y el flexbox), ninguna imagen (no dependemos de que el cliente cargue nada y
 * el correo no cae tan fácil en Promociones) y el código arriba, grande: el
 * 90 % de estos correos se abren en el celular para copiar el código.
 */

import { enlaceWhatsApp } from "@/lib/contacto";

export type CorreoArmado = { subject: string; text: string; html: string };

/** Lo mínimo que necesita una plantilla; `PedidoGuardado` encaja tal cual. */
export type PedidoParaCorreo = {
  folio: string;
  nombre: string;
  correo: string;
  celular: string;
  comprobante: string;
  codigo: string | null;
};

const SITIO_WEB = "https://bitly-site.pages.dev";

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Contenedor de marca: fondo negro, tarjeta plata, mismo en los dos correos. */
function marco(contenido: string, ancho = 560): string {
  return `<div style="margin:0;padding:26px 12px;background:#08080a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${ancho}px;margin:0 auto;border:1px solid #232327;border-radius:22px;background:#0d0d10;">
${contenido}
  </table>
</div>`;
}

function pie(nota: string): string {
  return `    <tr><td style="padding:24px 26px 26px;">
      <div style="height:1px;background:#222226;margin-bottom:14px;"></div>
      <div style="font-size:11px;line-height:1.75;color:#6f6f78;">${nota}<br>Bitly · música sin pérdida</div>
    </td></tr>`;
}

/** Correo que recibe el comprador con su código de activación. */
export function cuerpoCorreo(p: PedidoParaCorreo): CorreoArmado {
  const nombre = p.nombre ? `, ${p.nombre}` : "";
  const codigo = p.codigo ?? "";
  const folio = escaparHtml(p.folio);
  const subject = `Gracias por comprar Bitly${nombre} — tu código Premium`;
  const whatsapp = enlaceWhatsApp(`Hola, tengo una duda con mi pedido ${p.folio}`);

  const text = [
    `Hola${nombre}:`,
    "",
    "Gracias por comprar Bitly. Tu pago quedó confirmado y este es tu código",
    "de activación Premium, de por vida:",
    "",
    codigo,
    "",
    "Cómo activarlo:",
    `1. Entrá a ${SITIO_WEB} y abrí la demo.`,
    '2. Tocá "Tengo un código Premium".',
    "3. Pegá el código y listo: escuchás en FLAC sin pérdida.",
    "",
    `Pedido: ${p.folio}`,
    "",
    "¿Dudas? Respondé este correo o escribinos por WhatsApp:",
    whatsapp,
    "",
    "Bitly · música sin pérdida",
  ].join("\n");

  const html = marco(`    <tr><td style="padding:24px 26px 0;">
      <div style="font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#82828c;">Bitly · música sin pérdida</div>
      <div style="margin-top:16px;font-size:27px;line-height:1.15;font-weight:800;color:#f5f5f7;letter-spacing:-.02em;">Gracias por comprar Bitly</div>
      <div style="margin-top:9px;font-size:14px;line-height:1.65;color:#a1a1aa;">Hola${escaparHtml(nombre)}: tu pago quedó confirmado. Abajo está tu código Premium, tuyo de por vida.</div>
    </td></tr>
    <tr><td style="padding:18px 26px 0;">
      <div style="height:1px;background:#26262b;"></div>
    </td></tr>
    <tr><td style="padding:18px 26px 0;">
      <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#82828c;padding-bottom:8px;">Tu código de activación</div>
      <div style="padding:16px 18px;border:1px solid #2e2e34;border-radius:14px;background:#121216;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.55;color:#f5f5f7;word-break:break-all;">${escaparHtml(codigo)}</div>
    </td></tr>
    <tr><td style="padding:22px 26px 0;">
      <div style="font-size:13px;font-weight:700;color:#f5f5f7;padding-bottom:7px;">Activarlo toma un minuto</div>
      <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:#a1a1aa;">
        <li>Entrá a <a href="${SITIO_WEB}" style="color:#f5f5f7;text-decoration:none;border-bottom:1px solid #3a3a41;">bitly-site.pages.dev</a> y abrí la demo.</li>
        <li>Tocá «Tengo un código Premium».</li>
        <li>Pegá el código y listo: escuchás en FLAC sin pérdida.</li>
      </ol>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" valign="top" style="padding:0 6px 0 0;">
          <div style="border:1px solid #232327;border-radius:14px;background:#101013;padding:13px 14px;font-size:12px;line-height:1.6;color:#a1a1aa;"><strong style="color:#f5f5f7;font-size:12px;">FLAC sin pérdida</strong><br>Hasta 24-bit/192 kHz, sin recomprimir nada.</div>
        </td>
        <td width="50%" valign="top" style="padding:0 0 0 6px;">
          <div style="border:1px solid #232327;border-radius:14px;background:#101013;padding:13px 14px;font-size:12px;line-height:1.6;color:#a1a1aa;"><strong style="color:#f5f5f7;font-size:12px;">Sin límites</strong><br>Reproducciones ilimitadas y descargas de por vida.</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <a href="${SITIO_WEB}" style="display:inline-block;background:#f5f5f7;color:#0b0b0d;text-decoration:none;font-size:13px;font-weight:700;padding:13px 22px;border-radius:999px;">Abrir Bitly</a>
    </td></tr>
${pie(
    `Pedido <strong style="color:#a1a1aa;font-family:ui-monospace,Menlo,monospace;">${folio}</strong><br>
        ¿Dudas? Respondé este correo o <a href="${whatsapp}" style="color:#a1a1aa;text-decoration:none;border-bottom:1px solid #34343a;">escribinos por WhatsApp</a>.`,
  )}`);

  return { subject, text, html };
}

/** Correo interno: entró un comprobante nuevo. */
export function avisoNuevoPedido(p: PedidoParaCorreo): CorreoArmado {
  const subject = `Nuevo pedido ${p.folio} · Bitly Premium`;
  const text = [
    "Entró un pedido nuevo con comprobante de pago.",
    "",
    `Folio: ${p.folio}`,
    `Nombre: ${p.nombre || "(sin nombre)"}`,
    `Correo: ${p.correo}`,
    `Celular: ${p.celular}`,
    `Archivo: ${p.comprobante}`,
    "",
    "Revisalo en el panel privado del sitio: tres clics en el logo.",
  ].join("\n");

  const html = marco(
    `    <tr><td style="padding:22px 24px 0;">
      <div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#82828c;">Bitly · panel privado</div>
      <div style="margin-top:14px;font-size:20px;font-weight:800;color:#f5f5f7;letter-spacing:-.01em;">Entró un pedido con comprobante</div>
      <div style="margin-top:6px;font-size:13px;color:#a1a1aa;">Revisalo, asigná el código y enviáselo al comprador desde el panel.</div>
    </td></tr>
    <tr><td style="padding:18px 24px 0;"><div style="height:1px;background:#26262b;"></div></td></tr>
    <tr><td style="padding:18px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.9;color:#a1a1aa;">
        <tr><td width="88" style="color:#82828c;">Pedido</td><td style="color:#f5f5f7;font-family:ui-monospace,Menlo,monospace;font-weight:700;">${escaparHtml(p.folio)}</td></tr>
        <tr><td style="color:#82828c;">Nombre</td><td>${escaparHtml(p.nombre || "(sin nombre)")}</td></tr>
        <tr><td style="color:#82828c;">Correo</td><td>${escaparHtml(p.correo)}</td></tr>
        <tr><td style="color:#82828c;">Celular</td><td>${escaparHtml(p.celular)}</td></tr>
        <tr><td style="color:#82828c;">Archivo</td><td style="font-size:11px;word-break:break-all;">${escaparHtml(p.comprobante)}</td></tr>
      </table>
      <div style="margin-top:18px;"><a href="${SITIO_WEB}" style="display:inline-block;background:#f5f5f7;color:#0b0b0d;text-decoration:none;font-size:12px;font-weight:700;padding:11px 18px;border-radius:999px;">Abrir el panel</a></div>
    </td></tr>
${pie("Tres clics en el logo abren el acceso privado.")}`,
    520,
  );

  return { subject, text, html };
}

/** Correo de prueba del panel: mismo marco, sin datos de nadie. */
export function correoDePrueba(): CorreoArmado {
  return {
    subject: "Prueba de correo · Bitly",
    text: [
      "La configuración de correo del sitio funciona.",
      "",
      "Este mensaje salió del mismo servidor que manda los códigos de compra: si",
      "llegó, el comprador también lo va a recibir.",
      "",
      SITIO_WEB,
    ].join("\n"),
    html: marco(`    <tr><td style="padding:24px 26px 0;">
      <div style="font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#82828c;">Bitly · correo</div>
      <div style="margin-top:16px;font-size:24px;font-weight:800;color:#f5f5f7;letter-spacing:-.02em;">El correo funciona</div>
      <div style="margin-top:9px;font-size:14px;line-height:1.65;color:#a1a1aa;">Este mensaje salió del mismo servidor que manda los códigos de compra. Si llegó, el comprador también lo va a recibir.</div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <a href="${SITIO_WEB}" style="display:inline-block;background:#f5f5f7;color:#0b0b0d;text-decoration:none;font-size:13px;font-weight:700;padding:13px 22px;border-radius:999px;">Abrir Bitly</a>
    </td></tr>
${pie("Correo de prueba generado desde el panel privado.")}`),
  };
}
