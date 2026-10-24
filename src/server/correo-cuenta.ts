/**
 * Correos de la cuenta.
 *
 * Cuatro mensajes, todos con el mismo marco que el correo de compra:
 *
 *   · código de confirmación del alta;
 *   · credenciales de una cuenta invitada (usuario + contraseña por defecto +
 *     su código Premium);
 *   · código para confirmar un cambio de contraseña o de usuario;
 *   · aviso interno cuando alguien borra su cuenta.
 *
 * El código de 6 dígitos va grande y en texto: se lee en el celular y se pega
 * en el modal. Las credenciales también van en texto plano porque son la única
 * forma de que la persona entre la primera vez; por eso la cuenta nace marcada
 * para cambiar la contraseña en el primer ingreso.
 */

import { enlaceWhatsApp } from "@/lib/contacto";
import { marco, pie, type CorreoArmado } from "@/server/correo-compra";

const SITIO_WEB = "https://bitly-site.pages.dev";

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Bloque con un valor en monoespaciada: código o credencial. */
function caja(valor: string, etiqueta?: string): string {
  return `${etiqueta ? `<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#82828c;padding:0 0 6px;">${escaparHtml(etiqueta)}</div>` : ""}
      <div style="padding:16px 18px;border:1px solid #2e2e34;border-radius:14px;background:#121216;margin-bottom:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;line-height:1.45;color:#f5f5f7;word-break:break-all;text-align:center;letter-spacing:.18em;">${escaparHtml(valor)}</div>`;
}

/** Código de confirmación del alta desde el sitio. */
export function correoConfirmacion(datos: { usuario: string; codigo: string }): CorreoArmado {
  const usuario = escaparHtml(datos.usuario);
  const codigo = escaparHtml(datos.codigo);
  const whatsapp = enlaceWhatsApp(`Hola, tengo un problema para confirmar mi cuenta ${datos.usuario}`);

  return {
    subject: `Tu código de confirmación · Bitly`,
    text: [
      `Hola @${datos.usuario}:`,
      "",
      "Este es tu código para confirmar la cuenta:",
      "",
      datos.codigo,
      "",
      "Vence en 15 minutos. Si no fuiste vos, ignorá este mensaje: sin el código",
      "la cuenta no se activa.",
      "",
      SITIO_WEB,
    ].join("\n"),
    html: marco(`    <tr><td style="padding:24px 26px 0;">
      <div style="font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#82828c;">Bitly · cuenta</div>
      <div style="margin-top:16px;font-size:26px;line-height:1.15;font-weight:800;color:#f5f5f7;letter-spacing:-.02em;">Confirmá tu cuenta</div>
      <div style="margin-top:9px;font-size:14px;line-height:1.65;color:#a1a1aa;">Hola @${usuario}: pegá este código en la ventana de tu cuenta. Vence en 15 minutos.</div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      ${caja(datos.codigo)}
    </td></tr>
    <tr><td style="padding:14px 26px 0;">
      <div style="border:1px solid #232327;border-radius:14px;background:#101013;padding:13px 14px;font-size:12px;line-height:1.6;color:#a1a1aa;">
        Si no fuiste vos, ignorá este mensaje: sin el código la cuenta no se activa.
      </div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <a href="${SITIO_WEB}" style="display:inline-block;background:#f5f5f7;color:#0b0b0d;text-decoration:none;font-size:13px;font-weight:700;padding:13px 22px;border-radius:999px;">Abrir Bitly</a>
    </td></tr>
${pie(
      `¿Dudas? <a href="${whatsapp}" style="color:#a1a1aa;text-decoration:none;border-bottom:1px solid #34343a;">Escribinos por WhatsApp</a>.<br>
        Tu código es <strong style="color:#a1a1aa;font-family:ui-monospace,Menlo,monospace;">${codigo}</strong>.`,
    )}`),
  };
}

/** Credenciales de una cuenta creada por otro usuario (invitación). */
export function correoCredenciales(datos: {
  usuario: string;
  correo: string;
  clave: string;
  codigo: string;
  folio: string;
  de: string;
}): CorreoArmado {
  const usuario = escaparHtml(datos.usuario);
  const correo = escaparHtml(datos.correo);
  const clave = escaparHtml(datos.clave);
  const codigo = escaparHtml(datos.codigo);
  const de = escaparHtml(datos.de);
  const whatsapp = enlaceWhatsApp(`Hola, me invitaron a Bitly y no puedo entrar`);

  return {
    subject: `Tu acceso a Bitly está listo — Premium incluido`,
    text: [
      `Hola:`,
      "",
      `${datos.de} te dio acceso a Bitly Premium. Esta es tu cuenta:`,
      "",
      `Usuario: ${datos.usuario}`,
      `Contraseña: ${datos.clave}`,
      "",
      "Entrá, cambiá la contraseña y quedate con Premium de por vida.",
      "",
      "Tu código Premium (por si lo necesitás en la app):",
      datos.codigo,
      "",
      SITIO_WEB,
      "",
      "Si no esperabas esta invitación, escribinos por WhatsApp:",
      whatsapp,
    ].join("\n"),
    html: marco(`    <tr><td style="padding:24px 26px 0;">
      <div style="font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#82828c;">Bitly · invitación</div>
      <div style="margin-top:16px;font-size:26px;line-height:1.15;font-weight:800;color:#f5f5f7;letter-spacing:-.02em;">${de} te dio Premium</div>
      <div style="margin-top:9px;font-size:14px;line-height:1.65;color:#a1a1aa;">Tu cuenta ya está creada y con Premium de por vida. Entrá con estos datos y cambiá la contraseña en el primer paso.</div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.9;color:#a1a1aa;">
        <tr><td width="92" style="color:#82828c;">Usuario</td><td style="color:#f5f5f7;font-family:ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all;">@${usuario}</td></tr>
        <tr><td style="color:#82828c;">Contraseña</td><td style="color:#f5f5f7;font-family:ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all;">${clave}</td></tr>
        <tr><td style="color:#82828c;">Correo</td><td style="color:#f5f5f7;">${correo}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 26px 0;">
      <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#82828c;padding-bottom:8px;">Tu código Premium</div>
      <div style="padding:14px 16px;border:1px solid #2e2e34;border-radius:14px;background:#121216;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;color:#f5f5f7;word-break:break-all;">${codigo}</div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">
      <a href="${SITIO_WEB}" style="display:inline-block;background:#f5f5f7;color:#0b0b0d;text-decoration:none;font-size:13px;font-weight:700;padding:13px 22px;border-radius:999px;">Entrar y cambiar mi contraseña</a>
    </td></tr>
${pie(
      `Pedido <strong style="color:#a1a1aa;font-family:ui-monospace,Menlo,monospace;">${escaparHtml(datos.folio)}</strong><br>
        Si no esperabas esta invitación, <a href="${whatsapp}" style="color:#a1a1aa;text-decoration:none;border-bottom:1px solid #34343a;">escribinos por WhatsApp</a>.`,
    )}`),
  };
}

/** Código para confirmar un cambio de contraseña o de usuario. */
export function correoCambioCodigo(datos: {
  usuario: string;
  codigo: string;
  tipo: "clave" | "usuario";
}): CorreoArmado {
  const usuario = escaparHtml(datos.usuario);
  const codigo = escaparHtml(datos.codigo);
  const esClave = datos.tipo === "clave";
  const whatsapp = enlaceWhatsApp(`Hola, no reconozco un cambio en mi cuenta ${datos.usuario}`);

  return {
    subject: esClave ? "Cambio de contraseña · Bitly" : "Cambio de usuario · Bitly",
    text: [
      `Hola @${datos.usuario}:`,
      "",
      esClave
        ? "Pediste cambiar la contraseña. Pegá este código en tu cuenta para confirmarlo:"
        : "Pediste cambiar tu nombre de usuario. Pegá este código en tu cuenta para confirmarlo:",
      "",
      datos.codigo,
      "",
      "Vence en 15 minutos. Si no fuiste vos, cambiá tu contraseña y escribinos.",
      "",
      SITIO_WEB,
    ].join("\n"),
    html: marco(`    <tr><td style="padding:24px 26px 0;">
      <div style="font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:#82828c;">Bitly · seguridad</div>
      <div style="margin-top:16px;font-size:25px;line-height:1.15;font-weight:800;color:#f5f5f7;letter-spacing:-.02em;">${esClave ? "Confirmá el cambio de contraseña" : "Confirmá el cambio de usuario"}</div>
      <div style="margin-top:9px;font-size:14px;line-height:1.65;color:#a1a1aa;">Hola @${usuario}: pegá este código en tu cuenta. Vence en 15 minutos.</div>
    </td></tr>
    <tr><td style="padding:20px 26px 0;">${caja(datos.codigo)}</td></tr>
    <tr><td style="padding:14px 26px 0;">
      <div style="border:1px solid #232327;border-radius:14px;background:#101013;padding:13px 14px;font-size:12px;line-height:1.6;color:#a1a1aa;">
        Si no fuiste vos, no pegues el código: cambiá tu contraseña desde la cuenta y <a href="${whatsapp}" style="color:#f5f5f7;text-decoration:none;border-bottom:1px solid #3a3a41;">escribinos por WhatsApp</a>.
      </div>
    </td></tr>
${pie(`Código válido por 15 minutos. Un pedido a la vez por cuenta.`)}`),
  };
}

/** Aviso interno: alguien dio de baja su cuenta. */
export function avisoCuentaEliminada(datos: {
  usuario: string;
  correo: string;
  codigo: string | null;
  cuando: string;
}): CorreoArmado {
  const usuario = escaparHtml(datos.usuario);
  const correo = escaparHtml(datos.correo);
  const codigo = datos.codigo ? escaparHtml(datos.codigo) : "—";
  const cuando = escaparHtml(new Date(datos.cuando).toLocaleString("es-BO"));

  return {
    subject: `Cuenta dada de baja: @${datos.usuario} · Bitly`,
    text: [
      "Una cuenta se dio de baja desde el sitio.",
      "",
      `Usuario: @${datos.usuario}`,
      `Correo: ${datos.correo}`,
      `Fecha: ${cuando}`,
      `Código liberado: ${datos.codigo ?? "(no tenía)"}`,
      "",
      "El código volvió al pedido y puede reasignarse a otra persona.",
    ].join("\n"),
    html: marco(
      `    <tr><td style="padding:22px 24px 0;">
      <div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#82828c;">Bitly · panel privado</div>
      <div style="margin-top:14px;font-size:20px;font-weight:800;color:#f5f5f7;letter-spacing:-.01em;">Una cuenta se dio de baja</div>
      <div style="margin-top:6px;font-size:13px;color:#a1a1aa;">El código liberado vuelve al pedido y se puede asignar a otra persona.</div>
    </td></tr>
    <tr><td style="padding:18px 24px 0;"><div style="height:1px;background:#26262b;"></div></td></tr>
    <tr><td style="padding:18px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.9;color:#a1a1aa;">
        <tr><td width="110" style="color:#82828c;">Usuario</td><td style="color:#f5f5f7;font-family:ui-monospace,Menlo,monospace;font-weight:700;">@${usuario}</td></tr>
        <tr><td style="color:#82828c;">Correo</td><td>${correo}</td></tr>
        <tr><td style="color:#82828c;">Fecha</td><td>${cuando}</td></tr>
        <tr><td style="color:#82828c;">Código libre</td><td style="font-size:11px;word-break:break-all;">${codigo}</td></tr>
      </table>
    </td></tr>
${pie("Los usuarios y las bajas se ven en la pestaña Usuarios del panel.")}`,
      520,
    ),
  };
}
