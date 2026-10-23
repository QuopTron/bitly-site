/**
 * Preguntas frecuentes del sitio.
 *
 * Es la ÚNICA fuente de la verdad: la consume el modal de preguntas y el
 * `FAQPage` del JSON-LD. Si se agregara una pregunta acá y no en el modal —o al
 * revés—, Google rechaza los rich results por no coincidir con el contenido,
 * así que no se pueden tocar por separado.
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
