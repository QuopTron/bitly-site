import { estadoDescargas, type EstadoDescargasCuenta } from "@/server/descargas-cuenta";
import type { Pista } from "@/lib/demo-catalog";
import { codigoPremiumGuardado } from "@/lib/demo-cuota";
import { leerTokenCuenta } from "@/lib/cuentas-cliente";

export type ResultadoDescarga =
  | { ok: true; nombre: string }
  | {
      ok: false;
      motivo: "sesion" | "limite" | "sin_audio" | "servidor" | "red";
      restantes?: number | null;
      limite?: number;
    };

export async function consultarDescargas(): Promise<EstadoDescargasCuenta> {
  const token = leerTokenCuenta();
  if (!token) return { ok: false, motivo: "sesion" };
  return estadoDescargas({ data: { token, codigo: codigoPremiumGuardado() } });
}

function nombreDeCabecera(cabecera: string | null, reserva: string): string {
  const estrellado = cabecera?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (estrellado) {
    try {
      return decodeURIComponent(estrellado);
    } catch {
      // Cabecera mal codificada: se usa el nombre simple.
    }
  }
  const simple = cabecera?.match(/filename="?([^";]+)"?/i)?.[1];
  return simple?.trim() || reserva;
}

function guardarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = "noopener";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function descargarPista(
  p: Pista,
  onProgreso: (porcentaje: number) => void,
): Promise<ResultadoDescarga> {
  const token = leerTokenCuenta();
  const codigo = codigoPremiumGuardado();
  if (!token && !codigo) return { ok: false, motivo: "sesion" };

  const parametros = new URLSearchParams({
    titulo: p.titulo,
    artista: p.artista,
    ext: p.ext,
  });
  if (p.album) parametros.set("album", p.album);
  if (p.duracion > 0) parametros.set("duracionMs", String(Math.round(p.duracion * 1000)));
  if (p.isrc) parametros.set("isrc", p.isrc);
  if (codigo) parametros.set("codigo", codigo);

  let respuesta: Response;
  try {
    respuesta = await fetch(`/api/descargar?${parametros.toString()}`, {
      headers: token ? { "x-bitly-token": token } : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, motivo: "red" };
  }

  if (!respuesta.ok) {
    const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
    const restantes = Number(respuesta.headers.get("x-descargas-restantes"));
    const limite = Number(respuesta.headers.get("x-descargas-limite"));
    switch (cuerpo?.error) {
      case "sesion":
        return { ok: false, motivo: "sesion" };
      case "limite":
        return {
          ok: false,
          motivo: "limite",
          restantes: Number.isFinite(restantes) ? restantes : 0,
          limite: Number.isFinite(limite) && limite > 0 ? limite : undefined,
        };
      case "sin_audio":
        return { ok: false, motivo: "sin_audio" };
      default:
        return { ok: false, motivo: "servidor" };
    }
  }

  const total = Number(respuesta.headers.get("content-length")) || 0;
  const lector = respuesta.body?.getReader();
  if (!lector) return { ok: false, motivo: "servidor" };

  const trozos: BlobPart[] = [];
  let recibido = 0;
  onProgreso(total > 0 ? 0 : -1);

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (!value) continue;
    trozos.push(value as unknown as BlobPart);
    recibido += value.byteLength;
    onProgreso(total > 0 ? Math.min(99, Math.round((recibido / total) * 100)) : -1);
  }

  const tipo = respuesta.headers.get("content-type") ?? "application/octet-stream";
  const nombre = nombreDeCabecera(
    respuesta.headers.get("content-disposition"),
    `${p.artista} - ${p.titulo}`,
  );
  guardarBlob(new Blob(trozos, { type: tipo }), nombre);
  onProgreso(100);
  return { ok: true, nombre };
}
