import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useCurrency, setCurrency, CODES, INFO, type Code } from "@/lib/currency";

export default function CurrencySelector() {
  const [currency] = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-card/60 hover:text-foreground"
      >
        {INFO[currency].sym}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 max-sm:left-1/2 max-sm:-translate-x-1/2 top-full z-50 mt-1 w-32 rounded-xl border border-border/60 bg-card/95 p-1 shadow-xl shadow-black/10 backdrop-blur">
          {CODES.map((c) => (
            <button
              key={c}
              onClick={() => { setCurrency(c); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition hover:bg-primary/10 ${c === currency ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"}`}
            >
              <span className="w-8">{INFO[c].sym}</span>
              <span>{INFO[c].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
