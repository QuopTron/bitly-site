import { useEffect, useRef } from "react";

type Punto = { x: number; y: number; vx: number; vy: number; r: number; a: number; fill: string };

type Perfil = {
  /** Cuántos puntos se siembran. */
  puntos: number;
  /** Dibujar las líneas que unen puntos cercanos (el costo O(n²)). */
  lineas: boolean;
  /** Halo que sigue al puntero. */
  glow: boolean;
};

/**
 * Qué versión del fondo toca.
 *
 * El original dibujaba 80 puntos y comparaba todos contra todos (6 400
 * distancias por frame) más un degradado radial: lindo en una notebook, caro en
 * un celular de gama baja. Acá:
 *
 *  - con `prefers-reduced-motion` no se dibuja nada;
 *  - en pantallas chicas, o con pocos núcleos/memoria (los ZTE y compañía), se
 *    pasa a la versión liviana: 22 puntos, sin líneas, sin halo y sin
 *    comprobaciones contra el puntero (que en táctil ni existe);
 *  - en escritorio queda igual que antes, con el bucle interno optimizado.
 */
function perfil(): Perfil | null {
  if (typeof window === "undefined") return null;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;

  const nucleos = navigator.hardwareConcurrency ?? 4;
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const humilde = window.innerWidth < 768 || nucleos <= 4 || (memoria !== undefined && memoria <= 4);

  return humilde
    ? { puntos: 22, lineas: false, glow: false }
    : { puntos: 80, lineas: true, glow: true };
}

export default function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);
  const raton = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const p = perfil();
    // Con movimiento reducido no hay canvas que valga: se deja el fondo liso.
    if (!p) return;

    // Se deja constancia del perfil en el DOM: es lo que comprueba el harness
    // móvil (`scripts/verificar-movil.mjs`) sin adivinar.
    canvas.dataset.puntos = String(p.puntos);
    canvas.dataset.lineas = p.lineas ? "on" : "off";
    canvas.dataset.glow = p.glow ? "on" : "off";

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const puntos: Punto[] = [];
    let raf = 0;
    let color = "";
    let scrolleando = false;
    let finScroll = 0;

    const medir = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    medir();

    for (let i = 0; i < p.puntos; i++) {
      puntos.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        r: Math.random() * 2 + 1,
        a: Math.random() * 0.35 + 0.18,
        fill: "",
      });
    }

    const alRedimensionar = () => {
      medir();
      for (const d of puntos) {
        d.x = Math.min(d.x, canvas.width);
        d.y = Math.min(d.y, canvas.height);
      }
    };

    const alMover = (e: MouseEvent) => {
      raton.current.x = e.clientX;
      raton.current.y = e.clientY;
    };
    const alSalir = () => {
      raton.current.x = -1000;
      raton.current.y = -1000;
    };

    // Mientras se arrastra la página no se toca el canvas: el arrastre es justo
    // el momento en que se nota el tirón, y el fondo se queda quieto un instante
    // sin que nadie lo note.
    const alScrollear = () => {
      scrolleando = true;
      window.clearTimeout(finScroll);
      finScroll = window.setTimeout(() => {
        scrolleando = false;
      }, 160);
    };

    const dibujar = () => {
      raf = requestAnimationFrame(dibujar);
      if (scrolleando || document.hidden) return;

      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);

      const esClaro = document.documentElement.classList.contains("light");
      const c = esClaro ? "22,101,52" : "134,239,172";
      // El color sólo cambia al alternar el tema: los `rgba()` se arman una vez
      // y no 80 por frame (cada uno es una cadena nueva para el recolector).
      if (c !== color) {
        color = c;
        for (const d of puntos) d.fill = `rgba(${c},${d.a})`;
      }

      const { x: mx, y: my } = raton.current;
      const conRaton = p.glow && mx > 0;

      for (const d of puntos) {
        if (conRaton) {
          const dx = mx - d.x;
          const dy = my - d.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 180 && dist > 0) {
            const f = ((180 - dist) / 180) * 0.018;
            d.vx += (dx / dist) * f;
            d.vy += (dy / dist) * f;
          }
        }
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        d.vx *= 0.98;
        d.vy *= 0.98;

        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = d.fill;
        ctx.fill();
      }

      if (p.lineas) {
        for (let i = 0; i < puntos.length; i++) {
          const a = puntos[i];
          for (let j = i + 1; j < puntos.length; j++) {
            const b = puntos[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 120) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = `rgba(${c},${(1 - dist / 120) * 0.12})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }

      if (conRaton) {
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 100);
        g.addColorStop(0, `rgba(${c},0.15)`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(mx - 100, my - 100, 200, 200);
      }
    };

    raf = requestAnimationFrame(dibujar);
    window.addEventListener("resize", alRedimensionar);
    window.addEventListener("scroll", alScrollear, { passive: true });
    window.addEventListener("mousemove", alMover, { passive: true });
    document.addEventListener("mouseleave", alSalir);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(finScroll);
      window.removeEventListener("resize", alRedimensionar);
      window.removeEventListener("scroll", alScrollear);
      window.removeEventListener("mousemove", alMover);
      document.removeEventListener("mouseleave", alSalir);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden="true" />;
}
