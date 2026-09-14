const PHASES = [
  { until: "2026-09-16T00:00:00", price: 30, originalPrice: 50, label: "Oferta hasta 15/09", labelEn: "Offer until 15/09" },
  { until: "2026-09-21T00:00:00", price: 40, originalPrice: 50, label: "Oferta hasta 20/09", labelEn: "Offer until 20/09" },
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
