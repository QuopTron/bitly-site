/**
 * Preguntas frecuentes del sitio.
 *
 * Es la ÚNICA fuente de la verdad: la consume la sección visible `#faq` (que es
 * lo que el usuario lee y lo que Google indexa) y el `FAQPage` del JSON-LD. Si
 * se agregara una pregunta acá y no en la página —o al revés—, Google rechaza
 * los rich results por no coincidir con el contenido, así que no se pueden tocar
 * por separado.
 *
 * El contenido va en el HTML desde el primer pintado: antes vivía dentro de un
 * modal que sólo montaba al hacer clic, así que ni el crawler ni el lector de
 * pantalla lo veían sin abrirlo.
 */

export type FaqItem = { qKey: string; aKey: string };

export const FAQ: FaqItem[] = [
  { qKey: "faq1Q", aKey: "faq1A" },
  { qKey: "faq2Q", aKey: "faq2A" },
  { qKey: "faq3Q", aKey: "faq3A" },
  { qKey: "faq4Q", aKey: "faq4A" },
  { qKey: "faq5Q", aKey: "faq5A" },
  { qKey: "faq6Q", aKey: "faq6A" },
  { qKey: "faq7Q", aKey: "faq7A" },
];
