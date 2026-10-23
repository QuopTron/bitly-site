import { useEffect, useState } from "react";
import { leerOpiniones } from "@/server/datos";
import CarruselOpiniones, { type Opinion } from "@/components/comentarios/carrusel-opiniones";

type Resumen = { opiniones: number; promedio: number; vistas: number; reparto: number[] };

type Props = {
  /** Comparte promedio/vistas con el pie del hero. */
  onResumen?: (resumen: Resumen) => void;
};

/** Sólo el carrusel de comentarios, sin títulos ni botones extra. */
export default function ComentariosInicio({ onResumen }: Props) {
  const [opiniones, setOpiniones] = useState<Opinion[] | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      leerOpiniones()
        .then((r) => {
          if (!vivo) return;
          setOpiniones(r.opiniones);
          onResumen?.(r.resumen);
        })
        .catch(() => vivo && setOpiniones([]));
    };
    cargar();
    window.addEventListener("bitly:opinion-publicada", cargar);
    return () => {
      vivo = false;
      window.removeEventListener("bitly:opinion-publicada", cargar);
    };
  }, [onResumen]);

  return <CarruselOpiniones opiniones={opiniones} columnas={3} />;
}
