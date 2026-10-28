import { createFileRoute } from "@tanstack/react-router";
import {
  confirmarCuentaImpl,
  cuentaDeToken,
  iniciarSesionImpl,
  miCuentaImpl,
  registrarCuentaImpl,
  reenviarConfirmacionImpl,
} from "@/server/cuentas";
import { consumirDescarga, estadoDeCuenta } from "@/server/descargas-cuenta";

/**
 * API de cuenta para la APP (Flutter + backend Go de Bitly).
 *
 * Por qué existe: el sitio YA tiene todo lo de la cuenta —alta con correo,
 * confirmación de 6 dígitos, sesión firmada con HMAC y «Mi cuenta»—, pero vive
 * en *server functions* que el propio front llama en `/_serverFn/*`, y esas URLs
 * las **genera el build** (van con hash): un binario compilado no puede
 * depender de ellas sin romperse en el próximo despliegue.
 *
 * Esta ruta es el contrato estable. **No duplica lógica**: llama a las mismas
 * `*Impl` que usan los server functions, así que conserva los mismos cupos por
 * IP, la misma demora contra el sondeo de correo, el mismo hash PBKDF2 y el
 * mismo registro en `bitly-data`.
 *
 * `POST` con `{ accion }`:
 *
 *   alta       { correo, clave, nombre?, usuario? }  → pide el código al correo
 *   reenviar   { correo }                            → reenvía el código
 *   confirmar  { correo|identificador, codigo }      → devuelve el token de sesión
 *   sesion     { correo|identificador, clave }       → devuelve el token de sesión
 *   estado     { token } o `Authorization: Bearer`   → cuenta, pedidos y premium
 *   cuota      { token } o `Authorization: Bearer`   → las 75 canciones gratis
 *   descarga   { token, titulo, artista, … }         → descuenta 1 de la cuota
 *
 * `cuota` y `descarga` son la MISMA cuota que usa la web (data/descargas.json,
 * ver `src/server/descargas-cuenta.ts`): la cuenta es la autoridad y así quien
 * escucha en el sitio y descarga en la app no suma dos veces las 75. `estado`
 * ya trae la cuota adentro, para no gastar dos viajes al sincronizar.
 *
 * Es la sincronización de datos que pidió el dueño: la cuenta se crea desde la
 * APP y sirve igual en el sitio. Nada se guarda en claro: la base del sitio se
 * cifra sola en reposo (AES-256-GCM, ver `src/server/cifrado.ts`).
 */

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

/** El token de sesión viaja en el cuerpo o como `Authorization: Bearer`. */
function tokenDe(request: Request, datos: Record<string, unknown>): string {
  const cuerpo = String(datos.token ?? "").trim();
  if (cuerpo) return cuerpo;
  const cabecera = request.headers.get("authorization") ?? "";
  return cabecera.toLowerCase().startsWith("bearer ") ? cabecera.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/cuenta")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let datos: Record<string, unknown>;
        try {
          datos = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, motivo: "datos" }, 400);
        }
        if (!datos || typeof datos !== "object") return json({ ok: false, motivo: "datos" }, 400);

        const accion = String(datos.accion ?? "").toLowerCase();

        try {
          switch (accion) {
            case "alta":
              // `origen: "app"` es lo que separa en el panel a quien se
              // registró desde Bitly de quien lo hizo en el sitio.
              return json(await registrarCuentaImpl({ ...datos, origen: "app" }));
            case "reenviar":
              return json(await reenviarConfirmacionImpl(datos));
            case "confirmar":
              return json(await confirmarCuentaImpl(datos));
            case "sesion":
              return json(await iniciarSesionImpl(datos));
            case "estado": {
              const estado = await miCuentaImpl({ ...datos, token: tokenDe(request, datos) });
              // La cuota viaja con el estado: la app sincroniza una vez y ya sabe
              // cuántas canciones gratis le quedan (y si la cuenta tiene Premium).
              if (estado.ok && estado.cuenta?.id) {
                const cuota = await estadoDeCuenta(estado.cuenta.id, estado.premium?.codigo ?? null);
                return json({ ...estado, cuota });
              }
              // Sesión vencida = 401, igual que `cuota` y `descarga`. Antes salía
              // 200 con `ok:false`: la app igual lo entiende (mira el motivo),
              // pero un proxy o un reintento automático leían "todo bien".
              // El `!estado.ok` no es decorativo: `motivo` sólo existe en el
              // fallo, así que sin él TypeScript no deja leerlo.
              return json(estado, !estado.ok && estado.motivo === "sesion" ? 401 : 200);
            }
            case "cuota": {
              const cuenta = await cuentaDeToken(tokenDe(request, datos));
              if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);
              const cuota = await estadoDeCuenta(cuenta.id);
              return json({ ok: true, cuota });
            }
            case "descarga": {
              const cuenta = await cuentaDeToken(tokenDe(request, datos));
              if (!cuenta) return json({ ok: false, motivo: "sesion" }, 401);
              const cuota = await estadoDeCuenta(cuenta.id);
              // Premium no consume: el límite de las 75 es del plan gratis.
              if (!cuota.premium) {
                const consumo = await consumirDescarga(cuenta.id, {
                  titulo: String(datos.titulo ?? "").slice(0, 200),
                  artista: String(datos.artista ?? "").slice(0, 200),
                  calidad: datos.calidad === "flac" ? "flac" : "estandar",
                  canal: String(datos.canal ?? "app").slice(0, 40),
                });
                if (!consumo.ok) {
                  // "limite" es un veredicto, no un fallo: la app lo muestra como
                  // "se te acabaron las 75" y no como un error de red.
                  return json(
                    { ok: false, motivo: consumo.motivo, cuota: await estadoDeCuenta(cuenta.id) },
                    consumo.motivo === "limite" ? 200 : 503,
                  );
                }
              }
              return json({ ok: true, cuota: await estadoDeCuenta(cuenta.id) });
            }
            default:
              return json({ ok: false, motivo: "accion" }, 400);
          }
        } catch (e) {
          console.error("[api/cuenta] falló:", e instanceof Error ? e.message : e);
          return json({ ok: false, motivo: "servidor" }, 500);
        }      },
    },
  },
});
