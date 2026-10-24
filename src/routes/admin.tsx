import { createFileRoute } from "@tanstack/react-router";
import PanelAdmin from "@/components/panel/panel-admin";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Panel · Bitly" },
      // Es una página privada: no tiene por qué aparecer en buscadores.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PanelAdmin,
});
