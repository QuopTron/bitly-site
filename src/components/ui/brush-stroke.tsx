/**
 * Subrayado de pincel. Se dibuja una vez al entrar en pantalla y queda quieto:
 * sólo anima `stroke-dashoffset`, que no provoca layout ni repintados del texto.
 */
export default function BrushStroke({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 340 20"
      fill="none"
      className={`trazo-firma block ${className}`}
    >
      <path
        d="M5 13C52 6 96 16 148 10c46-5 93 5 132-1 16-2 34-1 55 4"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="420"
        opacity="0.9"
      />
      <path
        d="M22 18C76 12 128 20 186 14c40-4 82 3 122-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="420"
        opacity="0.35"
      />
    </svg>
  );
}
