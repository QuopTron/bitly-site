import { createFileRoute } from "@tanstack/react-router";
import PanelRevendedor from "@/components/panel/panel-revendedor";

export const Route = createFileRoute("/revendedor")({
  head: () => ({
    meta: [
      { title: "Panel de revendedor — Bitly" },
      // Página privada de cada revendedor: fuera de buscadores.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PanelRevendedor,
});
