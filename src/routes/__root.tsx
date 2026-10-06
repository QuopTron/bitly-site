import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts, type ErrorRouteComponent } from "@tanstack/react-router";
import { getLanguage } from "@/lib/i18n";
import { instalarReveals } from "@/lib/reveal";
import { contarVista } from "@/lib/vistas";
import PremiumBubble from "@/components/layout/premium-bubble";
import { SCRIPT_TEMA_INICIAL } from "@/lib/tema";
import "../styles.css";

function Shell({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState(getLanguage);
  useEffect(() => {
    const h = () => setLang(getLanguage());
    window.addEventListener("langchange", h);
    return () => window.removeEventListener("langchange", h);
  }, []);
  return (
    // `anim` viaja en el HTML inicial: los bloques `data-reveal` se ocultan
    // antes del primer pintado (nada de "aparecer y esconderse para animarse")
    // y sólo si hay JS para volver a mostrarlos. Sin JS, el <noscript> los deja
    // visibles.
    <html lang={lang} className="anim">
      <head>
        {/* El tema guardado se aplica acá, antes de pintar: es lo único que
            corre fuera de React y evita el destello del tema equivocado. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
        <HeadContent />
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;animation:none!important}`}</style>
        </noscript>
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function NotFound() {
  const es = getLanguage() === "es";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{es ? "Página no encontrada" : "Page not found"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{es ? "La página que buscas no existe o ha sido movida." : "The page you're looking for doesn't exist or has been moved."}</p>
        <div className="mt-6"><Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">{es ? "Ir al inicio" : "Go home"}</Link></div>
      </div>
    </div>
  );
}

const ErrorPage: ErrorRouteComponent = ({ error, reset }) => {
  console.error(error);
  const router = useRouter();
  const es = getLanguage() === "es";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{es ? "Esta página no cargó" : "This page didn't load"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{es ? "Algo salió mal. Puedes intentar refrescar o volver al inicio." : "Something went wrong. Try refreshing or go home."}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">{es ? "Intentar de nuevo" : "Try again"}</button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">{es ? "Ir al inicio" : "Go home"}</a>
        </div>
      </div>
    </div>
  );
};

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Un solo observador para todas las apariciones del sitio. Corre después de
  // que los hijos montaron, así ya encuentra los `data-reveal` en el DOM.
  useEffect(() => instalarReveals(), []);
  // La visita se cuenta al entrar al sitio, en cualquier ruta. Va acá y no en
  // la sección de opiniones: el contador no depende de que esa sección exista.
  useEffect(() => {
    void contarVista();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <PremiumBubble />
    </QueryClientProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bitly — Tu música, sin límites" },
      { name: "description", content: "Descarga música FLAC sin pérdida desde Tidal, Qobuz, Deezer y más." },
      { name: "author", content: "Bitly" },
      { property: "og:title", content: "Bitly — Tu música, sin límites" },
      { property: "og:description", content: "Descarga música FLAC sin pérdida desde Tidal, Qobuz, Deezer y más." },
    ],
    links: [{ rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" }],
  }),
  shellComponent: Shell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});
