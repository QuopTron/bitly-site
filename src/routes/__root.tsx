import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts, type ErrorRouteComponent } from "@tanstack/react-router";
import { getLanguage, useLanguage } from "@/lib/i18n";
import { usePreferenciasGuardadas } from "@/lib/preferencias";
import { instalarReveals } from "@/lib/reveal";
import { contarVista } from "@/lib/vistas";
import PremiumBubble from "@/components/layout/premium-bubble";
import { SCRIPT_TEMA_INICIAL } from "@/lib/tema";
import { DESCRIPCION, OG_IMAGE, SITIO, TITULO, jsonLd } from "@/lib/seo";
import "../styles.css";

function Shell({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState(getLanguage);
  useEffect(() => {
    const h = () => setLang(getLanguage());
    window.addEventListener("langchange", h);
    // Sincroniza por las dudas: si el idioma guardado se aplicó antes de que
    // este efecto se registrara (efectos de hijos van primero), el evento se
    // perdió y el <html> se quedaría en "es".
    h();
    return () => window.removeEventListener("langchange", h);
  }, []);
  return (
    // `anim` viaja en el HTML inicial: los bloques `data-reveal` se ocultan
    // antes del primer pintado (nada de "aparecer y esconderse para animarse")
    // y sólo si hay JS para volver a mostrarlos. Sin JS, el <noscript> los deja
    // visibles.
    // `suppressHydrationWarning`: el script del <head> le agrega `dark`/`light`
    // al <html> antes de hidratar (tema sin destello) y React, si no, avisa de
    // un mismatch de atributo que es justamente lo que queremos que pase.
    <html lang={lang} className="anim" suppressHydrationWarning>
      <head>
        {/* El tema guardado se aplica acá, antes de pintar: es lo único que
            corre fuera de React y evita el destello del tema equivocado. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
        {/* Los datos estructurados van en el <head> del shell: así existen
            aunque la ruta todavía no pinte nada. Sale del mismo diccionario que
            la sección #faq, así que siempre coinciden con lo visible. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd() }}
        />
        <HeadContent />
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;animation:none!important}`}</style>
        </noscript>
      </head>
      <body>
        {children}
        {/* Revela lo que ya está a la vista EN EL PRIMER PINTADO, sin esperar a
            que llegue el bundle. El observador de `reveal.ts` sigue siendo el
            dueño de todo lo que aparece al hacer scroll: este guion sólo saca
            del ocultamiento al primer plato. Corre durante el parseo del HTML,
            así que no hay frame en el que la portada se vea vacía (FCP, LCP y
            Speed Index suben y, encima, la portada no "aparece" al hidratar).
            Marca con el atributo `data-dentro` durante el parseo; los bloques
            `data-reveal` llevan `suppressHydrationWarning`, así que React no
            valida sus atributos al hidratar y este cambio a propósito no
            acusa mismatch. El atributo además sobrevive a re-renders que
            pisen el className (una clase se perdía en silencio). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var m=document.querySelectorAll("[data-reveal]");for(var i=0;i<m.length;i++){if(m[i].getBoundingClientRect().top<=window.innerHeight)m[i].setAttribute("data-dentro","")}}catch(e){}})();',
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  usePreferenciasGuardadas();
  const [lang] = useLanguage();
  const es = lang === "es";
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
  usePreferenciasGuardadas();
  const [lang] = useLanguage();
  const es = lang === "es";
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
      { title: TITULO },
      { name: "description", content: DESCRIPCION },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "author", content: "Bitly" },
      { name: "theme-color", content: "#f3fbf7", media: "(prefers-color-scheme: light)" },
      // Va el oscuro el ÚLTIMO: TanStack deduplica las `meta` por nombre y se
      // queda con la última, y el tema de marca es el oscuro (el que se ve al
      // entrar sin preferencia guardada).
      { name: "theme-color", content: "#001f2a", media: "(prefers-color-scheme: dark)" },
      { name: "color-scheme", content: "dark light" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Bitly" },
      { property: "og:locale", content: "es_ES" },
      { property: "og:locale:alternate", content: "en_US" },
      { property: "og:url", content: `${SITIO}/` },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRIPCION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:secure_url", content: OG_IMAGE },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: TITULO },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITULO },
      { name: "twitter:description", content: DESCRIPCION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: TITULO },
    ],
    links: [
      { rel: "canonical", href: `${SITIO}/` },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preload", href: "/fonts/inter-latin.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://api.github.com" },
      { rel: "dns-prefetch", href: "https://api.github.com" },
    ],
  }),
  shellComponent: Shell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});
