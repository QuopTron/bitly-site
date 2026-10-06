/**
 * Opiniones con estrellas.
 *
 * Sólo la ESCRITURA pasa por acá. Leer es público (la tabla tiene política de
 * SELECT para lo aprobado), pero insertar no: la migración no crea política de
 * INSERT a propósito, así que nadie puede mandar filas directo contra la API de
 * Supabase con la clave publicable —que es pública por diseño—. El único camino
 * es este módulo.
 *
 * Escribe con `SUPABASE_SECRET_KEY` (clave secreta, sólo servidor, nunca
 * prefijada con VITE_) y aplica las reglas de `src/lib/opiniones-reglas.ts`, que
 * incluyen el cupo por IP: sin él, un script llena la tabla en segundos.
 *
 * Cómo está probado: las reglas y el cupo se comprueban sin base
 * (`scripts/probar-opiniones.mjs`); el camino real de escritura necesita la
 * migración aplicada en Supabase.
 */

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  NOMBRE_MAX,
  NOMBRE_MIN,
  TEXTO_MAX,
  TEXTO_MIN,
  hayCupo,
  limpiarEstrellas,
  limpiarTexto,
} from "@/lib/opiniones-reglas";
import { obtenerIPCliente } from "./ip";

export type OpinionPublicada = {
  id: number;
  nombre: string;
  estrellas: number;
  texto: string;
  creado: string;
};

export type ResultadoOpinion =
  | { ok: true; opinion: OpinionPublicada }
  | { ok: false; motivo: "datos" | "limite" | "servidor" };

function clienteServidor() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en el servidor");
  return createClient<Database>(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const publicarOpinion = createServerFn({ method: "POST" })
  .validator((entrada: { nombre?: unknown; estrellas?: unknown; texto?: unknown }) => entrada)
  .handler(async ({ data }): Promise<ResultadoOpinion> => {
    // Primero el formato: un envío inválido no gasta cupo.
    const nombre = limpiarTexto(data?.nombre, NOMBRE_MIN, NOMBRE_MAX);
    const texto = limpiarTexto(data?.texto, TEXTO_MIN, TEXTO_MAX);
    const estrellas = limpiarEstrellas(data?.estrellas);
    if (!nombre || !texto || !estrellas) return { ok: false, motivo: "datos" };

    if (!hayCupo(await obtenerIPCliente())) return { ok: false, motivo: "limite" };

    try {
      const { data: fila, error } = await clienteServidor()
        .from("comentarios")
        .insert({ nombre, estrellas, texto })
        .select("id, nombre, estrellas, texto, creado")
        .single();
      if (error || !fila) {
        console.error("[opiniones] no se pudo guardar:", error?.message ?? "sin fila");
        return { ok: false, motivo: "servidor" };
      }
      return { ok: true, opinion: fila as OpinionPublicada };
    } catch (e) {
      console.error("[opiniones] error inesperado:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
