/**
 * Pared de fondo del sitio.
 *
 * Antes eran tres halos de color con blur animado. Ahora es una medianera
 * callejera en blanco y negro: puntos de spray, dos manchas grandes muy
 * tenues y un par de tags gigantes recortados contra el borde.
 *
 * Todo es estático (la única animación posible la apaga el media query de
 * movimiento reducido): no hay canvas ni capas que se repinten al scrollear.
 */
export default function GlowBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Puntos de spray: patrón CSS, el compositor lo repite sin costo. */}
      <div className="pared-puntos absolute inset-0 text-foreground opacity-[0.035]" />

      {/* Dos manchas de aerosol, sin animación: dan profundidad y ya. */}
      <div className="absolute left-[-12%] top-[10%] h-[420px] w-[420px] rounded-full bg-primary/[0.05] blur-[90px] sm:h-[620px] sm:w-[620px] sm:blur-[150px]" />
      <div className="absolute bottom-[-15%] right-[-12%] h-[380px] w-[380px] rounded-full bg-primary/[0.04] blur-[80px] sm:h-[560px] sm:w-[560px] sm:blur-[140px]" />

      {/* Tags de fondo: sólo contorno, como pintados con tiza sobre el muro. */}
      <span className="tag-fondo absolute -left-8 top-[6%] -rotate-[14deg] text-[30vw] opacity-[0.05] sm:top-[4%]">
        BITLY
      </span>
      <span className="tag-fondo absolute -right-10 bottom-[8%] rotate-[9deg] text-[24vw] opacity-[0.04]">
        FLOX
      </span>
    </div>
  );
}
