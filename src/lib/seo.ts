/**
 * Datos estructurados y metadatos del sitio.
 *
 * Una sola dueña de la URL canónica, el título y la descripción: la usan el
 * `<head>` de la raíz, el `robots.txt`, el sitemap y los JSON-LD. Si algo cambia
 * acá, cambia en todos lados a la vez (los rich results de Google se validan
 * contra lo que está visible en la página, así que el texto tiene que ser el
 * MISMO que se lee en el hero).
 */

import { FAQ } from "./faq";
import { DICT } from "./translations";

export const SITIO = "https://bitly-site.pages.dev";
export const TITULO = "Bitly — Tu música, sin límites";
export const DESCRIPCION =
  "Descarga música FLAC sin pérdida desde Tidal, Qobuz, Deezer y más. App gratuita para Windows, Android, iOS y macOS.";
export const OG_IMAGE = `${SITIO}/og-image.png`;

/** Texto de una clave del diccionario en el idioma dado (por defecto, el inicial). */
export function texto(clave: string, lang: "es" | "en" = "es"): string {
  const par = DICT[clave];
  if (!par) return clave;
  return lang === "en" ? par[1] : par[0];
}

const FAQ_JSON = FAQ.map((f) => ({
  "@type": "Question",
  name: texto(f.qKey),
  acceptedAnswer: { "@type": "Answer", text: texto(f.aKey) },
}));

/**
 * `@graph` con lo que Google sabe leer en una landing de software:
 *
 *  - `WebSite` + `Organization`: quién publica (search box / knowledge panel).
 *  - `SoftwareApplication`: la ficha de la app (categoría, sistemas, icono).
 *  - `FAQPage`: las preguntas de la sección `#faq`. Tiene que coincidir
 *    carácter a carácter con lo que se ve en la página, por eso sale del mismo
 *    diccionario que el componente.
 */
export function jsonLd(): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": `${SITIO}/#sitio`,
          url: `${SITIO}/`,
          name: "Bitly",
          description: DESCRIPCION,
          inLanguage: "es",
          publisher: { "@id": `${SITIO}/#org` },
        },
        {
          "@type": "Organization",
          "@id": `${SITIO}/#org`,
          name: "Bitly",
          url: `${SITIO}/`,
          logo: { "@type": "ImageObject", url: `${SITIO}/android-chrome-512x512.png` },
          sameAs: [
            "https://www.instagram.com/flox_devs_sucre/",
            "https://www.tiktok.com/@floxdevsucre",
          ],
        },
        {
          "@type": "SoftwareApplication",
          name: "Bitly",
          alternateName: "Bitly — Tu música, sin límites",
          applicationCategory: "MultimediaApplication",
          operatingSystem: "Windows, Android, iOS, macOS",
          description: DESCRIPCION,
          url: `${SITIO}/`,
          image: OG_IMAGE,
          screenshot: OG_IMAGE,
          inLanguage: "es",
          author: { "@id": `${SITIO}/#org` },
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
        {
          "@type": "FAQPage",
          "@id": `${SITIO}/#faq`,
          mainEntity: FAQ_JSON,
        },
      ],
    },
    null,
    0,
  );
}
