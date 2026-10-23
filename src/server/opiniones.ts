/**
 * Opiniones con estrellas.
 *
 * Sólo la ESCRITURA pasa por acá. Leer es público (cualquiera puede bajarse
 * `data/opiniones.json` del repo privado vía el sitio), pero escribir no: el
 * archivo no tiene endpoint abierto y el único camino es esta función de
 * servidor, que valida con `src/lib/opiniones-reglas.ts` y además limita los
 * envíos por IP. Sin eso, un script llenaría el archivo en segundos y cada
 * envío costaría un commit.
 *
 * El token de GitHub vive en el servidor (nunca prefijado con VITE_), del mismo
 * modo en que antes vivía `SUPABASE_SECRET_KEY`.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  NOMBRE_MAX,
  NOMBRE_MIN,
  TEXTO_MAX,
  TEXTO_MIN,
  hayCupo,
  limpiarEstrellas,
  limpiarTexto,
} from "@/lib/opiniones-reglas";
import { getJson, putJson } from "./github-store";
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

const ARCHIVO = "data/opiniones.json";

/** Mismo shape que guarda `data/opiniones.json`. */
type OpinionCruda = OpinionPublicada & { aprobado?: boolean };

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
      const lista = await getJson<OpinionCruda[]>("datos", ARCHIVO, []);
      const base = Array.isArray(lista) ? [...lista] : [];

      const opinion: OpinionCruda = {
        // `Date.now()` y no `max(id)+1`: con dos envíos simultáneos de
        // visitantes distintos el `max` se repetiría y React chocaría con la
        // key. Con el timestamp cada opinión es única.
        id: Date.now(),
        nombre,
        estrellas,
        texto,
        aprobado: true,
        creado: new Date().toISOString(),
      };

      const ok = await putJson("datos", ARCHIVO, [opinion, ...base], `opinion: ${estrellas}★ ${nombre}`);
      if (!ok) {
        console.error("[opiniones] no se pudo escribir el archivo");
        return { ok: false, motivo: "servidor" };
      }

      return {
        ok: true,
        opinion: { id: opinion.id, nombre, estrellas, texto, creado: opinion.creado },
      };
    } catch (e) {
      console.error("[opiniones] error inesperado:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "servidor" };
    }
  });
