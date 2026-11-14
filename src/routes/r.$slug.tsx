import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Enlace corto de revendedor: `/r/juan10` → `/?ref=juan10`.
 *
 * La redirección se resuelve en el loader (también en SSR), así el navegador
 * nunca ve una página intermedia. El layout raíz captura el `?ref=` y lo deja
 * guardado para la compra o el alta de cuenta.
 */
export const Route = createFileRoute("/r/$slug")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/?ref=${encodeURIComponent(params.slug)}` });
  },
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
});
