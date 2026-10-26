import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { VISTAS, type VistaId } from "@/lib/navegacion";

const CLAVE = "bitly_pista_desliz";
const CONSULTA_MOVIL = "(max-width: 1023px)";

type Props = {
  vista: VistaId;
  onCambiar: (id: VistaId) => void;
};

/**
 * Aviso de que en el celular se puede pasar de sección deslizando.
 *
 * Aparece una sola vez por navegador, unos segundos después de entrar, y dice a
 * qué sección se va a llegar: «Deslizá para ir a Planes» es más claro que un
 * icono suelto. También se puede tocar, así que sirve de atajo y no sólo de
 * cartel. Se esconde sola, al tocar y en cuanto cambia la sección: nunca tapa
 * el reproductor (en `demo` no se muestra).
 */
export default function PistaDeslizar({ vista, onCambiar }: Props) {
  const t = useI18n();
  const [visible, setVisible] = useState(false);
  const [vistaInicial] = useState(vista);

  const indice = VISTAS.findIndex((v) => v.id === vista);
  const siguiente = indice >= 0 && indice < VISTAS.length - 1 ? VISTAS[indice + 1] : null;

  const recordar = () => {
    try {
      localStorage.setItem(CLAVE, "1");
    } catch {
      /* modo privado: se vuelve a mostrar, no es grave */
    }
  };

  useEffect(() => {
    if (!siguiente || siguiente.id === "demo") return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia(CONSULTA_MOVIL).matches) return;
    try {
      if (localStorage.getItem(CLAVE) === "1") return;
    } catch {
      return;
    }
    const mostrar = setTimeout(() => {
      setVisible(true);
      recordar();
    }, 5000);
    const esconder = setTimeout(() => {
      setVisible(false);
      recordar();
    }, 14000);
    return () => {
      clearTimeout(mostrar);
      clearTimeout(esconder);
    };
  }, [siguiente]);

  // Si cambia la sección antes de que termine de mostrarse, se esconde: ya se
  // vio a dónde se iba.
  useEffect(() => {
    if (vistaInicial === vista) return;
    setVisible(false);
  }, [vista, vistaInicial]);

  if (!visible || !siguiente) return null;

  return (
    <button
      type="button"
      data-no-cambio-vista
      onClick={() => {
        setVisible(false);
        recordar();
        onCambiar(siguiente.id);
      }}
      className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[0.72rem] font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300 hover:text-foreground lg:hidden"
    >
      <ChevronUp aria-hidden className="h-3.5 w-3.5 animate-bounce text-primary" />
      {t("pistaDeslizar")} {t(siguiente.clave)}
    </button>
  );
}
