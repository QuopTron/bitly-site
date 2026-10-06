/**
 * Halos de color fijos detrás de todo el sitio.
 *
 * El blur es caro en la GPU: en pantallas chicas va bastante más bajo (el
 * degradado se ve casi igual) y la deriva lenta —que mueve capas grandes— sólo
 * se activa a partir de `sm`, porque `anim-deriva` se apaga solo en móvil.
 */
export default function GlowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="anim-deriva absolute top-[-20%] left-[-10%] h-[400px] w-[400px] rounded-full bg-primary/[0.08] blur-[70px] sm:h-[700px] sm:w-[700px] sm:blur-[180px]" style={{ animationDuration: "26s" }} />
      <div
        className="anim-deriva absolute bottom-[-20%] right-[-10%] h-[350px] w-[350px] rounded-full bg-accent/[0.08] blur-[60px] sm:h-[600px] sm:w-[600px] sm:blur-[160px]"
        style={{ animationDelay: "-8s", animationDuration: "28s" }}
      />
      {/* El contenedor centra con `-translate-x-1/2`; la animación va en el
          círculo de adentro para que su `transform` no pise el centrado. */}
      <div className="absolute top-[30%] left-1/2 h-[200px] w-[200px] -translate-x-1/2 sm:h-[350px] sm:w-[350px]">
        <div
          className="anim-deriva h-full w-full rounded-full bg-primary/[0.05] blur-[50px] sm:blur-[120px]"
          style={{ animationDelay: "-16s", animationDuration: "32s" }}
        />
      </div>
    </div>
  );
}
