/**
 * Envío de correo del sitio.
 *
 * Tres caminos, en orden de preferencia:
 *   1. Resend (`RESEND_API_KEY` + `BITLY_EMAIL_FROM`).
 *   2. Webhook propio (`BITLY_EMAIL_WEBHOOK`).
 *   3. SMTP directo con Gmail (`BITLY_SMTP_HOST`, `BITLY_SMTP_PORT`,
 *      `BITLY_SMTP_USER`, `BITLY_SMTP_PASS`, `BITLY_EMAIL_FROM`).
 *
 * El SMTP usa `worker-mailer`, que corre sobre `cloudflare:sockets` y por eso
 * se importa de forma dinámica: en desarrollo (Node) no existe ese módulo y no
 * queremos que el sitio falle sólo por tener las variables configuradas.
 */

type Correo = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export type ResultadoCorreo =
  | { ok: true; via: "resend" | "webhook" | "smtp" }
  | { ok: false; motivo: "sin_configurar" | "envio" | "servidor" };

function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 160;
}

export function correoConfigurado(): boolean {
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.BITLY_EMAIL_FROM) ||
      process.env.BITLY_EMAIL_WEBHOOK ||
      (process.env.BITLY_SMTP_HOST &&
        process.env.BITLY_SMTP_USER &&
        process.env.BITLY_SMTP_PASS &&
        process.env.BITLY_EMAIL_FROM),
  );
}

export function correoAdmin(): string {
  return (process.env.BITLY_ADMIN_EMAIL || "floxdev2024@gmail.com").trim();
}

/** Acepta `correo@dominio.com` o `Nombre <correo@dominio.com>`. */
function parsearRemitente(from: string): { name?: string; email: string } {
  const coincidencia = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!coincidencia) return { email: from.trim() };
  const nombre = coincidencia[1].replace(/^["']|["']$/g, "").trim();
  return { ...(nombre ? { name: nombre } : {}), email: coincidencia[2].trim() };
}

/* ── SMTP en Node (sólo desarrollo local) ─────────────────────────── */

/**
 * `worker-mailer` corre sobre `cloudflare:sockets`, que NO existe en Node: en
 * `pnpm dev` el envío fallaba y no había forma de probar una compra de punta a
 * punta en localhost. Esto es un cliente SMTP mínimo (TLS implícito, AUTH LOGIN)
 * para ese caso; en Cloudflare nunca se ejecuta — el import de worker-mailer
 * funciona allá y este camino queda muerto.
 *
 * Se soporta el puerto 465 (Gmail) a propósito: es el único que usa TLS desde
 * el primer byte, así que no hay que negociar STARTTLS a mano. Con 587 el
 * llamador cae al error de envío, que es lo que ya hacía.
 */
type SmtpNode = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  nombreRemitente?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

/** Cabecera con acentos o guiones largos: hay que codificarla (RFC 2047). */
function cabecera(valor: string): string {
  if (!/[^\x20-\x7e]/.test(valor)) return valor;
  return `=?UTF-8?B?${Buffer.from(valor, "utf8").toString("base64")}?=`;
}

/** Cuerpo en base64 (sin dot-stuffing ni límite de 998 caracteres por línea). */
function cuerpoBase64(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

async function enviarSmtpNode(o: SmtpNode): Promise<void> {
  if (o.port !== 465) throw new Error(`SMTP local: sólo se soporta 465 (recibido ${o.port})`);

  const tls = await import("node:tls");
  const socket = tls.connect({ host: o.host, port: o.port, servername: o.host });
  socket.setEncoding("utf8");

  // Respuestas completas del servidor (código de 3 cifras + espacio cierra un
  // bloque multilínea). La cola es FIFO: cada `esperar` consume la suya.
  const respuestas: number[] = [];
  let resto = "";
  let despertar: (() => void) | null = null;

  socket.on("data", (trozo: string) => {
    resto += trozo;
    for (let i = resto.indexOf("\r\n"); i >= 0; i = resto.indexOf("\r\n")) {
      const linea = resto.slice(0, i);
      resto = resto.slice(i + 2);
      const m = /^(\d{3})([ -])/.exec(linea);
      if (m && m[2] === " ") respuestas.push(Number(m[1]));
    }
    despertar?.();
  });

  const esperar = (codigo: number) =>
    new Promise<void>((resolver, rechazar) => {
      const revisar = () => {
        if (respuestas[0] === codigo) {
          respuestas.shift();
          despertar = null;
          resolver();
          return;
        }
        if (respuestas.length > 0) {
          despertar = null;
          rechazar(new Error(`SMTP respondió ${respuestas[0]} (se esperaba ${codigo})`));
        }
      };
      despertar = revisar;
      revisar();
    });

  const escribir = (linea: string) => socket.write(`${linea}\r\n`);

  const limite = setTimeout(() => socket.destroy(new Error("SMTP: tiempo de espera agotado")), 25_000);

  try {
    const abortado = new Promise<never>((_, rechazar) => {
      socket.once("error", rechazar);
      socket.once("close", () => rechazar(new Error("SMTP: el servidor cerró la conexión")));
    });
    // Al terminar bien cerramos el socket en el `finally`: ese "close" tardío
    // rechaza acá, cuando ya nadie escucha. Se silencia para no ensuciar el log.
    abortado.catch(() => undefined);

    await Promise.race([esperar(220), abortado]);
    escribir("EHLO bitly-site.local");
    await Promise.race([esperar(250), abortado]);

    escribir("AUTH LOGIN");
    await Promise.race([esperar(334), abortado]);
    escribir(Buffer.from(o.user, "utf8").toString("base64"));
    await Promise.race([esperar(334), abortado]);
    escribir(Buffer.from(o.pass, "utf8").toString("base64"));
    await Promise.race([esperar(235), abortado]);

    escribir(`MAIL FROM:<${o.from}>`);
    await Promise.race([esperar(250), abortado]);
    escribir(`RCPT TO:<${o.to}>`);
    await Promise.race([esperar(250), abortado]);
    escribir("DATA");
    await Promise.race([esperar(354), abortado]);

    const frontera = `bitly-${Date.now().toString(36)}`;
    const remitente = o.nombreRemitente ? `${cabecera(o.nombreRemitente)} <${o.from}>` : o.from;
    const mensaje = [
      `From: ${remitente}`,
      `To: <${o.to}>`,
      `Subject: ${cabecera(o.subject)}`,
      ...(o.replyTo ? [`Reply-To: <${o.replyTo}>`] : []),
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${frontera}@bitly-site>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${frontera}"`,
      "",
      `--${frontera}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      cuerpoBase64(o.text),
      `--${frontera}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      cuerpoBase64(o.html),
      `--${frontera}--`,
      "",
    ].join("\r\n");
    socket.write(`${mensaje}\r\n.\r\n`);
    await Promise.race([esperar(250), abortado]);
    escribir("QUIT");
  } finally {
    clearTimeout(limite);
    socket.end();
    socket.destroy();
  }
}

export async function enviarCorreo(correo: Correo): Promise<ResultadoCorreo> {
  if (!correoValido(correo.to)) return { ok: false, motivo: "envio" };

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.BITLY_EMAIL_FROM;
  const webhook = process.env.BITLY_EMAIL_WEBHOOK;
  const smtpHost = process.env.BITLY_SMTP_HOST;
  const smtpUser = process.env.BITLY_SMTP_USER;
  const smtpPass = process.env.BITLY_SMTP_PASS;

  try {
    if (resendKey && from) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [correo.to],
          subject: correo.subject,
          text: correo.text,
          html: correo.html,
          ...(correo.replyTo ? { reply_to: correo.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[correo] Resend respondió ${res.status}: ${await res.text().catch(() => "")}`);
        return { ok: false, motivo: "envio" };
      }
      return { ok: true, via: "resend" };
    }

    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: correo.to,
          subject: correo.subject,
          text: correo.text,
          html: correo.html,
          reply_to: correo.replyTo,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[correo] webhook respondió ${res.status}`);
        return { ok: false, motivo: "envio" };
      }
      return { ok: true, via: "webhook" };
    }

    if (smtpHost && smtpUser && smtpPass && from) {
      const puerto = Number(process.env.BITLY_SMTP_PORT || 465);
      const remitente = parsearRemitente(from);

      let WorkerMailer: typeof import("worker-mailer").WorkerMailer;
      try {
        ({ WorkerMailer } = await import("worker-mailer"));
      } catch {
        // En Node no existe `cloudflare:sockets`: se manda con el cliente SMTP
        // propio para poder probar el flujo completo desde localhost.
        await enviarSmtpNode({
          host: smtpHost,
          port: Number.isFinite(puerto) ? puerto : 465,
          user: smtpUser,
          pass: smtpPass,
          from: remitente.email,
          ...(remitente.name ? { nombreRemitente: remitente.name } : {}),
          to: correo.to,
          subject: correo.subject,
          text: correo.text,
          html: correo.html,
          ...(correo.replyTo ? { replyTo: correo.replyTo } : {}),
        });
        return { ok: true, via: "smtp" };
      }

      const mailer = await WorkerMailer.connect({
        host: smtpHost,
        port: Number.isFinite(puerto) ? puerto : 465,
        secure: puerto === 465,
        startTls: puerto !== 465,
        credentials: { username: smtpUser, password: smtpPass },
        authType: "plain",
        name: "bitly-site",
        socketTimeoutMs: 20_000,
        responseTimeoutMs: 20_000,
      });
      try {
        await mailer.send({
          from: remitente,
          to: correo.to,
          subject: correo.subject,
          text: correo.text,
          html: correo.html,
          ...(correo.replyTo ? { reply: { email: correo.replyTo } } : {}),
        });
      } finally {
        await mailer.close().catch(() => undefined);
      }
      return { ok: true, via: "smtp" };
    }
  } catch (e) {
    console.error("[correo] no se pudo enviar:", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "servidor" };
  }

  return { ok: false, motivo: "sin_configurar" };
}
