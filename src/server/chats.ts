/**
 * Chats: el repo privado `QuopTron/bitly-chats` con los Issues haciendo de
 * hilos de conversación.
 *
 * Por qué Issues y no una base propia: cada conversación queda versionada,
 * con su número estable, su autoría y su historial de respuestas, y se puede
 * responder desde GitHub sin tocar el sitio. El sitio sólo LEE la lista y
 * CREAR el hilo inicial — responder sigue siendo cosa de quien tiene acceso al
 * repo.
 *
 * El token vive SOLO acá: la lista pasa por el servidor y el navegador ve un
 * JSON ya recortado, nunca el Issue crudo ni el repo.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  ASUNTO_MAX,
  ASUNTO_MIN,
  MENSAJE_MAX,
  MENSAJE_MIN,
  NOMBRE_MAX,
  NOMBRE_MIN,
  cuerpoDeChat,
  hayCupoChat,
  limpiarTexto,
  resumirCuerpo,
} from "@/lib/chats-reglas";
import { apiGet, apiPost, repoDe } from "./github-store";
import { obtenerIPCliente } from "./ip";

export type ChatResumen = {
  numero: number;
  titulo: string;
  estado: "abierto" | "cerrado";
  respuestas: number;
  resumen: string;
  creado: string;
  actualizado: string;
};

/** Shape mínimo de la Issues API que nos interesa. */
type IssueCruda = {
  number: number;
  title: string;
  state: string;
  comments: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
};

export type ResultadoChat =
  | { ok: true; numero: number }
  | { ok: false; motivo: "datos" | "limite" | "servidor" };

// La lista no cambia entre visitas seguidas y cada lectura es una llamada a la
// API: 30 s de caché baja el uso sin que nadie note la demora.
const TTL_MS = 30_000;
let cache: { chats: ChatResumen[]; expira: number } | null = null;

function recortar(issues: IssueCruda[]): ChatResumen[] {
  return (Array.isArray(issues) ? issues : [])
    // Los PR son issues también: en este repo no deberían haber, pero el
    // filtro es gratis y evita que un detalle de build entre como "chat".
    .filter((i) => i && !i.pull_request && typeof i.number === "number")
    .map((i) => ({
      numero: i.number,
      titulo: String(i.title ?? "").slice(0, 120),
      estado: i.state === "closed" ? ("cerrado" as const) : ("abierto" as const),
      respuestas: Number(i.comments) || 0,
      resumen: resumirCuerpo(i.body),
      creado: i.created_at,
      actualizado: i.updated_at,
    }));
}

/** Los hilos, más nuevos arriba. */
export const listarChats = createServerFn({ method: "POST" }).handler(
  async (): Promise<ChatResumen[]> => {
    if (cache && cache.expira > Date.now()) return cache.chats;
    try {
      const repo = repoDe("chats");
      const issues = await apiGet<IssueCruda[]>(
        `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=20`,
      );
      const chats = recortar(issues ?? []);
      // Si la API falló no se cachea la vacía: un hueco de 30 s no vale la
      // pena cuando el próximo intento puede funcionar.
      if (chats.length > 0) cache = { chats, expira: Date.now() + TTL_MS };
      return chats;
    } catch (e) {
      console.error("[chats] no se pudo listar:", e instanceof Error ? e.message : e);
      return cache?.chats ?? [];
    }
  },
);

/**
 * Abre un hilo nuevo.
 *
 * El campo `web` es un cebo: los formularios llenan todo lo que ven, así que
 * si llega con algo escrito se devuelve `ok` igual (para no avisarle al bot)
 * y no se gasta ni el cupo ni un Issue.
 */
export const abrirChat = createServerFn({ method: "POST" })
  .validator(
    (entrada: { nombre?: unknown; asunto?: unknown; mensaje?: unknown; web?: unknown }) => entrada,
  )
  .handler(async ({ data }): Promise<ResultadoChat> => {
    if (typeof data?.web === "string" && data.web.trim() !== "") return { ok: true, numero: 0 };

    const nombre = limpiarTexto(data?.nombre, NOMBRE_MIN, NOMBRE_MAX);
    const asunto = limpiarTexto(data?.asunto, ASUNTO_MIN, ASUNTO_MAX);
    const mensaje = limpiarTexto(data?.mensaje, MENSAJE_MIN, MENSAJE_MAX);
    if (!nombre || !asunto || !mensaje) return { ok: false, motivo: "datos" };

    if (!hayCupoChat(await obtenerIPCliente())) return { ok: false, motivo: "limite" };

    try {
      const repo = repoDe("chats");
      const creado = await apiPost<{ number?: number }>(`/repos/${repo}/issues`, {
        title: asunto,
        body: cuerpoDeChat(nombre, mensaje),
        labels: ["chat"],
      });
      if (!creado || typeof creado.number !== "number") {
        console.error("[chats] no se pudo crear el Issue");
        return { ok: false, motivo: "servidor" };
      }
      // La lista recién creada sigue vieja en caché: si no se limpia, el
      // visitante abre el chat y no lo ve aparecer.
      cache = null;
      return { ok: true, numero: creado.number };
    } catch (e) {
      console.error("[chats] error inesperado:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
