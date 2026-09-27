/**
 * Fases de precio (en bolivianos).
 *
 * La oferta de lanzamiento de 30 Bs corre hasta el 30 de septiembre de 2026
 * inclusive: `until` apunta a las 00:00 del 1 de octubre.
 */
const PHASES = [
  {
    until: "2026-10-01T00:00:00",
    price: 30,
    originalPrice: 50,
    label: "Oferta hasta 30/09",
    labelEn: "Offer until 30/09",
  },
  { until: null, price: 50, originalPrice: 50, label: "", labelEn: "" },
];

export function getPhasePrice() {
  const now = new Date();
  for (const phase of PHASES) {
    if (!phase.until || now < new Date(phase.until)) {
      return { price: phase.price, originalPrice: phase.originalPrice, label: phase.label, labelEn: phase.labelEn, onOffer: phase.price < phase.originalPrice };
    }
  }
  const last = PHASES[PHASES.length - 1];
  return { price: last.price, originalPrice: last.originalPrice, label: last.label, labelEn: last.labelEn, onOffer: false };
}
